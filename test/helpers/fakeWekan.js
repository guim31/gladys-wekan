// -----------------------------------------------------------------------------
// An in-memory Wekan, answering the routes the integration calls the way the
// real server does (status codes and `{ error }` bodies, the login, an
// unknown list answered `[]`, the web app's HTML page outside the API). Its
// starting data are real answers of wekanteam/wekan (image of 30/10/2026) in
// Docker (test/fixtures/wekan/real-*.json), captured on 30/10/2026 at 01:51
// UTC: two boards. "Tâches de la maison" holds four lists (À faire, En cours,
// Bloqué, Fait) and two swimlanes (Default, Jardin), nine cards: two overdue,
// two due on the day of the capture (one with an end date), two tomorrow, one
// later, one undated, one in the "Fait" list. An archived card is left out by
// the server. "Courses": one list, one card.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/wekan/${name}.json`, import.meta.url), 'utf8'));

export const USERNAME = 'demo';
export const EMAIL = 'demo@example.org';
export const PASSWORD = 'Demo-Passw0rd';

export const BOARD_ID = 'HnnkahS2jScztcMoo';
export const COURSES_ID = 'TsmrCkDq2hKt2hKEb';
export const LISTS = Object.freeze({
  TODO: 'rycDr82hf3XziKbun',
  DOING: '5zHSvoncj8vK8TqTE',
  BLOCKED: '3bmuvQ4DsZtkqGyuA',
  DONE: 'vQ5jrZvQGgr9tYB8d',
});
export const SWIMLANES = Object.freeze({
  DEFAULT: '4bbXYywWivtbLMr37',
  GARDEN: 'sXzyixJzRcCSnywbn',
});

const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});
const unauthorized = () => json(401, { error: 'Unauthorized' });

