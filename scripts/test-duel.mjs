// Drives the real vendored duel client against the local rooms shim as two
// simulated phones climbing the same seeded trivia ladder. No network.
//
//   node scripts/test-duel.mjs

import fs from 'node:fs';
import { createRooms } from './rooms-shim.mjs';
import { dailyLadder, duelQuestionIndices, duelLadder } from '../js/questions.js';
import { compareDuelResults, makeDuelResult } from '../js/duel-rules.js';

const GAME = 'trivia-ladder';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (key) => (stores.get(current).has(key) ? stores.get(current).get(key) : null),
  setItem: (key, value) => stores.get(current).set(key, String(value)),
  removeItem: (key) => stores.get(current).delete(key),
};
function device(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  current = name;
}
device('A');
device('B');

let passed = 0;
function t(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (error) {
    t(error && error.code === code, `${label} (got ${error && error.code})`);
  }
}

const bank = JSON.parse(fs.readFileSync(new URL('../data/questions.json', import.meta.url))).questions;
const payload = { q: duelQuestionIndices(bank, 0) };
const phoneALadder = duelLadder(bank, payload.q);
const phoneBLadder = duelLadder(bank, payload.q);
const challengeContent = (ladder) => ladder.map((q) => ({
  id: q.id,
  q: q.q,
  choices: q.choices,
  answerIndex: q.answerIndex,
}));
t(JSON.stringify(challengeContent(phoneALadder)) === JSON.stringify(challengeContent(phoneBLadder)),
  'same payload deals identical question content on both phones');
t(phoneALadder.map((q) => q.difficulty).join('') === '12345',
  'seeded ladder has one validated question per difficulty');
const fixedDaily = new Set(dailyLadder(bank, '2026-07-30').map((q) => q.id));
t(phoneALadder.every((q) => !fixedDaily.has(q.id)),
  'duel fixture shares no questions with the live-date fixture');

// The leaderboard module must become read-only on a duel URL.
device('isolation');
globalThis.location = { search: '?duel=1' };
const leaderboard = await import('../js/leaderboard.js?duel-isolation');
leaderboard.setName('Should Not Stick');
t(localStorage.getItem('btown-player-name') === null,
  'duel mode cannot write the leaderboard name');
leaderboard.playerId();
t(localStorage.getItem('btown-player-id') === null,
  'duel mode cannot persist a leaderboard player id');
await leaderboard.renamePlayer('Still Should Not Stick');
await leaderboard.submitScore(9999);
t(stores.get('isolation').size === 0,
  'duel leaderboard rename and score submission are no-ops');

// Exercise the vendored shim's real RPC implementation through an in-process
// fetch adapter. This stays runnable in sandboxes that forbid loopback ports.
const shim = createRooms();
globalThis.fetch = async (url, options = {}) => {
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  const rpc = match && shim.rpcs[match[1]];
  if (!rpc || options.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const body = rpc(JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: error.rpc ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
const { Duel, savedSession } = await import('../js/duel.js');

/* ------------------------------------------------------------ the tests */

device('A');
const host = await Duel.create({ game: GAME, name: 'Ada', payload });
t(/^[A-Z2-9]{4}$/.test(host.code) && host.status === 'waiting', 'host opens a friend climb');
t(savedSession(GAME)?.roomId === host.match.roomId, 'host session saved');

device('B');
const guest = await Duel.join({ game: GAME, code: host.code.toLowerCase(), name: 'Bea' });
t(guest.status === 'playing' && JSON.stringify(guest.payload.q) === JSON.stringify(payload.q),
  'guest joins the identical pinned ladder');

device('A');
await host.match._fetch();
t(host.status === 'playing' && host.others()[0].name === 'Bea', 'host sees the climb start');

const adaResult = makeDuelResult(1450, 61234);
const beaResult = makeDuelResult(1450, 74560);
t(compareDuelResults(adaResult, beaResult) === 1,
  'equal scores break toward the faster climber');
t(compareDuelResults(makeDuelResult(1200, 40000), makeDuelResult(1300, 90000)) === -1,
  'higher score beats a faster lower score');
t(compareDuelResults(makeDuelResult(0, 1000, true), beaResult) === -1,
  'a forfeit is a losing result');

// Both submit concurrently; the version lock forces one to retry-merge.
device('A');
const pushA = host.submitResult(adaResult);
device('B');
const pushB = guest.submitResult(beaResult);
await Promise.all([pushA, pushB]);
device('A');
await host.match._fetch();
device('B');
await guest.match._fetch();
t(host.isComplete() && guest.isComplete(), 'both results merge despite concurrent submits');
t(host.status === 'over' && guest.status === 'over', 'duel is marked over');
t(host.others()[0].result.ms === beaResult.ms && guest.others()[0].result.ms === adaResult.ms,
  'each phone sees the rival result');

// Results are write-once.
device('A');
await host.submitResult(makeDuelResult(9999, 1));
device('B');
await guest.match._fetch();
t(guest.others()[0].result.score === adaResult.score, 'results are write-once');

// Rematch deals a fresh seed and clears both results.
device('B');
const rematchPayload = { q: duelQuestionIndices(bank, 99) };
await guest.rematch(rematchPayload);
device('A');
await host.match._fetch();
t(JSON.stringify(host.payload.q) === JSON.stringify(rematchPayload.q)
  && Object.keys(host.results).length === 0
  && host.status === 'playing', 'rematch: fresh ladder, empty results');

// Racing rematches converge on exactly one seed.
device('A');
const dealA = host.rematch({ q: duelQuestionIndices(bank, 100) });
device('B');
const dealB = guest.rematch({ q: duelQuestionIndices(bank, 200) });
await Promise.all([dealA, dealB]);
device('A'); await host.match._fetch();
device('B'); await guest.match._fetch();
t(JSON.stringify(host.payload.q) === JSON.stringify(guest.payload.q),
  'racing rematches converge on one ladder');

// Resume after a refresh.
device('A');
const resumed = await Duel.resume({ game: GAME });
t(resumed.match.roomId === host.match.roomId
  && JSON.stringify(resumed.payload.q) === JSON.stringify(host.payload.q),
  'resume reattaches to the friend climb');

// Leaving bars the stranded rival's submit and reports why.
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest.match._fetch();
t(guest.others()[0].left === true, 'guest sees that the host left');
await expectCode(guest.submitResult(makeDuelResult(900, 80000)), 'opponent_left',
  'submit into an abandoned climb says why');

console.log(`\nALL DUEL TESTS PASSED (${passed} checks)`);
process.exit(0);
