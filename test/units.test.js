// -----------------------------------------------------------------------------
// Unit tests of the pure parts: the address and the board list typed by the
// user, the parsing of real Wekan answers, the counters, the search by id or
// name, the due dates typed in a scene.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, normalizeConfig, parseNameList, parseServerUrl } from '../src/config.js';
import {
  findByIdOrName,
  localDay,
  localTime,
  parseBoard,
  parseBoards,
  summarize,
} from '../src/wekan/model.js';
import { WekanClient, WekanError } from '../src/wekan/client.js';
import { START, createWorld } from './helpers/world.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/wekan/${name}.json`, import.meta.url), 'utf8'));

test('the address: bare host, copied browser URL, API URL, reverse proxy prefix', () => {
  assert.equal(parseServerUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl(' https://kanban.example.org/b/HnnkahS2jScztcMoo/taches-de-la-maison '),
    'https://kanban.example.org',
  );
  assert.equal(parseServerUrl('http://192.0.2.10:8080/api/boards/x'), 'http://192.0.2.10:8080');
  assert.equal(parseServerUrl('https://example.org/wekan/sign-in'), 'https://example.org/wekan');
  assert.equal(parseServerUrl('https://user:pass@example.org'), null, 'no credentials');
  assert.equal(parseServerUrl('ftp://example.org'), null);
  assert.equal(parseServerUrl(''), null);
});

test('the followed boards and the defaults', () => {
  assert.deepEqual(parseNameList(' Maison ; Courses,,Maison\n'), ['Maison', 'Courses']);
  const config = normalizeConfig({ url: 'x.example', password: ' with blanks ' });
  assert.equal(config.password, ' with blanks ', 'a password is kept as typed');
  assert.equal(config.language, DEFAULT_CONFIG.language);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ poll_interval: '42' }).pollIntervalMs, 300_000);
  assert.deepEqual(config.doneLists, ['Done', 'Fait', 'Terminé', 'Erledigt', 'Hecho']);
  assert.deepEqual(normalizeConfig({ done_lists: ' ' }).doneLists, [], 'emptied: none');
});

test('real boards: in the order Wekan gives them; archived and templates left out', () => {
  assert.deepEqual(parseBoards(fixture('real-boards')), [
    { id: 'HnnkahS2jScztcMoo', name: 'Tâches de la maison' },
    { id: 'TsmrCkDq2hKt2hKEb', name: 'Courses' },
  ]);
  assert.deepEqual(
    parseBoards([
      { _id: 'a1', title: 'Old', archived: true },
      { _id: 'a2', title: 'Templates', type: 'template-container' },
      { _id: 'a3', title: ' ' },
    ]),
    [{ id: 'a3', name: '#a3' }],
  );
  assert.deepEqual(parseBoards({}), []);
});

const realBoard = () => ({
  lists: fixture('real-lists'),
  cards: [
    ...fixture('real-cards-default').map((card) => ({ ...card, swimlaneId: '4bbXYywWivtbLMr37' })),
    ...fixture('real-cards-jardin').map((card) => ({ ...card, swimlaneId: 'sXzyixJzRcCSnywbn' })),
  ],
});

test('a real board: its lists in order, the "done" list, the end dates', () => {
  const board = parseBoard(realBoard(), 'HnnkahS2jScztcMoo', ['done', 'FAIT']);
  assert.deepEqual(
    board.lists.map((list) => [list.name, list.done]),
    [
      ['À faire', false],
      ['En cours', false],
      ['Bloqué', false],
      ['Fait', true],
    ],
  );
  assert.equal(board.cards.length, 9);
  assert.equal(board.cards.find((card) => card.name === 'Vider le lave-vaisselle').open, false);
  const ended = board.cards.find((card) => card.name === 'Changer les draps');
  assert.equal(ended.open, false);
  assert.equal(ended.endAt, Date.parse('2026-10-30T01:41:10.000Z'));
  const garden = board.cards.find((card) => card.name === 'Tondre la pelouse');
  assert.equal(garden.swimlaneId, 'sXzyixJzRcCSnywbn');
  assert.equal(parseBoard(realBoard(), 'b', []).cards.filter((card) => card.open).length, 8);
  const orphan = parseBoard({ lists: [], cards: fixture('real-cards-default') }, 'b');
  assert.deepEqual(orphan.cards, [], 'a card of an unknown (archived) list is left out');
});

