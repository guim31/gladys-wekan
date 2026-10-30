// -----------------------------------------------------------------------------
// The Wekan hub: reads the instance on a timer of the container, publishes
// the counters of every followed board when they change, fires the scene
// events (a new card, a card arrives in a list, a card reaches its due time,
// a card is still not done when its due day ends), and creates, moves or
// finishes cards for the widget and the scene actions.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when no device was added. The timer also wakes up at
// the next due time and at local midnight, so the events and the counters
// move on time whatever the interval.
// (Architecture adapted from guim31/gladys-planka.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { boardIds, buildBoard, featureStates } from './devices.js';
import { ERROR_KINDS, WekanClient, WekanError } from './wekan/client.js';
import {
  findByIdOrName,
  localDay,
  localTime,
  parseBoard,
  parseBoards,
  pendingDue,
  resolveTimeZone,
  summarize,
} from './wekan/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  DONE_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  TODAY_TEXT,
  UNKNOWN_BOARDS,
  allLanguages,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'wekan-hub' });

export const WIDGET_KEY = 'cards_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ADDED: 'card_added',
  MOVED: 'card_moved',
  DUE: 'card_due',
  OVERDUE: 'card_overdue',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Read this long after a due time or midnight, so the server agrees.
  wakeSlackMs: 2_000,
  // Never read more often than this, even for cards due a second apart.
  minDelayMs: 10_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
  // An event this late (Wekan or the integration was down) is dropped.
  maxLateMs: 60 * 60_000,
};

// At most this many boards are read (2 requests each per reading, and one
// per swimlane).
export const MAX_BOARDS = 20;
// The reading after a command is awaited at most this long: the scene action
// and the widget button answer within their 20 s.
const REFRESH_WAIT_MS = 3_000;
// Card names read out by the "Read today's cards" action.
const MAX_NAMES = 10;
const MAX_CARD_NAME = 1024;

const iso = (ms) => (ms === null || ms === undefined ? '' : new Date(ms).toISOString());