export class FakeWekan {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    const login = fixture('real-login');
    this.userId = login.id;
    this.boardList = fixture('real-boards');
    const cardsOf = (answer, swimlaneId) => answer.map((card) => ({ ...card, swimlaneId }));
    this.boards = new Map([
      [
        BOARD_ID,
        {
          lists: fixture('real-lists'),
          swimlanes: fixture('real-swimlanes'),
          cards: [
            ...cardsOf(fixture('real-cards-default'), SWIMLANES.DEFAULT),
            ...cardsOf(fixture('real-cards-jardin'), SWIMLANES.GARDEN),
          ],
        },
      ],
      [
        COURSES_ID,
        {
          lists: fixture('real-courses-lists'),
          swimlanes: fixture('real-courses-swimlanes'),
          cards: cardsOf(fixture('real-courses-cards'), 'eQTRN8QKWnxdxZqbA'),
        },
      ],
    ]);
    this.online = true;
    /** The user may read but not write (a read-only board member). */
    this.readOnly = false;
    /** The API is off (WITH_API=false): the web app answers everywhere. */
    this.apiOff = false;
    this.tokens = new Set();
    this.logins = 0;
    this.requests = [];
    this.nextId = 1;
  }

  /** Every card of every board. */
  allCards() {
    return [...this.boards.values()].flatMap((board) => board.cards);
  }

  card(idOrTitle) {
    return this.allCards().find((card) => card._id === idOrTitle || card.title === idOrTitle);
  }

  /** What the web app does when a card is dragged to another list. */
  move(title, listId) {
    const card = this.card(title);
    card.listId = listId;
    card.sort = -1;
  }

  /** What the web app does when a card is archived (the API leaves it out). */
  archive(title) {
    for (const board of this.boards.values()) {
      board.cards = board.cards.filter((card) => card.title !== title);
    }
  }

  /** A card added from the web app. */
  add(boardId, listId, title, fields = {}) {
    const board = this.boards.get(boardId);
    const card = {
      _id: `fakeCard${String(this.nextId++).padStart(9, '0')}`,
      title,
      description: '',
      listId,
      ...fields,
      assignees: [],
      sort: board.cards.filter((item) => item.listId === listId).length,
      swimlaneId: board.swimlanes[0]._id,
    };
    board.cards.push(card);
    return card;
  }

  /** Every session ends (the token expired). */
  revokeTokens() {
    this.tokens.clear();
  }

  authorized(headers) {
    const match = /^Bearer (.+)$/.exec(headers.authorization ?? '');
    return Boolean(match && this.tokens.has(match[1]));
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname } = new URL(url);
    this.requests.push({ method, path: pathname, body });
    const html = { status: 200, headers: { 'content-type': 'text/html' }, body: '<!DOCTYPE html>' };
    if (this.apiOff || !(pathname.startsWith('/api/') || pathname === '/users/login')) {
      return html;
    }
    if (method === 'POST' && pathname === '/users/login') {
      const who = body?.username ?? body?.email;
      if (typeof body?.password !== 'string') {
        return json(401, { error: "Match error: Missing key 'password'" });
      }
      if (
        !(who === USERNAME || (body.email !== undefined && who === EMAIL)) ||
        body.password !== PASSWORD
      ) {
        return json(401, {
          error: 'login-failed',
          reason: 'Incorrect username, email address or password.',
        });
      }
      this.logins += 1;
      const token = `fakeToken${this.logins}`;
      this.tokens.add(token);
      return json(200, { id: this.userId, token, tokenExpires: '2027-01-28T01:51:10.000Z' });
    }
    if (!this.authorized(headers)) {
      return unauthorized();
    }
    const userBoards = pathname.match(/^\/api\/users\/([^/]+)\/boards$/);
    const lists = pathname.match(/^\/api\/boards\/([^/]+)\/lists$/);
    const swimlanes = pathname.match(/^\/api\/boards\/([^/]+)\/swimlanes$/);
    const swimlaneCards = pathname.match(/^\/api\/boards\/([^/]+)\/swimlanes\/([^/]+)\/cards$/);
    const listCards = pathname.match(/^\/api\/boards\/([^/]+)\/lists\/([^/]+)\/cards$/);
    const card = pathname.match(/^\/api\/boards\/([^/]+)\/lists\/([^/]+)\/cards\/([^/]+)$/);
    const board = this.boards.get((lists ?? swimlanes ?? swimlaneCards ?? listCards ?? card)?.[1]);

    if (method === 'GET' && userBoards) {
      return userBoards[1] === this.userId
        ? json(200, this.boardList)
        : json(401, { error: 'Unauthorized' });
    }
    if ((lists || swimlanes || swimlaneCards || listCards || card) && !board) {
      return json(404, { error: 'Board not found' });
    }
    if (method === 'GET' && lists) {
      return json(200, board.lists);
    }
    if (method === 'GET' && swimlanes) {
      return json(200, board.swimlanes);
    }
    if (method === 'GET' && swimlaneCards) {
      return json(
        200,
        board.cards
          .filter((item) => item.swimlaneId === swimlaneCards[2])
          .map(({ swimlaneId: _swimlane, ...rest }) => rest),
      );
    }
    if (method === 'POST' && listCards) {
      if (!board.lists.some((list) => list._id === listCards[2])) {
        return json(400, { error: 'listId does not belong to this board.' });
      }
      if (this.readOnly) {
        return json(403, { error: 'Forbidden' });
      }
      const created = this.add(listCards[1], listCards[2], body.title);
      created.swimlaneId = body.swimlaneId;
      return json(200, { _id: created._id });
    }
    if (method === 'PUT' && card) {
      const target = board.cards.find((item) => item._id === card[3]);
      if (!target) {
        return json(404, { error: 'Card not found' });
      }
      if (this.readOnly) {
        return json(403, { error: 'Forbidden' });
      }
      if (body.listId !== undefined) {
        if (!board.lists.some((list) => list._id === body.listId)) {
          return json(400, { error: 'listId does not belong to this board.' });
        }
        target.listId = body.listId;
        target.sort = -1;
      }
      for (const key of ['title', 'dueAt', 'endAt']) {
        if (body[key] !== undefined) {
          target[key] = body[key];
        }
      }
      return json(200, { _id: target._id });
    }
    return html;
  }
}

/** The network: one fake server per base URL; anything else does not answer. */
export function createNetwork(servers) {
  return {
    servers,
    async request(url, options = {}) {
      const base = Object.keys(servers).find((origin) => url.startsWith(`${origin}/`));
      const server = base ? servers[base] : null;
      if (!server || !server.online) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return server.handle(url, options);
    },
  };
}