test('the counters of a day', () => {
  const { cards } = parseBoard(realBoard(), 'b', ['Fait']);
  const summary = summarize(cards, { now: START, day: localDay(START, 'Europe/Paris') });
  assert.equal(summary.open, 7);
  assert.equal(summary.done, 2);
  assert.equal(summary.overdue, 2);
  assert.equal(summary.dueToday, 2);
  assert.equal(summary.next.name, 'Arroser les plantes');
  assert.deepEqual(
    summary.agenda.map((card) => card.name),
    ['Sortir les poubelles', 'Payer la cantine', 'Arroser les plantes'],
  );
});

test('find by id or exact name', () => {
  const items = [
    { id: 'HnnkahS2jScztcMoo', name: 'Tâches de la maison' },
    { id: 'a12', name: 'Courses' },
    { id: 'a13', name: 'courses ' },
  ];
  assert.equal(findByIdOrName(items, 'taches  DE la maison').item.id, 'HnnkahS2jScztcMoo');
  assert.equal(findByIdOrName(items, 'HnnkahS2jScztcMoo').item.name, 'Tâches de la maison');
  assert.equal(findByIdOrName(items, 'Courses').reason, 'ambiguous');
  assert.equal(findByIdOrName(items, ' ').reason, 'empty');
  assert.equal(findByIdOrName(items, 'Jardin').reason, 'not_found');
});

test('local wall-clock times, across a DST change', () => {
  // 25/10/2026: Paris goes back from UTC+2 to UTC+1 at 03:00.
  assert.equal(
    new Date(localTime(2026, 10, 24, 18, 0, 'Europe/Paris')).toISOString(),
    '2026-10-24T16:00:00.000Z',
  );
  assert.equal(
    new Date(localTime(2026, 10, 25, 12, 0, 'Europe/Paris')).toISOString(),
    '2026-10-25T11:00:00.000Z',
  );
  assert.equal(
    new Date(localTime(2026, 3, 29, 12, 0, 'Europe/Paris')).toISOString(),
    '2026-03-29T10:00:00.000Z',
  );
});

test('the client: an unknown route is no Wekan, a 400 is an HTTP error', async () => {
  const answer = (status, body) => async (url) =>
    url.endsWith('/users/login')
      ? { status: 200, headers: {}, body: JSON.stringify({ id: 'u1', token: 't1' }) }
      : { status, headers: {}, body: JSON.stringify(body) };
  const client = (request) =>
    new WekanClient({ url: 'http://x', username: 'demo', password: 'p', request });
  await assert.rejects(client(answer(404, { error: 'Not Found' })).boards(), {
    kind: 'not_wekan',
  });
  await assert.rejects(client(answer(200, { error: 'x' })).boards(), { kind: 'not_wekan' });
  await assert.rejects(
    client(answer(400, { error: 'listId does not belong to this board.' })).createCard('b', 'l', {
      title: 'x',
      swimlaneId: 's',
    }),
    (err) => err instanceof WekanError && err.kind === 'http' && /listId/.test(err.message),
  );
  await assert.rejects(client(answer(429, {})).boards(), { kind: 'rate_limit' });
  await assert.rejects(client(answer(302, {})).boards(), { kind: 'redirect' });
  await assert.rejects(client(answer(404, { error: 'Board not found' })).board('b'), {
    kind: 'not_found',
  });
  const tls = async () => {
    throw Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  };
  await assert.rejects(client(tls).boards(), { kind: 'tls' });
  const html405 = async () => ({ status: 405, headers: {}, body: '<!DOCTYPE html>' });
  await assert.rejects(client(html405).boards(), { kind: 'not_wekan' }, 'a wrong path prefix');
  const html502 = async () => ({ status: 502, headers: {}, body: '<html>Bad Gateway</html>' });
  await assert.rejects(client(html502).boards(), { kind: 'http' });
  const noToken = async () => ({ status: 200, headers: {}, body: '{}' });
  await assert.rejects(client(noToken).boards(), { kind: 'not_wekan' });
});

test('two concurrent readings of an expired session log in once', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.server.revokeTokens();
  await Promise.all([w.hub.client.boards(), w.hub.client.boards()]);
  assert.equal(w.server.logins, 2, 'the start, then one login for both');
});
