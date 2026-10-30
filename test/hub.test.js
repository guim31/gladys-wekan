// -----------------------------------------------------------------------------
// The hub against the in-memory Wekan (real answers of wekanteam/wekan):
// counters, followed boards, scene events, the scene actions, the login and
// the error cases. The clock starts on 30/10/2026 at 02:55 in Paris (UTC+1).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  BOARD_ID,
  COURSES_ID,
  EMAIL,
  FakeWekan,
  LISTS,
  START,
  SWIMLANES,
  URL_1,
  boardId,
  createClock,
  createWorld,
} from './helpers/world.js';

const at = (day, h, m = 0, s = 0) => Date.UTC(2026, 9, day, h, m, s); // UTC, October 2026

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w, id = BOARD_ID) => {
  const ids = boardId(w.gladys, id);
  return {
    open: w.fake.lastState(ids.feature('open')),
    dueToday: w.fake.lastState(ids.feature('due_today')),
    overdue: w.fake.lastState(ids.feature('overdue')),
    done: w.fake.lastState(ids.feature('done')),
    next: w.fake.lastState(ids.feature('next_due')),
  };
};

const keys = (w) => w.fake.sceneEvents.map((event) => `${event.key}:${event.data.card}`);

test('the fixtures start where the tests expect them', () => {
  assert.equal(new Date(START).toISOString(), '2026-10-30T01:55:00.000Z');
  assert.equal(URL_1, 'http://192.0.2.20:8080');
});

test('one device per board, its counters and its first lists', async (t) => {
  const w = await world(t);
  assert.deepEqual(counters(w), {
    open: 7,
    dueToday: 2,
    overdue: 2,
    done: 2,
    next: 'Arroser les plantes · Fri 30 Oct, 18:00',
  });
  const ids = boardId(w.gladys);
  const lists = [LISTS.TODO, LISTS.DOING, LISTS.BLOCKED].map((list) =>
    w.fake.lastState(ids.feature(`list-${list}`)),
  );
  assert.deepEqual(lists, [4, 3, 1], 'every swimlane, and the ended card still sits in its list');
  const [device] = w.fake.discoveredDevices;
  assert.deepEqual(
    device.features.map((feature) => feature.name),
    [
      'Open cards',
      'Cards due today',
      'Overdue cards',
      'Done cards',
      'À faire',
      'En cours',
      'Bloqué',
      'Next due date',
    ],
    'no counter for the "done" list',
  );
  assert.deepEqual(counters(w, COURSES_ID), {
    open: 1,
    dueToday: 0,
    overdue: 0,
    done: 0,
    next: 'None',
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((item) => item.name),
    ['Wekan Tâches de la maison', 'Wekan Courses'],
  );
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the "done" lists come from the configuration; empty: only the end dates', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, done_lists: '' } });
  assert.equal(counters(w).open, 8);
  assert.equal(counters(w).overdue, 3, '"Vider le lave-vaisselle" is overdue again');
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.ok(names.includes('Fait'));
  const custom = await world(t, { config: { ...BASE_CONFIG, done_lists: 'bloque, fait' } });
  assert.equal(counters(custom).done, 3, 'case and accents ignored');
});

test('the feature names and the next due date in the configured language', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  assert.equal(counters(w).next, 'Arroser les plantes · ven. 30 oct., 18:00');
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Cartes ouvertes');
  assert.equal(w.fake.discoveredDevices[0].features[3].name, 'Cartes terminées');
});

test('only the followed boards, by name or id; unknown ones are reported', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, boards: `courses; Atelier` } });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Wekan Courses'],
  );
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /1 open card\(s\) in 1 followed board\(s\)\. Unknown board/);
  const byId = await world(t, { config: { ...BASE_CONFIG, boards: BOARD_ID } });
  assert.equal(byId.fake.discoveredDevices.length, 1);
});

test('a list renamed keeps its feature', async (t) => {
  const w = await world(t);
  w.server.boards.get(BOARD_ID).lists.find((list) => list._id === LISTS.TODO).title = 'Idées';
  await w.hub.rediscover();
  const ids = w.fake.discoveredDevices[0].features.map((feature) => feature.external_id);
  assert.ok(ids.includes(boardId(w.gladys).feature(`list-${LISTS.TODO}`)));
});

test('nothing fires at the first reading; a move fires once, with both lists', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(w.fake.sceneEvents, []);
  w.server.move('Appeler le plombier', LISTS.DONE);
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_moved:Appeler le plombier']);
  assert.deepEqual(w.fake.sceneEvents[0].data, {
    card: 'Appeler le plombier',
    card_id: 'XKhWr5jYNt75oENEo',
    board: boardId(w.gladys).device,
    board_name: 'Tâches de la maison',
    list: 'Fait',
    previous_list: 'En cours',
    due_date: '',
  });
  clock.advance(60_000);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 1, 'not repeated');
  assert.equal(counters(w).open, 6, 'a card in a "done" list is no longer open');
});

