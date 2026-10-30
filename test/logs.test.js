// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the API key nor the password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSES_ID, PASSWORD, BASE_CONFIG, createClock, createWorld } from './helpers/world.js';

function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld({ clock: createClock(), ...options });
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to Wekan')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(2 * 60_000);
    w.server.boards.get(COURSES_ID).cards[0].title = `Pain ${i}`;
    await w.hub.poll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('an outage is logged once, and once when Wekan is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.poll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  logs.clear();
  w.server.online = true;
  await w.hub.poll();
  await w.hub.poll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 5 min/);
});

test('a command from Gladys writes one line; never a secret, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await w.fake.sceneAction('move_card', { card: 'Pain', list: 'À acheter' });
  await w.fake.sceneAction('move_card', { card: 'Appeler le plombier', list: 'Fait' });
  w.server.online = false;
  await w.hub.poll();
  const login = await world(t, { config: BASE_CONFIG });
  await login.hub.poll();
  const text = logs.texts().join('\n');
  assert.equal(text.match(/moved to list .* from Gladys/g).length, 1, 'one line per real command');
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(!text.includes('fakeToken'), 'never the session token');

  const refused = await world(t, {
    config: { url: 'http://192.0.2.20:8080', username: 'demo', password: 'secret-wrong' },
  });
  await refused.hub.poll();
  assert.ok(!logs.texts().join('\n').includes('secret-wrong'), 'never a refused password');
});
