/** Deterministic, immutable expedition rules shared by the control room and overlay. */
export const ACTIONS = ['scan', 'shield', 'boost'] as const;
export type Action = (typeof ACTIONS)[number];
export type GameMode = 'demo' | 'live';
export type GamePhase = 'idle' | 'running' | 'paused' | 'won' | 'lost';

export interface Sector {
  id: string;
  name: string;
  hazard: string;
  description: string;
  recommendedAction: Action;
  damage: number;
  color: string;
}

export const SECTORS: readonly Sector[] = [
  { id: 'drift', name: 'Asteroid Drift', hazard: 'DEBRIS FIELD', description: 'A thousand fragments. One clean route. Find it together.', recommendedAction: 'scan', damage: 36, color: '#e9b978' },
  { id: 'storm', name: 'Violet Tempest', hazard: 'ION STORM', description: 'Charged clouds roll across the flight path. Brace for impact.', recommendedAction: 'shield', damage: 43, color: '#ab93f0' },
  { id: 'rift', name: 'The Narrow', hazard: 'CLOSING RIFT', description: 'The passage is collapsing. There is still a window to get through.', recommendedAction: 'boost', damage: 42, color: '#7bbfca' },
  { id: 'wreck', name: 'Silent Anchorage', hazard: 'DERELICT FIELD', description: 'Abandoned ships hide a cache of energy — and a few surprises.', recommendedAction: 'scan', damage: 40, color: '#d9bb7c' },
  { id: 'flare', name: 'Helios Wake', hazard: 'SOLAR FLARE', description: 'A wall of solar fire is coming. Keep the crew in one piece.', recommendedAction: 'shield', damage: 52, color: '#ef9676' },
  { id: 'gate', name: 'The Last Light', hazard: 'UNSTABLE GATE', description: 'Home is on the other side. Make the final jump count.', recommendedAction: 'boost', damage: 50, color: '#87c9aa' },
];

export const ACTION_DETAILS: Record<Action, { label: string; command: string; description: string; cost: number }> = {
  scan: { label: 'Scan', command: '!scan', description: 'Find a route. Recover energy.', cost: 8 },
  shield: { label: 'Shield', command: '!shield', description: 'Absorb damage. Protect the crew.', cost: 12 },
  boost: { label: 'Boost', command: '!boost', description: 'Push the engines. Chase a bigger score.', cost: 18 },
};

export interface Vote {
  userId: string;
  displayName: string;
  action: Action;
  source?: 'demo' | 'twitch' | 'local';
  at?: number;
}

export interface GameEvent {
  id: number;
  type: 'system' | 'round' | 'outcome' | 'finish';
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  message: string;
  timestamp: number;
  sectorIndex: number;
}

export interface RoundOutcome {
  sectorIndex: number;
  action: Action;
  title: string;
  description: string;
  success: boolean;
  noVotes: boolean;
  tied: boolean;
  hullDelta: number;
  shieldDelta: number;
  energyDelta: number;
  scoreDelta: number;
  voteCount: number;
  counts: Record<Action, number>;
}

export interface GameState {
  mode: GameMode;
  phase: GamePhase;
  sectorIndex: number;
  hull: number;
  shield: number;
  energy: number;
  score: number;
  votes: Record<string, Vote>;
  /** Retained across rounds so the crew count measures distinct viewers. */
  participants: Record<string, string>;
  log: GameEvent[];
  lastOutcome: RoundOutcome | null;
  roundEndsAt: number | null;
  roundDurationMs: number;
  pausedRemainingMs: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  nextEventId: number;
  stats: { roundsCompleted: number; totalVotes: number; perfectRoutes: number };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const isAction = (value: unknown): value is Action => ACTIONS.includes(value as Action);

function appendEvents(state: GameState, events: Omit<GameEvent, 'id'>[]): GameState {
  return {
    ...state,
    log: [...state.log, ...events.map((event, i) => ({ ...event, id: state.nextEventId + i }))].slice(-60),
    nextEventId: state.nextEventId + events.length,
  };
}

export function createGame(options: { mode?: GameMode; now?: number; roundDurationMs?: number } = {}): GameState {
  const mode = options.mode ?? 'demo';
  const now = options.now ?? Date.now();
  const duration = options.roundDurationMs ?? (mode === 'demo' ? 20_000 : 45_000);
  return {
    mode, phase: 'idle', sectorIndex: 0, hull: 100, shield: 60, energy: 75, score: 0,
    votes: {}, participants: {}, lastOutcome: null,
    log: [{ id: 0, type: 'system', tone: 'neutral', message: 'Expedition ready. Your crew has the controls.', timestamp: now, sectorIndex: 0 }],
    roundEndsAt: null, roundDurationMs: Math.max(1_000, Number.isFinite(duration) ? duration : 20_000),
    pausedRemainingMs: null, startedAt: null, finishedAt: null, nextEventId: 1,
    stats: { roundsCompleted: 0, totalVotes: 0, perfectRoutes: 0 },
  };
}

export function startGame(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'idle') return state;
  return appendEvents({ ...state, phase: 'running', startedAt: now, roundEndsAt: now + state.roundDurationMs }, [
    { type: 'round', tone: 'success', message: `Expedition launched. Entering ${SECTORS[0].name}.`, timestamp: now, sectorIndex: 0 },
  ]);
}