test('a new card fires once; a board just followed brings no event', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock, config: { ...BASE_CONFIG, boards: 'Tâches de la maison' } });
  w.server.add(BOARD_ID, LISTS.BLOCKED, 'Purger les radiateurs', {
    dueAt: '2026-11-01T09:00:00.000Z',
  });
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_added:Purger les radiateurs']);
  assert.equal(w.fake.sceneEvents[0].data.list, 'Bloqué');
  assert.equal(w.fake.sceneEvents[0].data.due_date, '2026-11-01T09:00:00.000Z');
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 1, 'not repeated');
  await w.fake.configUpdated({ ...w.fake.config, boards: '' });
  assert.equal(w.fake.sceneEvents.length, 1, 'the cards of "Courses" are not new');
});

test('a card created from a scene is a new card, and no move', async (t) => {
  const w = await world(t);
  const ok = await w.fake.sceneAction('add_card', { title: 'Tailler la haie' });
  assert.equal(ok.success, true, ok.error);
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_added:Tailler la haie']);
});

test('due times and midnight fire once; a card done before fires nothing', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.time = at(30, 17, 0, 30); // 18:00:30 Paris
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_due:Arroser les plantes']);
  assert.equal(w.fake.sceneEvents[0].data.list, 'À faire');
  clock.time = at(30, 23, 0, 5); // 00:00:05 Paris, 31/10
  await w.hub.poll();
  assert.deepEqual(keys(w).slice(1), [
    'card_overdue:Payer la cantine',
    'card_overdue:Arroser les plantes',
  ]);
  clock.time = at(31, 8, 5); // "Réparer le robinet" due at 08:00 UTC
  w.server.card('Réparer le robinet').endAt = '2026-10-31T07:30:00.000Z';
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 3, 'done before its due time: nothing');
  assert.deepEqual(counters(w), {
    open: 6,
    dueToday: 1,
    overdue: 3,
    done: 3,
    next: 'Tondre la pelouse · Sat 31 Oct, 17:00',
  });
});

test('the day turns at local midnight, not UTC midnight', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.time = at(30, 23, 0, 1); // 00:00:01 Paris, 31/10
  await w.hub.poll();
  // "Réparer le robinet" and "Tondre la pelouse" are now due today.
  assert.equal(counters(w).dueToday, 2);
});

test('the events survive a restart: a move and a due time while down', async (t) => {
  const clock = createClock();
  const server = new FakeWekan({ now: clock.now });
  const first = await createWorld({ clock, server });
  const { dataDir } = first;
  await first.app.stop();
  server.move('Sortir les poubelles', LISTS.BLOCKED);
  server.add(BOARD_ID, LISTS.TODO, 'Acheter des ampoules');
  clock.time = at(30, 17, 5); // after "Arroser les plantes" was due
  const second = await world(t, { clock, server, dataDir });
  assert.deepEqual(keys(second), [
    'card_moved:Sortir les poubelles',
    'card_added:Acheter des ampoules',
    'card_due:Arroser les plantes',
  ]);
  assert.equal(second.fake.sceneEvents[0].data.previous_list, 'À faire');

  await second.app.stop();
  clock.time = at(31, 8, 55); // midnight Paris is ten hours old: dropped
  const third = await world(t, { clock, server, dataDir });
  assert.deepEqual(keys(third), ['card_due:Réparer le robinet'], 'due 55 min ago: kept');
});

test('an event Gladys refuses is tried again at the next reading, the others not repeated', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (key, data) => {
    if (refuse && (key === 'card_moved' || key === 'card_added')) {
      throw new Error('Gladys is restarting');
    }
    return publish(key, data);
  });
  w.server.move('Ranger le garage', LISTS.TODO);
  w.server.add(BOARD_ID, LISTS.TODO, 'Changer le filtre');
  clock.time = at(30, 17, 1);
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_due:Arroser les plantes']);
  refuse = false;
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(keys(w).slice(1), [
    'card_moved:Ranger le garage',
    'card_added:Changer le filtre',
  ]);
});

test('a due event Gladys refuses does not lose a move of the same reading', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (key, data) => {
    if (refuse && key === 'card_due') {
      throw new Error('Gladys is restarting');
    }
    return publish(key, data);
  });
  w.server.move('Ranger le garage', LISTS.TODO);
  clock.time = at(30, 17, 1);
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_moved:Ranger le garage']);
  refuse = false;
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(keys(w).slice(1), ['card_due:Arroser les plantes']);
});

