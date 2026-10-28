import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, SECTORS, castVote, createGame, getRoundRemainingMs, getVoteCounts, parseCommand, pauseGame, resolveRound, resumeGame, startGame, tickGame } from './game.ts';

test('votes are unique per viewer, changeable, and immutable', () => {
  const initial = startGame(createGame({ now: 0 }), 0);
  const scan = castVote(initial, { userId: 'crew', displayName: 'Crew', action: 'scan' }, 1);
  const boost = castVote(scan, { userId: 'crew', displayName: 'Crew', action: 'boost' }, 2);
  assert.deepEqual(getVoteCounts(boost), { scan: 0, shield: 0, boost: 1 });
  assert.deepEqual(initial.votes, {});
  assert.equal(scan.votes.crew.action, 'scan');
  assert.equal(boost.stats.totalVotes, 1);
  assert.equal(Object.keys(boost.participants).length, 1);
  assert.equal(castVote(boost, { userId: 'late', displayName: 'Late', action: 'scan' }, 20_000), boost);
});

test('deadline resolves once and cannot count old votes in the next sector', () => {
  let state = startGame(createGame({ now: 0 }), 0);
  state = castVote(state, { userId: 'crew', displayName: 'Crew', action: 'scan' }, 1);
  assert.equal(tickGame(state, 19_999), state);
  const resolved = tickGame(state, 60_000);
  assert.equal(resolved.sectorIndex, 1);
  assert.equal(resolved.stats.roundsCompleted, 1);
  assert.equal(resolved.roundEndsAt, 80_000);
  assert.deepEqual(resolved.votes, {});
  assert.equal(tickGame(resolved, 60_000), resolved);
});

test('the crew can finish all six sectors by choosing the right route', () => {
  let state = startGame(createGame({ now: 0 }), 0);
  for (let i = 0; i < SECTORS.length; i++) {
    state = castVote(state, { userId: 'navigator', displayName: 'Navigator', action: SECTORS[i].recommendedAction }, i + 1);
    state = resolveRound(state, i + 2);
  }
  assert.equal(state.phase, 'won');
  assert.equal(state.stats.perfectRoutes, 6);
  assert.equal(state.stats.roundsCompleted, 6);
  assert.ok(state.hull > 0);
  assert.equal(state.roundEndsAt, null);
  assert.equal(resolveRound(state, 100), state);
});

test('poor choices can destroy the ship and stop the expedition', () => {
  let state = startGame(createGame({ now: 0 }), 0);
  for (let i = 0; i < 6 && state.phase === 'running'; i++) {
    state = castVote(state, { userId: 'pilot', displayName: 'Pilot', action: 'boost' }, i + 1);
    state = resolveRound(state, i + 2);
  }
  assert.equal(state.phase, 'lost');
  assert.equal(state.hull, 0);
  assert.equal(state.roundEndsAt, null);
});

test('tie resolution is deterministic and prefers the safe route', () => {
  let state = startGame(createGame({ now: 0 }), 0);
  for (const action of ACTIONS) state = castVote(state, { userId: action, displayName: action, action }, 1);
  const result = resolveRound(state, 2);
  assert.equal(result.lastOutcome?.action, 'scan');
  assert.equal(result.lastOutcome?.tied, true);
  assert.equal(result.lastOutcome?.success, true);
});

test('no votes uses defensive autopilot and all resources stay bounded', () => {
  let state = startGame(createGame({ now: 0 }), 0);
  for (let i = 0; i < 6 && state.phase === 'running'; i++) {
    state = resolveRound(state, i + 1);
    assert.equal(state.lastOutcome?.noVotes, true);
    assert.equal(state.lastOutcome?.action, 'shield');
    for (const resource of [state.hull, state.shield, state.energy]) assert.ok(resource >= 0 && resource <= 100);
  }
});

test('pausing freezes time and blocks votes until resumed', () => {
  const running = startGame(createGame({ now: 0 }), 0);
  const paused = pauseGame(running, 5_000);
  assert.equal(getRoundRemainingMs(paused, 99_000), 15_000);
  assert.equal(castVote(paused, { userId: 'x', displayName: 'X', action: 'scan' }, 6_000), paused);
  const resumed = resumeGame(paused, 100_000);
  assert.equal(resumed.roundEndsAt, 115_000);
  assert.equal(getRoundRemainingMs(resumed, 101_000), 14_000);
});

test('only leading exact commands cast a vote', () => {
  assert.equal(parseCommand(' !SCAN hello '), 'scan');
  assert.equal(parseCommand('!shield'), 'shield');
  assert.equal(parseCommand('!booster'), null);
  assert.equal(parseCommand('please !boost'), null);
});

test('prototype-like viewer IDs cannot corrupt vote records', () => {
  const state = startGame(createGame({ now: 0 }), 0);
  assert.equal(castVote(state, { userId: '__proto__', displayName: 'X', action: 'scan' }, 1), state);
  assert.equal(castVote(state, { userId: 'constructor', displayName: 'X', action: 'scan' }, 1), state);
  const namedLikeMethod = castVote(state, { userId: 'toString', displayName: 'Valid bot name', action: 'scan' }, 1);
  assert.equal(namedLikeMethod.stats.totalVotes, 1);
  assert.deepEqual(getVoteCounts(namedLikeMethod), { scan: 1, shield: 0, boost: 0 });
  const changed = castVote(namedLikeMethod, { userId: 'toString', displayName: 'Valid bot name', action: 'shield' }, 2);
  assert.equal(changed.stats.totalVotes, 1);
  assert.deepEqual(getVoteCounts(changed), { scan: 0, shield: 1, boost: 0 });
});
