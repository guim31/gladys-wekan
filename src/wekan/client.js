// -----------------------------------------------------------------------------
// Wekan REST API client: the calls the integration needs. Checked against a
// real wekanteam/wekan (image `latest` of 30/10/2026) with MongoDB 7 in
// Docker, October 2026.
//
// Authentication: the username (or e-mail) and password of a Wekan user with
// a password account. `POST /users/login` gives `{ id, token, tokenExpires }`
// (90 days), sent as `Authorization: Bearer`. The token and the user id are
// kept in memory; a 401 logs in again, once.
//
//   POST /users/login                                    { username|email, password }
//   GET  /api/users/:userId/boards                       [{ _id, title }]
//   GET  /api/boards/:board/lists                        [{ _id, title }] (not archived)
//   GET  /api/boards/:board/swimlanes                    [{ _id, title }]
//   GET  /api/boards/:board/swimlanes/:swimlane/cards    [{ _id, title, listId, dueAt?, endAt?, sort }]
//   POST /api/boards/:board/lists/:list/cards            { title, authorId, swimlaneId } → { _id }
//   PUT  /api/boards/:board/lists/:list/cards/:card      { listId?, dueAt?, endAt? } → { _id }
//
// Pitfalls found on the real server:
//   - `GET …/lists/:list/cards` gives neither the due nor the end date: the
//     cards are read per swimlane, whose answer has them (and `listId`). It
//     leaves out the archived cards and those of archived lists.
//   - An unknown list answers `[]` with a 200, an unknown board a 404.
//   - Outside the API routes, the web app answers its HTML page with a 200,
//     any path (also when the API is off, WITH_API=false); a POST there
//     answers 405, HTML too.
//   - A wrong password answers 401 `{ error: "login-failed" }`.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // wrong username or password
  FORBIDDEN: 'forbidden', // the user may not do this
  NOT_FOUND: 'not_found', // the board, list or card is gone
  NOT_WEKAN: 'not_wekan', // something answers, but not the Wekan API
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  RATE_LIMIT: 'rate_limit', // 429: a reverse proxy's request limit
  HTTP: 'http', // any other unexpected answer
});

export class WekanError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'WekanError';
    this.kind = kind;
    this.status = status;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new WekanError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new WekanError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

const id = (value) => encodeURIComponent(String(value));