test('add_card: first list by default, first swimlane, with a due date', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const ok = await w.fake.sceneAction('add_card', {
    title: ' Acheter du lait ',
    board: 'courses',
    due: '2026-10-31 18:00',
  });
  assert.equal(ok.success, true, ok.error);
  assert.deepEqual(ok.data.outputs, {
    card: 'Acheter du lait',
    card_id: w.server.card('Acheter du lait')._id,
    board_name: 'Courses',
    list: 'À acheter',
    due_date: '2026-10-31T17:00:00.000Z',
  });
  const created = w.server.card('Acheter du lait');
  assert.equal(created.dueAt, '2026-10-31T17:00:00.000Z');
  assert.equal(created.swimlaneId, 'eQTRN8QKWnxdxZqbA');
  const post = w.server.requests.find(
    (request) => request.method === 'POST' && request.body?.title,
  );
  assert.deepEqual(post.body, {
    title: 'Acheter du lait',
    authorId: 'HjJriLsXZsebgAScY',
    swimlaneId: 'eQTRN8QKWnxdxZqbA',
    description: '',
  });
  assert.equal(counters(w, COURSES_ID).open, 2, 'the counters follow at once');

  const inList = await w.fake.sceneAction('add_card', {
    title: 'Purger les radiateurs',
    list: 'en cours',
    due: '+2h',
  });
  assert.equal(inList.data.outputs.board_name, 'Tâches de la maison', 'the first board');
  assert.equal(inList.data.outputs.list, 'En cours');
  assert.equal(inList.data.outputs.due_date, new Date(START + 2 * 3_600_000).toISOString());
  const noon = await w.fake.sceneAction('add_card', { title: 'Semer', due: '2026-11-02' });
  assert.equal(noon.data.outputs.due_date, '2026-11-02T11:00:00.000Z', 'noon, winter time');
  const iso = await w.fake.sceneAction('add_card', { title: 'X', due: '2026-11-02T08:00:00Z' });
  assert.equal(iso.data.outputs.due_date, '2026-11-02T08:00:00.000Z');
  const undated = await w.fake.sceneAction('add_card', { title: 'Sans date' });
  assert.equal(undated.data.outputs.due_date, '');
  assert.equal(w.server.card('Sans date').dueAt, undefined);

  assert.match(
    (await w.fake.sceneAction('add_card', { title: 'X', due: 'demain' })).error,
    /Échéance incomprise/,
  );
  assert.match(
    (await w.fake.sceneAction('add_card', { title: 'X', due: '2026-02-30' })).error,
    /Échéance incomprise/,
  );
  assert.match(
    (await w.fake.sceneAction('add_card', { title: ' ' })).error,
    /titre de la nouvelle carte/,
  );
  assert.match(
    (await w.fake.sceneAction('add_card', { title: 'X', board: 'Atelier' })).error,
    /Aucun tableau/,
  );
  assert.match(
    (await w.fake.sceneAction('add_card', { title: 'X', list: 'Jamais' })).error,
    /Aucune liste/,
  );
  w.server.readOnly = true;
  assert.match(
    (await w.fake.sceneAction('add_card', { title: 'X' })).error,
    /^Wekan : cet utilisateur n'a pas ce droit .* \(HTTP 403\)$/,
  );
});

test('move_card: by name, to a list by name, with the previous list', async (t) => {
  const w = await world(t);
  const ok = await w.fake.sceneAction('move_card', { card: 'réparer LE robinet', list: 'fait' });
  assert.equal(ok.success, true, ok.error);
  assert.deepEqual(ok.data.outputs, {
    card: 'Réparer le robinet',
    card_id: '9fAbDrnKomxbbYToa',
    board_name: 'Tâches de la maison',
    list: 'Fait',
    previous_list: 'En cours',
  });
  assert.ok(
    w.server.requests.some(
      (request) =>
        request.method === 'PUT' &&
        request.path === `/api/boards/${BOARD_ID}/lists/${LISTS.DOING}/cards/9fAbDrnKomxbbYToa` &&
        request.body.listId === LISTS.DONE,
    ),
    'the card is addressed by its current list',
  );
  assert.equal(w.server.card('Réparer le robinet').listId, LISTS.DONE);
  assert.equal(counters(w).open, 6);

  const back = await w.fake.sceneAction('move_card', {
    card: '9fAbDrnKomxbbYToa',
    list: 'Bloqué',
    board: 'Tâches de la maison',
  });
  assert.equal(back.data.outputs.previous_list, 'Fait', 'a done card can come back, by id');
  assert.match(
    (await w.fake.sceneAction('move_card', { card: 'Tondre', list: 'Fait' })).error,
    /No card/,
  );
  assert.match(
    (await w.fake.sceneAction('move_card', { card: 'Pain', list: 'Fait' })).error,
    /No list/,
  );
  assert.match(
    (await w.fake.sceneAction('move_card', { card: 'Pain', list: 'À acheter', board: 'Atelier' }))
      .error,
    /No board/,
  );
  w.server.card('Pain').title = 'Sortir les poubelles';
  assert.match(
    (await w.fake.sceneAction('move_card', { card: 'Sortir les poubelles', list: 'Fait' })).error,
    /Several cards/,
  );
});