export function restartGame(state: GameState, now = Date.now()): GameState {
  return createGame({ mode: state.mode, roundDurationMs: state.roundDurationMs, now });
}

/** Commands must start the message; ordinary conversation never casts a vote. */
export function parseCommand(text: string): Action | null {
  const match = /^!(scan|shield|boost)(?:\s|$)/i.exec(text.trim());
  return match ? (match[1].toLowerCase() as Action) : null;
}

export function castVote(state: GameState, vote: Vote, now = Date.now()): GameState {
  if (state.phase !== 'running' || state.roundEndsAt === null || now >= state.roundEndsAt || !isAction(vote.action)) return state;
  const userId = vote.userId.trim().slice(0, 100);
  if (!userId || ['__proto__', 'constructor', 'prototype'].includes(userId)) return state;
  const displayName = vote.displayName.trim().slice(0, 40) || 'Crewmate';
  const previous = Object.prototype.hasOwnProperty.call(state.votes, userId) ? state.votes[userId] : undefined;
  if (previous?.action === vote.action) return state;
  return {
    ...state,
    votes: { ...state.votes, [userId]: { ...vote, userId, displayName, at: now } },
    participants: { ...state.participants, [userId]: displayName },
    stats: { ...state.stats, totalVotes: state.stats.totalVotes + (previous ? 0 : 1) },
  };
}

export function getVoteCounts(state: GameState): Record<Action, number> {
  const counts: Record<Action, number> = { scan: 0, shield: 0, boost: 0 };
  for (const vote of Object.values(state.votes)) counts[vote.action]++;
  return counts;
}

export function getRoundRemainingMs(state: GameState, now = Date.now()): number {
  if (state.phase === 'paused') return state.pausedRemainingMs ?? 0;
  if (state.phase === 'idle') return state.roundDurationMs;
  return state.roundEndsAt === null ? 0 : Math.max(0, state.roundEndsAt - now);
}

export function pauseGame(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'running') return state;
  // Resolve an elapsed round first; pausing cannot reopen its voting window.
  const current = tickGame(state, now);
  if (current.phase !== 'running') return current;
  return { ...current, phase: 'paused', pausedRemainingMs: getRoundRemainingMs(current, now), roundEndsAt: null };
}

export function resumeGame(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'paused') return state;
  return { ...state, phase: 'running', roundEndsAt: now + (state.pausedRemainingMs ?? state.roundDurationMs), pausedRemainingMs: null };
}

