// -----------------------------------------------------------------------------
// The "today's cards" widget: content within the core budget (validated by
// the SDK's validateWidgetContent), the all-boards and one-board views, the
// "done" buttons, and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  BASE_CONFIG,
  BOARD_ID,
  COURSES_ID,
  LISTS,
  boardId,
  createClock,
  createWorld,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('cards_today', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);

test('every board: tiles, the cards of the day with their list and board, buttons', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.ok(data.components.length <= 8);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => tile.value),
    [2, 2],
  );
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => [row.label, row.value, row.color]),
    [
      ['Sortir les poubelles', 'Overdue · À faire · Tâches de la maison', 'danger'],
      ['Payer la cantine', 'Overdue · À faire · Tâches de la maison', 'danger'],
      ['Arroser les plantes', '18:00 · À faire · Tâches de la maison', 'neutral'],
    ],
  );
  assert.deepEqual(
    ofType(data, 'button').map((button) => [button.action.key, button.label]),
    [
      ['done_1', 'Sortir les poubelles'],
      ['done_2', 'Payer la cantine'],
      ['done_3', 'Arroser les plantes'],
    ],
  );
});

test('a board view shows only its cards, in the language of the user', async (t) => {
  const w = await world(t);
  const data = await content(w, { device: boardId(w.gladys, BOARD_ID).device }, 'fr');
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => row.value),
    ['En retard · À faire', 'En retard · À faire', '18:00 · À faire'],
  );
  assert.equal(ofType(data, 'value')[0].label, "Aujourd'hui");
});

test('nothing today: a sentence and the next due date', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  for (const name of ['Sortir les poubelles', 'Payer la cantine', 'Arroser les plantes']) {
    w.server.card(name).endAt = '2026-10-30T01:54:00.000Z';
  }
  await w.hub.poll();
  const data = await content(w, {}, 'fr');
  assert.equal(ofType(data, 'text')[0].text, "Aucune carte due aujourd'hui.");
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => [row.label, row.value]),
    [['Réparer le robinet', 'Prochaine · sam. 31 oct.']],
  );
  const courses = await content(w, { device: boardId(w.gladys, COURSES_ID).device });
  assert.equal(ofType(courses, 'status').length, 0, 'no due date at all: no next row');
});

test('a "done" button sets the end date of the card and answers a toast', async (t) => {
  const w = await world(t);
  const id = w.server.card('Payer la cantine')._id;
  const ack = await w.fake.widgetAction('cards_today', 'done_2', { id }, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, '« Payer la cantine » : terminée.');
  const card = w.server.card('Payer la cantine');
  assert.equal(card.endAt, '2026-10-30T01:55:00.000Z', 'now');
  assert.equal(card.dueAt, '2026-10-30T01:46:10.000Z', 'nothing else changed');
  assert.equal(w.hub.summary().overdue, 1);
  const again = await w.fake.widgetAction('cards_today', 'done_2', { id }, { settings: {} });
  assert.match(again.error, /already done meanwhile/);
  const bad = await w.fake.widgetAction('cards_today', 'done_9', { id }, { settings: {} });
  assert.equal(bad.success, false);
});

test('degraded states: not configured, unknown board, Wekan down', async (t) => {
  const empty = await world(t, { config: { url: '', language: 'en' } });
  assert.match((await content(empty)).components[0].text, /Enter the address/);

  const w = await world(t, { config: { ...BASE_CONFIG, boards: 'Courses' } });
  const gone = await content(w, { device: boardId(w.gladys, BOARD_ID).device });
  assert.match(gone.components[0].text, /no longer followed/);

  w.server.online = false;
  await w.hub.poll();
  const stale = await content(w);
  assert.equal(stale.components[0].variant, 'caption');
  assert.deepEqual(ofType(stale, 'button'), [], 'no button while Wekan is down');

  const clock = createClock();
  const down = await createWorld({ clock, connect: false });
  t.after(() => down.app.stop());
  down.server.online = false;
  await down.gladys.connect();
  await down.app.ready;
  assert.match((await content(down)).components[0].text, /does not answer/);
});

test('the "done" button finds a card moved in Wekan since the last reading', async (t) => {
  const w = await world(t);
  w.server.move('Payer la cantine', LISTS.BLOCKED);
  const id = w.server.card('Payer la cantine')._id;
  const ack = await w.fake.widgetAction('cards_today', 'done_2', { id }, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.server.card('Payer la cantine').endAt, '2026-10-30T01:55:00.000Z');
});

test('the buttons can be hidden; the rows show the board names given in Gladys', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  await w.fake.deviceCreated({ ...device, name: 'Maison' });
  const data = await content(w, { show_buttons: false });
  assert.deepEqual(ofType(data, 'button'), []);
  assert.equal(ofType(data, 'status')[0].items[0].value, 'Overdue · À faire · Maison');
});