test('read_today: a sentence for a message or a voice announcement', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const ack = await w.fake.sceneAction('read_today', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    text: '3 carte(s) à finir ce soir : Sortir les poubelles, Payer la cantine et Arroser les plantes. 2 en retard.',
    count: 3,
    overdue: 2,
  });
  const courses = await w.fake.sceneAction('read_today', { board: 'Courses' });
  assert.equal(courses.data.outputs.text, "Aucune carte due aujourd'hui.");
});

test('the login: once, again when the session ends, by username or e-mail', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.connectionStatus.connected, true);
  await w.hub.poll();
  assert.equal(w.server.logins, 1);
  w.server.revokeTokens();
  await w.hub.poll();
  assert.equal(w.server.logins, 2);
  assert.equal(w.fake.connectionStatus.connected, true);
  const byEmail = await world(t, { config: { ...BASE_CONFIG, username: EMAIL } });
  assert.equal(byEmail.fake.connectionStatus.connected, true);
  assert.deepEqual(Object.keys(byEmail.server.requests[0].body), ['email', 'password']);
});

test('a wrong password says so, and never shows the password', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong-secret' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /username or password refused/);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.doesNotMatch(JSON.stringify(ack), /wrong-secret/);
});

test('an address that is not Wekan, or that does not answer', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, url: 'http://192.0.2.99:8080' } });
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  const server = new FakeWekan();
  server.apiOff = true;
  const other = await world(t, { server });
  assert.match(other.fake.connectionStatus.message.en, /no Wekan API/);
});

test('no configuration: a clear status, no request', async (t) => {
  const w = await world(t, { config: { url: '' } });
  assert.match(w.fake.connectionStatus.message.en, /address of your Wekan/);
  const half = await world(t, { config: { url: URL_1, username: 'demo' } });
  assert.match(half.fake.connectionStatus.message.en, /username and password of a Wekan user/);
  assert.equal(half.server.requests.length, 0);
  const bad = await world(t, { config: { url: 'ftp://x' } });
  assert.match(bad.fake.connectionStatus.message.en, /not understood/);
  const ack = await half.fake.sceneAction('read_today', {});
  assert.match(ack.error, /pas configuré/, 'French by default');
});

test('an outage keeps the devices and marks them unreachable, then back', async (t) => {
  const w = await world(t);
  w.server.online = false;
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.discoveredDevices.length, 2);
  assert.ok(w.fake.transports.some((entry) => entry.transport === 'unreachable'));
  w.server.online = true;
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a board deleted between the two requests is left out', async (t) => {
  const w = await world(t);
  w.server.boards.delete(COURSES_ID);
  await w.hub.poll();
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.hub.followed.length, 1);
});

test('the states are published again when a device is added', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.ok(w.fake.states.length > before);
});

test('a reading of the old instance during a reconfiguration is dropped', async (t) => {
  const w = await world(t);
  const reading = w.hub.poll();
  await w.fake.configUpdated({ ...w.fake.config, url: 'http://192.0.2.99:8080' });
  await reading;
  assert.deepEqual(w.hub.cards, [], 'nothing of the old instance kept');
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('a card brought from another followed board is a new card, no move', async (t) => {
  const w = await world(t);
  const courses = w.server.boards.get(COURSES_ID);
  const card = courses.cards.pop();
  w.server.boards
    .get(BOARD_ID)
    .cards.push({ ...card, listId: LISTS.BLOCKED, swimlaneId: SWIMLANES.DEFAULT });
  await w.hub.poll();
  assert.deepEqual(keys(w), ['card_added:Pain']);
  assert.equal(counters(w, COURSES_ID).open, 0);
});

test('an archived card leaves the counters', async (t) => {
  const w = await world(t);
  w.server.archive('Payer la cantine');
  await w.hub.poll();
  assert.equal(counters(w).overdue, 1);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('two boards of the same name: both followed, distinct device names', async (t) => {
  const server = new FakeWekan();
  server.boardList[1].title = 'Tâches de la maison';
  const w = await world(t, { server, config: { ...BASE_CONFIG, boards: 'Tâches de la maison' } });
  const names = w.fake.discoveredDevices.map((device) => device.name);
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2, names.join(' / '));
});