/** Ties favor the sector's safe route if present, then scan → shield → boost. */
export function resolveRound(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'running') return state;
  const sector = SECTORS[state.sectorIndex];
  const counts = getVoteCounts(state);
  const voteCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const maxVotes = Math.max(...Object.values(counts));
  const leaders = ACTIONS.filter((action) => counts[action] === maxVotes);
  const noVotes = voteCount === 0;
  const action: Action = noVotes ? 'shield' : leaders.includes(sector.recommendedAction) ? sector.recommendedAction : leaders[0];
  const matched = action === sector.recommendedAction;
  const cost = ACTION_DETAILS[action].cost;
  const powered = state.energy >= cost;
  const success = matched && powered;
  let energy = clamp(state.energy - cost);
  let shield = state.shield;
  let incoming = sector.damage;

  if (action === 'scan') {
    incoming = success ? 8 : Math.round(incoming * (powered ? 0.85 : 1.15));
    energy = clamp(energy + (powered ? (matched ? 28 : 20) : 12));
  } else if (action === 'shield') {
    shield = clamp(shield + (powered ? 35 : 10));
    incoming = success ? 15 : Math.round(incoming * (powered ? 0.8 : 1.1));
  } else {
    incoming = success ? 12 : Math.round(incoming * (powered ? 1.2 : 1.4));
    // Flying through the gate replenishes a small amount of engine energy.
    if (success) energy = clamp(energy + 8);
  }

  const absorbed = Math.min(shield, incoming);
  shield -= absorbed;
  const hull = clamp(state.hull - (incoming - absorbed));
  const scoreDelta = (success ? 180 : powered ? 85 : 45) + (action === 'boost' && powered ? 40 : 0) + Math.min(40, voteCount * 5);
  const description = !powered
    ? `Low energy limited the ${action}. ${incoming - absorbed > 0 ? 'The hull took damage.' : 'The shields held.'} Scanning can recover energy.`
    : success
      ? action === 'scan' ? 'A clear route and an energy cache. The crew read the field perfectly.'
        : action === 'shield' ? 'Shields up just in time. The crew rode out the storm.'
          : 'Engines lit. The crew slipped through before the passage closed.'
      : action === 'scan' ? 'The scan recovered energy, but the hazard still caught the ship.'
        : action === 'shield' ? 'The shields softened the impact. A different route would have been cleaner.'
          : 'A bold push earned extra points, but the hazard hit back.';
  const outcome: RoundOutcome = {
    sectorIndex: state.sectorIndex, action, title: success ? 'Perfect route' : !powered ? 'Running on reserves' : 'Through the turbulence',
    description: noVotes ? `No votes this round. Autopilot chose shields. ${description}` : description,
    success, noVotes, tied: !noVotes && leaders.length > 1,
    hullDelta: hull - state.hull, shieldDelta: shield - state.shield, energyDelta: energy - state.energy,
    scoreDelta, voteCount, counts,
  };
  const finalSector = state.sectorIndex === SECTORS.length - 1;
  const phase: GamePhase = hull <= 0 ? 'lost' : finalSector ? 'won' : 'running';
  const nextSectorIndex = phase === 'running' ? state.sectorIndex + 1 : state.sectorIndex;
  const next: GameState = {
    ...state, phase, sectorIndex: nextSectorIndex, hull, shield, energy,
    score: state.score + scoreDelta, lastOutcome: outcome, votes: {},
    roundEndsAt: phase === 'running' ? now + state.roundDurationMs : null,
    finishedAt: phase === 'running' ? null : now,
    stats: { ...state.stats, roundsCompleted: state.stats.roundsCompleted + 1, perfectRoutes: state.stats.perfectRoutes + (success ? 1 : 0) },
  };
  const events: Omit<GameEvent, 'id'>[] = [
    { type: 'outcome', tone: success ? 'success' : hull < state.hull ? 'danger' : 'warning', message: `${sector.name}: ${ACTION_DETAILS[action].label} selected${noVotes ? ' by autopilot' : ` by ${counts[action]} crew votes`}. ${outcome.title}. +${scoreDelta} points.`, timestamp: now, sectorIndex: state.sectorIndex },
  ];
  if (phase === 'running') events.push({ type: 'round', tone: 'neutral', message: `Entering ${SECTORS[nextSectorIndex].name}. New sector, new vote.`, timestamp: now, sectorIndex: nextSectorIndex });
  else events.push({ type: 'finish', tone: phase === 'won' ? 'success' : 'danger', message: phase === 'won' ? 'Jump complete. Your crew made it home.' : 'Signal lost. Regroup and launch another expedition.', timestamp: now, sectorIndex: state.sectorIndex });
  return appendEvents(next, events);
}

/** Resolve at most one round after a sleeping/backgrounded tab: never skip unseen votes. */
export function tickGame(state: GameState, now = Date.now()): GameState {
  return state.phase === 'running' && state.roundEndsAt !== null && now >= state.roundEndsAt ? resolveRound(state, now) : state;
}
