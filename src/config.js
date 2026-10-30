// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Wekan instance (its address, and the username and password of one of
// its users), read on a timer of the container.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  boards: '',
  done_lists: 'Done, Fait, Terminé, Erledigt, Hecho',
  allow_self_signed: false,
  poll_interval: '300',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:3000`), or the URL copied from the browser
 * (`https://kanban.example.org/b/HnnkahS2jScztcMoo/maison`). HTTP by default.
 * A path prefix is kept (Wekan behind a reverse proxy under `/wekan`), the
 * API path and the known screens of the web app are dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/prefix]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/api(\/.*)?$/, '')
    .replace(/\/(b|sign-in|sign-up|admin-panel|my-cards|due-cards|globalsearch)(\/.*)?$/, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * A list of names or ids, as typed, separated by commas or semicolons (the
 * boards to follow, the "done" lists).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseNameList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

const bool = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const poll = String(source.poll_interval ?? '');
  return {
    url: parseServerUrl(typed),
    urlTyped: typed !== '',
    // The password is kept as typed, blanks included.
    username: typeof source.username === 'string' ? source.username.trim() : '',
    password: typeof source.password === 'string' ? source.password : '',
    boards: parseNameList(source.boards),
    // Absent from an old configuration: the default; emptied by the user: none.
    doneLists: parseNameList(
      typeof source.done_lists === 'string' ? source.done_lists : DEFAULT_CONFIG.done_lists,
    ),
    allowSelfSigned: bool(source.allow_self_signed),
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(poll) ? poll : DEFAULT_CONFIG.poll_interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
