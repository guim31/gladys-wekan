// -----------------------------------------------------------------------------
// From the raw Wekan answers to what Gladys shows: boards, lists and cards
// with their due time in milliseconds, and the counters of a local day (the
// time zone of Gladys, injected by the supervisor as TZ).
//
// Definitions, the same in the devices, the widget, the scene actions and the
// documentation:
//   - done card: a card with an end date (Wekan's "End" date), or in one of
//     the "done" lists of the configuration (Done, Fait…);
//   - open card: any other card that is not archived (Wekan's API leaves out
//     the archived cards and those of archived lists);
//   - overdue: an open card whose due date has passed;
//   - due today: an open card whose due date falls in the local day, passed
//     or not;
//   - next due date: the earliest due date of an open card still ahead.
// -----------------------------------------------------------------------------

const time = (value) => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
// Wekan ids are Meteor ids: 17 letters and digits.
const idOf = (value) => (typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : null);
const sortOf = (value) => (Number.isFinite(value) ? value : Infinity);

export const fold = (value) =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Every board of the user, in the order Wekan gives them.
 * @param {unknown} raw answer of GET /api/users/:id/boards
 * @returns {Array<{ id: string, name: string }>}
 */
export function parseBoards(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .filter((board) => idOf(board?._id) && !seen.has(board._id) && seen.add(board._id))
    .filter((board) => board.archived !== true && board.type !== 'template-container')
    .map((board) => ({ id: board._id, name: text(board.title) || `#${board._id}` }));
}

/**
 * The lists (in the order of the board) and the cards of a board.
 * @param {{ lists: unknown[], cards: unknown[] }} raw see WekanClient.board
 * @param {string} boardId
 * @param {string[]} [doneLists] names of the lists whose cards are done
 */
export function parseBoard(raw, boardId, doneLists = []) {
  const done = new Set(doneLists.map(fold));
  const lists = (Array.isArray(raw?.lists) ? raw.lists : [])
    .filter((list) => idOf(list?._id) && list.archived !== true)
    .map((list) => {
      const name = text(list.title) || `#${list._id}`;
      return { id: list._id, name, done: done.has(fold(name)) };
    });
  const byId = new Map(lists.map((list) => [list.id, list]));
  const seen = new Set();
  const cards = (Array.isArray(raw?.cards) ? raw.cards : [])
    .filter((card) => idOf(card?._id) && byId.has(card.listId) && card.archived !== true)
    .filter((card) => !seen.has(card._id) && seen.add(card._id))
    .map((card) => {
      const endAt = time(card.endAt);
      const isDone = endAt !== null || byId.get(card.listId).done;
      return {
        id: card._id,
        name: text(card.title) || `#${card._id}`,
        boardId,
        listId: card.listId,
        swimlaneId: idOf(card.swimlaneId),
        open: !isDone,
        dueAt: time(card.dueAt),
        endAt,
        sort: sortOf(card.sort),
      };
    })
    .sort(
      (a, b) =>
        (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
        a.sort - b.sort ||
        a.id.localeCompare(b.id),
    );
  return { id: boardId, lists, cards };
}

/** The due time that still matters: the one of an open card. */
export const pendingDue = (card) => (card.open && card.dueAt !== null ? card.dueAt : null);

// --- Local days -------------------------------------------------------------------

const partsFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = partsFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return parts;
}

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight of a local calendar day (DST-safe). */
function localMidnight(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  let start = guess - offsetAt(first, timeZone);
  // Where the clocks jump at midnight (Chile, Cuba), 00:00 does not exist and
  // the instant found is 23:00 the day before: the day starts an hour later.
  if (zonedParts(start, timeZone).day !== day) {
    start += 60 * 60_000;
  }
  return start;
}

/** UTC instant of a local wall-clock time (in a DST overlap, one of the two). */
export function localTime(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** A time zone Intl knows, else the one of the process. */
export function resolveTimeZone(timeZone) {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Start and end (exclusive) of the local day holding `now`. */
export function localDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

// --- Counters ---------------------------------------------------------------------

/**
 * Counters of one day, for a set of cards (one board, or every followed one).
 * @param {ReturnType<typeof parseBoard>['cards']} cards
 * @param {{ now: number, day: { start: number, end: number } }} options
 */
export function summarize(cards, { now, day }) {
  const open = cards.filter((card) => card.open);
  const dated = open
    .filter((card) => pendingDue(card) !== null)
    .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  const perList = new Map();
  for (const card of cards) {
    perList.set(card.listId, (perList.get(card.listId) ?? 0) + 1);
  }
  return {
    open: open.length,
    done: cards.length - open.length,
    overdue: dated.filter((card) => card.dueAt < now).length,
    dueToday: dated.filter((card) => card.dueAt >= day.start && card.dueAt < day.end).length,
    perList,
    next: dated.find((card) => card.dueAt >= now) ?? null,
    // What is left by tonight: overdue first, then today's, by due time.
    agenda: dated.filter((card) => card.dueAt < day.end),
  };
}

/**
 * Find an item by its id (as Wekan shows it in its addresses) or its exact
 * name (case, accents and repeated blanks ignored).
 * @template {{ id: string, name: string }} T
 * @param {T[]} items
 * @param {unknown} query
 * @returns {{ item: T|null, reason?: 'empty'|'not_found'|'ambiguous' }}
 */
export function findByIdOrName(items, query) {
  const wanted = String(query ?? '').trim();
  if (!wanted) {
    return { item: null, reason: 'empty' };
  }
  const byId = items.find((item) => item.id === wanted);
  if (byId) {
    return { item: byId };
  }
  const matches = items.filter((item) => fold(item.name) === fold(wanted));
  if (matches.length === 1) {
    return { item: matches[0] };
  }
  return { item: null, reason: matches.length > 1 ? 'ambiguous' : 'not_found' };
}
