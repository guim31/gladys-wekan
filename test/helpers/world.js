// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Wekan on a fake
// network, a temporary /data, a manual clock and the Paris time zone, with
// the integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read Wekan with
// `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  BOARD_ID,
  COURSES_ID,
  EMAIL,
  FakeWekan,
  LISTS,
  PASSWORD,
  SWIMLANES,
  USERNAME,
  createNetwork,
} from './fakeWekan.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.20:8080';
export const TIME_ZONE = 'Europe/Paris';
// The fixtures were captured on 30/10/2026 at 01:51 UTC; the tests start at
// 01:55 UTC (02:55 in Paris, UTC+1). "Tâches de la maison": "Sortir les
// poubelles" overdue since yesterday 20:00, "Payer la cantine" overdue since
// 02:46, "Arroser les plantes" due at 18:00, "Changer les draps" due at 10:00
// but ended, "Réparer le robinet" and "Tondre la pelouse" (Jardin swimlane)
// tomorrow, "Vider le lave-vaisselle" overdue but in the "Fait" list.
export const START = Date.UTC(2026, 9, 30, 1, 55, 0);

export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = {
  url: URL_1,
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeWekan} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-wekan-')),
  timings = {},
  timers = false,
} = {}) {
  const wekan = server ?? new FakeWekan({ now: clock.now });
  const network = createNetwork({ [URL_1]: wekan });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: wekan, app, hub: app.hub, clock, dataDir };
}

export const boardId = (gladys, id = BOARD_ID) => gladys.externalIds('board', `board-${id}`);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { BOARD_ID, COURSES_ID, EMAIL, FakeWekan, LISTS, PASSWORD, SWIMLANES, USERNAME };