export class WekanHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/wekan/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] defaults to TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = resolveTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = { scope: null, readAt: 0, lists: {}, boards: [] };
    this.connection = null;
    this.devicesSignature = null;
    this.widgetSignature = null;
    this.transports = new Map();
    this.timer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  reset() {
    /** Every board the user sees. */
    this.boards = [];
    /** The followed ones, read: `{ id, name, lists, swimlanes, cards }`. */
    this.followed = [];
    this.unknownBoards = [];
    /** Every card of the followed boards. */
    this.cards = [];
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      readAt: Number.isFinite(saved.readAt) ? saved.readAt : 0,
      lists: saved.lists && typeof saved.lists === 'object' ? saved.lists : {},
      boards: Array.isArray(saved.boards) ? saved.boards : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.devicesSignature = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.username === config.username &&
      previous.password === config.password &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      this.reset();
      this.client =
        config.url && config.username && config.password
          ? new WekanClient({
              url: config.url,
              username: config.username,
              password: config.password,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    // A new language, board or "done" list: the devices are published again.
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  /** The interval, shortened to the next due time or local midnight. */
  nextDelay(readAt = this.now()) {
    if (this.error) {
      return Math.min(this.config.pollIntervalMs, this.timings.retryMs);
    }
    const now = this.now();
    // `readAt`: a moment that passed during the reading is still ahead of it.
    const moments = [localDay(readAt, this.timeZone).end];
    for (const card of this.cards) {
      const due = pendingDue(card);
      if (due !== null && due > readAt) {
        moments.push(due);
      }
    }
    const ahead = moments.filter((moment) => moment + this.timings.wakeSlackMs > now);
    const wake = ahead.length === 0 ? 0 : Math.min(...ahead) - now + this.timings.wakeSlackMs;
    return Math.max(this.timings.minDelayMs, Math.min(this.config.pollIntervalMs, wake));
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      const readAt = this.now();
      try {
        await this.read();
      } finally {
        this.schedule(this.nextDelay(readAt));
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const now = this.now();
    const { client } = this;
    try {
      const boards = parseBoards(await client.boards());
      const wanted = this.follow(boards);
      const followed = [];
      // One board after the other: a small Wekan is not hit by 20 requests at once.
      for (const board of wanted) {
        try {
          const raw = await client.board(board.id);
          const { lists, cards } = parseBoard(raw, board.id, this.config.doneLists);
          const swimlanes = raw.swimlanes.filter((item) => typeof item?._id === 'string');
          followed.push({ ...board, lists, swimlanes, cards });
        } catch (err) {
          // Deleted, or the user left it, between the two requests.
          if (!(err instanceof WekanError) || err.kind !== ERROR_KINDS.NOT_FOUND) {
            throw err;
          }
        }
      }
      if (client !== this.client) {
        // The configuration changed during the reading: these are the old
        // instance's cards; the new one is being read.
        return;
      }
      this.boards = boards;
      this.followed = followed;
      this.cards = followed.flatMap((board) => board.cards);
      this.readAt = now;
      this.recovered(now);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err, now);
    }
    if (this.readAt !== 0) {
      await this.publishDevices();
      // The configuration may change while Gladys answers: never write the
      // old reading's events nor its card lists under the new one.
      if (!this.error && client === this.client) {
        await this.publishStates();
        if (client === this.client) {
          await this.fireEvents(now);
        }
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  /** The boards to read: the configuration's list (names or ids), or all. */
  follow(boards) {
    const wanted = this.config.boards;
    let followed = boards;
    let unknown = [];
    if (wanted.length > 0) {
      const found = new Set();
      for (const query of wanted) {
        const { item, reason } = findByIdOrName(boards, query);
        if (item) {
          found.add(item.id);
        } else if (reason === 'ambiguous') {
          // Two boards of that name: both are followed.
          for (const board of boards) {
            if (findByIdOrName([board], query).item) {
              found.add(board.id);
            }
          }
        } else {
          unknown.push(query);
        }
      }
      followed = boards.filter((board) => found.has(board.id));
    }
    if (followed.length > MAX_BOARDS) {
      this.problem(
        'too-many-boards',
        `${followed.length} boards: only the first ${MAX_BOARDS} are read, list the ones to follow in the configuration`,
      );
      followed = followed.slice(0, MAX_BOARDS);
    } else {
      this.resolved('too-many-boards');
    }
    if (unknown.join('|') !== this.unknownBoards.join('|')) {
      this.unknownBoards = unknown;
      if (unknown.length > 0) {
        logger.warn(UNKNOWN_BOARDS.en(unknown.join(', ')));
      }
    }
    return followed;
  }

  recovered(now) {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((now - this.downSince) / 60_000);
      this.resolved('read', `Wekan at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      const open = this.cards.filter((card) => card.open).length;
      logger.info(
        `Connected to Wekan at ${host}: ${open} open card(s) in ${this.followed.length} followed board(s)`,
      );
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err, now) {
    const kind = err instanceof WekanError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= now;
    this.problem('read', `Wekan at ${hostOf(this.config.url)}: ${err.message}`, undefined, 'error');
  }

  /** The followed board of a board device external id, null when none. */
  boardOf(externalId) {
    return (
      this.followed.find((board) => boardIds(this.gladys, board.id).device === externalId) ?? null
    );
  }

  /** What a widget points at: every followed board, or one. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return { board: null, unknown: false };
    }
    const board = this.boardOf(deviceExternalId);
    return { board, unknown: !board };
  }

  summary(board = null) {
    const now = this.now();
    return summarize(board ? board.cards : this.cards, {
      now,
      day: localDay(now, this.timeZone),
    });
  }

  boardTitle(boardId) {
    return this.followed.find((board) => board.id === boardId)?.name ?? `#${boardId}`;
  }

  listTitle(boardId, listId) {
    const board = this.followed.find((item) => item.id === boardId);
    return board?.lists.find((list) => list.id === listId)?.name ?? '';
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    const count = (list, key) => {
      const counts = new Map();
      for (const item of list) {
        counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
      }
      return counts;
    };
    // Two boards of the same name: the end of the id tells them apart.
    const byName = count(this.followed, (board) => board.name);
    return this.followed.map((board) => {
      const name =
        byName.get(board.name) > 1
          ? `${board.name.slice(0, 30)} #${board.id.slice(-5)}`
          : board.name;
      return buildBoard(this.gladys, { ...board, name }, this.language);
    });
  }

  async publishDevices() {
    const devices = this.devices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    await this.poll();
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  states() {
    const options = { language: this.language, timeZone: this.timeZone };
    return this.followed.flatMap((board) =>
      featureStates(this.gladys, board, this.summary(board), options),
    );
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(this.states(), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const entries = this.devices()
      .map((device) => ({ external_id: device.external_id, transport }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noCredentials };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const signature = JSON.stringify([
      this.error?.kind ?? null,
      this.followed,
      localDay(this.now(), this.timeZone).start,
    ]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * The events since the previous successful reading (persisted under /data,
   * so a restart neither repeats nor loses one):
   *   - a card unknown then, on a board already read then: a new card
   *     (created, restored from the archive, or brought from another board);
   *     a board just followed brings no event;
   *   - a card whose list changed since then;
   *   - a due time crossed, the end of a due day crossed. A due date moved
   *     into the past by hand is not a crossing: nothing fires for it.
   */
  async fireEvents(now) {
    const scope = this.config.url;
    const lists = Object.fromEntries(this.cards.map((card) => [card.id, card.listId]));
    const boards = this.followed.map((board) => board.id);
    if (this.saved.scope !== scope || this.saved.readAt === 0) {
      // First reading of this instance: what already passed is not news.
      this.saved = { scope, readAt: now, lists, boards };
      this.store.save(this.saved);
      return;
    }
    const known = this.saved.lists;
    const knownBoards = new Set(this.saved.boards);
    const from = Math.max(this.saved.readAt, now - this.timings.maxLateMs);
    const crossed = (moment) => moment !== null && moment > from && moment <= now;
    const events = [];
    for (const card of this.cards) {
      const base = this.eventData(card);
      const before = known[card.id];
      // A list of another board: the card changed board, which is no move.
      const sameBoard = before !== undefined && this.listTitle(card.boardId, before) !== '';
      if (!sameBoard && before !== card.listId && knownBoards.has(card.boardId)) {
        events.push({ at: now, key: TRIGGERS.ADDED, card, data: base });
      }
      if (sameBoard && before !== card.listId) {
        events.push({
          at: now,
          key: TRIGGERS.MOVED,
          card,
          data: { ...base, previous_list: this.listTitle(card.boardId, before) },
        });
      }
      const due = pendingDue(card);
      if (crossed(due)) {
        events.push({ at: due, key: TRIGGERS.DUE, card, data: base });
      }
      if (due !== null) {
        const dayEnd = localDay(due, this.timeZone).end;
        if (crossed(dayEnd)) {
          events.push({ at: dayEnd, key: TRIGGERS.OVERDUE, card, data: base });
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    // Gladys refused (restarting?): a new card or a move is tried again at the
    // next reading (the card keeps its old list, or none, in memory); a due
    // event and the next ones too, within the hour (the time of the reading
    // stays before it).
    const instant = (key) => key === TRIGGERS.ADDED || key === TRIGGERS.MOVED;
    let readAt = now;
    for (const event of events.filter((item) => instant(item.key))) {
      if (!(await this.fire(event.key, event.data))) {
        if (known[event.card.id] === undefined) {
          delete lists[event.card.id];
        } else {
          lists[event.card.id] = known[event.card.id];
        }
      }
    }
    for (const event of events.filter((item) => !instant(item.key))) {
      if (!(await this.fire(event.key, event.data))) {
        readAt = event.at - 1;
        break;
      }
    }
    this.saved = { scope, readAt: Math.max(readAt, this.saved.readAt), lists, boards };
    this.store.save(this.saved);
  }

  eventData(card) {
    return {
      card: card.name,
      card_id: card.id,
      board: boardIds(this.gladys, card.boardId).device,
      board_name: this.boardTitle(card.boardId),
      list: this.listTitle(card.boardId, card.listId),
      due_date: iso(card.dueAt),
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A Wekan error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (!(err instanceof WekanError)) {
      return err;
    }
    const language = this.language;
    const colon = language === 'fr' ? ' : ' : ': ';
    const status = err.status ? ` (HTTP ${err.status})` : '';
    return new Error(`Wekan${colon}${pick(ERROR_TEXT[err.kind], language)}${status}`, {
      cause: err,
    });
  }

  fail(key) {
    return new Error(pick(ACTION_TEXT[key], this.language));
  }

  requireClient() {
    if (!this.client) {
      throw this.fail('notConfigured');
    }
    return this.client;
  }

  /** Read now and wait for it; a failed reading is the command's error. */
  async readNow() {
    this.requireClient();
    await this.poll();
    if (this.error) {
      throw this.explain(new WekanError(this.error.kind, this.error.message));
    }
  }

  /** Read again now, and wait for it a little (the toast should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** A board by id or name among every board the user sees; empty: the first followed. */
  async findBoard(query) {
    const boards = parseBoards(await this.requireClient().boards());
    if (String(query ?? '').trim() === '') {
      const first =
        boards.find((board) => this.followed.some((item) => item.id === board.id)) ?? boards[0];
      if (!first) {
        throw this.fail('noBoard');
      }
      return first;
    }
    const { item, reason } = findByIdOrName(boards, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'boardAmbiguous' : 'boardNotFound');
    }
    return item;
  }

  /** A list of a board by id or name; empty: the first list that is not a "done" one. */
  findList(lists, query) {
    if (String(query ?? '').trim() === '') {
      const first = lists.find((list) => !list.done) ?? lists[0];
      if (!first) {
        throw this.fail('noList');
      }
      return first;
    }
    const { item, reason } = findByIdOrName(lists, query);
    if (!item) {
      throw this.fail(reason === 'ambiguous' ? 'listAmbiguous' : 'listNotFound');
    }
    return item;
  }

  /**
   * The due date typed in a scene: ISO 8601 with its offset, a local
   * `YYYY-MM-DD HH:MM`, a local `YYYY-MM-DD` (noon), or from now, `+2h`,
   * `+30m`, `+3d` (`j` for jours too). Empty: none.
   * @returns {number|null} milliseconds
   */
  parseDue(raw) {
    const value = String(raw ?? '').trim();
    if (value === '') {
      return null;
    }
    const relative = value.match(/^\+\s*(\d{1,4})\s*(m|min|h|d|j)$/i);
    if (relative) {
      const unit = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, j: 86_400_000 };
      return this.now() + Number(relative[1]) * unit[relative[2].toLowerCase()];
    }
    const local = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
    if (local) {
      const [, y, mo, d, h = '12', mi = '00'] = local;
      const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
      if (date.getUTCMonth() !== Number(mo) - 1 || Number(h) > 23 || Number(mi) > 59) {
        throw this.fail('badDue');
      }
      return localTime(Number(y), Number(mo), Number(d), Number(h), Number(mi), this.timeZone);
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
    throw this.fail('badDue');
  }

  /** Create a card in a list, in the first swimlane of the board. */
  async addCard({ board: boardQuery, list: listQuery, title, due }) {
    const client = this.requireClient();
    const name = String(title ?? '').trim();
    if (!name) {
      throw this.fail('emptyTitle');
    }
    const dueAt = this.parseDue(due);
    const cardTitle = name.slice(0, MAX_CARD_NAME);
    let board;
    let list;
    let created;
    try {
      board = await this.findBoard(boardQuery);
      const raw = await client.board(board.id);
      list = this.findList(parseBoard(raw, board.id, this.config.doneLists).lists, listQuery);
      const swimlane = raw.swimlanes.find((item) => typeof item?._id === 'string');
      if (!swimlane) {
        throw this.fail('noList');
      }
      created = await client.createCard(board.id, list.id, {
        title: cardTitle,
        swimlaneId: swimlane._id,
        dueAt: dueAt === null ? undefined : iso(dueAt),
      });
    } catch (err) {
      throw this.explain(err);
    }
    logger.info(`Card ${created} added to list ${list.id} from Gladys`);
    await this.refreshSoon();
    return {
      card: cardTitle,
      card_id: created ?? '',
      board_name: board.name,
      list: list.name,
      due_date: iso(dueAt),
    };
  }

  /** Move a card (id or exact name, among the followed boards) to another list. */
  async moveCard({ card: cardQuery, list: listQuery, board: boardQuery }) {
    const client = this.requireClient();
    if (String(cardQuery ?? '').trim() === '') {
      throw this.fail('emptyCard');
    }
    if (String(listQuery ?? '').trim() === '') {
      throw this.fail('emptyList');
    }
    await this.readNow();
    let boards = this.followed;
    if (String(boardQuery ?? '').trim() !== '') {
      const { item, reason } = findByIdOrName(this.followed, boardQuery);
      if (!item) {
        throw this.fail(reason === 'ambiguous' ? 'boardAmbiguous' : 'boardNotFound');
      }
      boards = [item];
    }
    const cards = boards.flatMap((board) => board.cards);
    const { item: card, reason } = findByIdOrName(cards, cardQuery);
    if (!card) {
      throw this.fail(reason === 'ambiguous' ? 'cardAmbiguous' : 'cardNotFound');
    }
    const board = this.followed.find((item) => item.id === card.boardId);
    const list = this.findList(board.lists, listQuery);
    const previous = this.listTitle(board.id, card.listId);
    if (list.id !== card.listId) {
      try {
        await client.updateCard(board.id, card.listId, card.id, { listId: list.id });
      } catch (err) {
        throw this.explain(err);
      }
      logger.info(`Card ${card.id} moved to list ${list.id} from Gladys`);
      await this.refreshSoon();
    }
    return {
      card: card.name,
      card_id: card.id,
      board_name: board.name,
      list: list.name,
      previous_list: previous,
    };
  }

  /** Finish a card: its end date is now, as Wekan's "End" date (the widget buttons). */
  async completeCard(cardId) {
    const client = this.requireClient();
    const card = this.cards.find((item) => item.id === cardId);
    if (!card || !card.open) {
      this.poll().catch(() => {});
      throw this.fail('alreadyDone');
    }
    try {
      await client.updateCard(card.boardId, card.listId, card.id, { endAt: iso(this.now()) });
    } catch (err) {
      throw this.explain(err);
    }
    logger.info(`Card ${card.id} marked done from Gladys`);
    await this.refreshSoon();
    return card;
  }

  /**
   * Today's cards, as a sentence for a message or a voice announcement, for
   * every followed board or one (id or name).
   */
  async today(boardQuery) {
    await this.readNow();
    let board = null;
    if (String(boardQuery ?? '').trim() !== '') {
      const { item, reason } = findByIdOrName(this.followed, boardQuery);
      if (!item) {
        throw this.fail(reason === 'ambiguous' ? 'boardAmbiguous' : 'boardNotFound');
      }
      board = item;
    }
    const summary = this.summary(board);
    const texts = TODAY_TEXT[this.language] ?? TODAY_TEXT.en;
    const names = summary.agenda.slice(0, MAX_NAMES).map((card) => card.name);
    const more = summary.agenda.length - names.length;
    if (more > 0) {
      names.push(`+${more}`);
    }
    const text =
      summary.agenda.length === 0
        ? texts.none
        : texts.list(summary.agenda.length, names) +
          (summary.overdue > 0 ? texts.overdue(summary.overdue) : '');
    return {
      text: text.slice(0, 1000),
      count: summary.agenda.length,
      overdue: summary.overdue,
    };
  }

  /** The toast of a command, in the four languages. */
  static doneMessage(name) {
    return allLanguages((language) => DONE_TEXT[language](name).slice(0, 200));
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      const message = allLanguages((language) =>
        REPORT_TEXT[language].failed(pick(status.message, language)),
      );
      throw new Error(message[this.language]);
    }
    const open = this.cards.filter((card) => card.open).length;
    return allLanguages((language) => {
      const unknown =
        this.unknownBoards.length > 0
          ? ` ${UNKNOWN_BOARDS[language](this.unknownBoards.join(', '))}`
          : '';
      return `${REPORT_TEXT[language].ok(open, this.followed.length)}${unknown}`;
    });
  }
}