export class WekanClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, without trailing slash
   * @param {string} options.username username or e-mail
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/wekan/http.js)
   */
  constructor({ url, username = '', password = '', insecure = false, request }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request ?? httpRequest;
    /** `{ token, userId }` of the login, null until asked. */
    this.session = null;
    this.loggingIn = null;
  }

  async send(path, { method = 'GET', json, headers = {} } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        json,
        insecure: this.insecure,
        headers,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    let parsed;
    let parsedOk = true;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsedOk = false;
    }
    // The server's own message, short; it never echoes a secret.
    const said =
      parsedOk && typeof parsed?.error === 'string' ? ` ${parsed.error.slice(0, 200)}` : '';
    if (status === 429) {
      throw new WekanError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', status);
    }
    if (status >= 300 && status < 400) {
      throw new WekanError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    if (!parsedOk) {
      // The web app answers its HTML page on paths outside the API (a 405 to
      // a POST there, as the login under a wrong path prefix).
      throw new WekanError(
        status < 500 ? ERROR_KINDS.NOT_WEKAN : ERROR_KINDS.HTTP,
        `HTTP ${status}, not JSON`,
        status,
      );
    }
    if (status === 401) {
      throw new WekanError(ERROR_KINDS.AUTH, `HTTP 401${said}`, status);
    }
    if (status === 403) {
      throw new WekanError(ERROR_KINDS.FORBIDDEN, `HTTP 403${said}`, status);
    }
    if (status === 404) {
      throw new WekanError(ERROR_KINDS.NOT_FOUND, `HTTP 404${said}`, status);
    }
    if (status < 200 || status >= 300) {
      throw new WekanError(ERROR_KINDS.HTTP, `HTTP ${status}${said}`, status);
    }
    return parsed;
  }

  /** The password login; one at a time. */
  login() {
    this.loggingIn ??= (async () => {
      try {
        const json = this.username.includes('@')
          ? { email: this.username, password: this.password }
          : { username: this.username, password: this.password };
        const data = await this.send('/users/login', { method: 'POST', json });
        if (typeof data?.token !== 'string' || data.token === '' || typeof data.id !== 'string') {
          throw new WekanError(ERROR_KINDS.NOT_WEKAN, 'no token in /users/login', 200);
        }
        this.session = { token: data.token, userId: data.id };
        return this.session;
      } catch (err) {
        // A login refused for a missing route: never "not found".
        if (err instanceof WekanError && err.kind === ERROR_KINDS.NOT_FOUND) {
          throw new WekanError(ERROR_KINDS.NOT_WEKAN, 'no /users/login', 404);
        }
        throw err;
      } finally {
        this.loggingIn = null;
      }
    })();
    return this.loggingIn;
  }

  /** An authenticated call; a session that expired logs in again, once. */
  async call(path, options = {}) {
    const session = this.session ?? (await this.login());
    const bearer = (token) => ({ authorization: `Bearer ${token}` });
    try {
      return await this.send(path, { ...options, headers: bearer(session.token) });
    } catch (err) {
      if (!(err instanceof WekanError) || err.kind !== ERROR_KINDS.AUTH) {
        throw err;
      }
      if (this.session === session) {
        this.session = null;
      }
      const fresh = this.session ?? (await this.login());
      return this.send(path, { ...options, headers: bearer(fresh.token) });
    }
  }

  /** The id of the logged-in user (the author of the cards created). */
  async userId() {
    return (this.session ?? (await this.login())).userId;
  }

  /** An array answer, else "not Wekan" (another JSON API, a missing path prefix). */
  async list(path) {
    const data = await this.call(path);
    if (!Array.isArray(data)) {
      throw new WekanError(ERROR_KINDS.NOT_WEKAN, `no array in ${path.split('/')[1]}`, 200);
    }
    return data;
  }

  /** The boards of the user (not archived, no templates). */
  async boards() {
    const userId = await this.userId();
    try {
      return await this.list(`/api/users/${id(userId)}/boards`);
    } catch (err) {
      if (err instanceof WekanError && err.kind === ERROR_KINDS.NOT_FOUND) {
        throw new WekanError(ERROR_KINDS.NOT_WEKAN, 'no /api/users/:id/boards', 404);
      }
      throw err;
    }
  }

  /** A board's lists, swimlanes and the cards of every swimlane. */
  async board(boardId) {
    const base = `/api/boards/${id(boardId)}`;
    const lists = await this.list(`${base}/lists`);
    const swimlanes = await this.list(`${base}/swimlanes`);
    const cards = [];
    for (const swimlane of swimlanes) {
      if (typeof swimlane?._id !== 'string') {
        continue;
      }
      const answer = await this.list(`${base}/swimlanes/${id(swimlane._id)}/cards`);
      cards.push(...answer.map((card) => ({ ...card, swimlaneId: swimlane._id })));
    }
    return { lists, swimlanes, cards };
  }

  /** Create a card in a list; `dueAt` an ISO string or omitted. Returns its id. */
  async createCard(boardId, listId, { title, swimlaneId, dueAt }) {
    const authorId = await this.userId();
    const data = await this.call(`/api/boards/${id(boardId)}/lists/${id(listId)}/cards`, {
      method: 'POST',
      json: { title, authorId, swimlaneId, description: '' },
    });
    const cardId = typeof data?._id === 'string' ? data._id : null;
    if (cardId && dueAt) {
      // Set apart: older Wekan versions ignore the dates on creation.
      await this.updateCard(boardId, listId, cardId, { dueAt });
    }
    return cardId;
  }

  /** Change some fields of a card (`listId` moves it); Wekan keeps the others. */
  async updateCard(boardId, listId, cardId, fields) {
    await this.call(`/api/boards/${id(boardId)}/lists/${id(listId)}/cards/${id(cardId)}`, {
      method: 'PUT',
      json: fields,
    });
  }
}
