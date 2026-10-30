// -----------------------------------------------------------------------------
// Gladys devices: one per followed Wekan board.
//
// Identity: `board` / `board-<id>`, the id Wekan gives the board (stable,
// never its name): renaming a board keeps its device. A list feature is keyed
// by the id of the list the same way.
//
// Features (category/type couples of the core table, test/gladys-rules.test.js),
// definitions in src/wekan/model.js:
//   - open cards, due today, overdue, done: counter-sensor/integer;
//   - one counter per list that is not a "done" list, the first five from
//     the left (the cards it holds), named after the list;
//   - next due date: text/text, the card and its date ("None" when nothing is
//     planned: a text state is never empty).
//
// The devices are published with should_poll: false: the integration reads
// Wekan on its own timer (src/hub.js), every 1 to 10 minutes.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const BOARD_TYPE = 'board';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  OPEN: 'open',
  DUE_TODAY: 'due_today',
  OVERDUE: 'overdue',
  NEXT_DUE: 'next_due',
  DONE: 'done',
});
export const listFeatureKey = (listId) => `list-${listId}`;
// The lists with a counter: the first ones that are not "done" lists.
export const MAX_LIST_FEATURES = 5;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.OPEN]: 'Open cards',
    [FEATURE_KEYS.DUE_TODAY]: 'Cards due today',
    [FEATURE_KEYS.OVERDUE]: 'Overdue cards',
    [FEATURE_KEYS.NEXT_DUE]: 'Next due date',
    [FEATURE_KEYS.DONE]: 'Done cards',
  },
  fr: {
    [FEATURE_KEYS.OPEN]: 'Cartes ouvertes',
    [FEATURE_KEYS.DUE_TODAY]: "Cartes dues aujourd'hui",
    [FEATURE_KEYS.OVERDUE]: 'Cartes en retard',
    [FEATURE_KEYS.NEXT_DUE]: 'Prochaine échéance',
    [FEATURE_KEYS.DONE]: 'Cartes terminées',
  },
  de: {
    [FEATURE_KEYS.OPEN]: 'Offene Karten',
    [FEATURE_KEYS.DUE_TODAY]: 'Heute fällige Karten',
    [FEATURE_KEYS.OVERDUE]: 'Überfällige Karten',
    [FEATURE_KEYS.NEXT_DUE]: 'Nächste Fälligkeit',
    [FEATURE_KEYS.DONE]: 'Erledigte Karten',
  },
  es: {
    [FEATURE_KEYS.OPEN]: 'Tarjetas abiertas',
    [FEATURE_KEYS.DUE_TODAY]: 'Tarjetas para hoy',
    [FEATURE_KEYS.OVERDUE]: 'Tarjetas atrasadas',
    [FEATURE_KEYS.NEXT_DUE]: 'Próximo vencimiento',
    [FEATURE_KEYS.DONE]: 'Tarjetas terminadas',
  },
};

// Published on "next due date" when no open card has a due date ahead.
export const NO_CARD = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 10000;
const TEXT_MAX_LENGTH = 100;
const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

const COUNTER = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: COUNTER_MAX,
};

const TEXT = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
  // NOT NULL in the core, even for a text (422 on "Add to Gladys" otherwise).
  min: 0,
  max: 0,
};

export const boardIds = (gladys, boardId) => gladys.externalIds(BOARD_TYPE, `board-${boardId}`);

/** The lists that get a counter: the first five that are not "done" lists. */
export const counterLists = (lists) =>
  lists.filter((list) => !list.done).slice(0, MAX_LIST_FEATURES);

export const boardName = (name) => `Wekan ${name}`.slice(0, 60);

/**
 * @param {object} gladys
 * @param {{ id: string, name: string, lists: Array<{ id: string, name: string, done: boolean }> }} board
 * @param {string} [language]
 */
export function buildBoard(gladys, board, language = 'en') {
  const ids = boardIds(gladys, board.id);
  const names = NAMES[language] ?? NAMES.en;
  const taken = new Set(Object.values(names));
  const features = [
    { ...COUNTER, name: names.open, external_id: ids.feature(FEATURE_KEYS.OPEN) },
    { ...COUNTER, name: names.due_today, external_id: ids.feature(FEATURE_KEYS.DUE_TODAY) },
    { ...COUNTER, name: names.overdue, external_id: ids.feature(FEATURE_KEYS.OVERDUE) },
    { ...COUNTER, name: names.done, external_id: ids.feature(FEATURE_KEYS.DONE) },
  ];
  for (const list of counterLists(board.lists)) {
    // Two lists may share a name, or a list be called like a counter.
    let name = list.name.slice(0, 50);
    for (let n = 2; taken.has(name); n += 1) {
      name = `${list.name.slice(0, 45)} (${n})`;
    }
    taken.add(name);
    features.push({ ...COUNTER, name, external_id: ids.feature(listFeatureKey(list.id)) });
  }
  features.push({ ...TEXT, name: names.next_due, external_id: ids.feature(FEATURE_KEYS.NEXT_DUE) });
  return {
    name: boardName(board.name),
    external_id: ids.device,
    should_poll: false,
    features,
  };
}

/** "Card · Fri 24 Oct, 18:00", in the language of the feature names. */
export function nextDueText(summary, { language, timeZone }) {
  if (!summary.next) {
    return NO_CARD[language] ?? NO_CARD.en;
  }
  const when = new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(summary.next.dueAt));
  const room = TEXT_MAX_LENGTH - when.length - 3;
  const name =
    summary.next.name.length > room
      ? `${summary.next.name.slice(0, room - 1).trimEnd()}…`
      : summary.next.name;
  return `${name} · ${when}`;
}

/**
 * The states of every feature of a board device, in the `publishStates`
 * format: `state` for a number, `text` for a text.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function featureStates(gladys, board, summary, { language, timeZone }) {
  const ids = boardIds(gladys, board.id);
  const counter = (key, value) => ({
    device_feature_external_id: ids.feature(key),
    state: Math.min(COUNTER_MAX, value),
  });
  return [
    counter(FEATURE_KEYS.OPEN, summary.open),
    counter(FEATURE_KEYS.DUE_TODAY, summary.dueToday),
    counter(FEATURE_KEYS.OVERDUE, summary.overdue),
    counter(FEATURE_KEYS.DONE, summary.done),
    ...counterLists(board.lists).map((list) =>
      counter(listFeatureKey(list.id), summary.perList.get(list.id) ?? 0),
    ),
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.NEXT_DUE),
      text: nextDueText(summary, { language, timeZone }),
    },
  ];
}
