import { otherPlayer, type PlayerIndex } from './types';

/**
 * Rally referee for singles. A pure state machine fed with contact events;
 * the same code runs in the browser (practice) and on the server (multiplayer).
 */
export type RallyStage =
  | 'awaitingServe'
  /** Serve struck; it must bounce on the server's half first. */
  | 'serveOwnBounce'
  /** Serve bounced on the server's half; it must now bounce on the receiver's half. */
  | 'serveOppBounce'
  /** Return struck; it must bounce on the opponent's half. */
  | 'inFlight'
  /** Ball bounced on the receiver's half; the receiver must return it. */
  | 'awaitingReturn'
  | 'finished';

export type FaultReason =
  | 'serve-no-own-bounce'
  | 'serve-missed'
  | 'net'
  | 'out'
  | 'own-side'
  | 'double-bounce'
  | 'missed-return'
  | 'volley'
  | 'double-hit';

export type RallyEvent =
  | { type: 'serve'; player: PlayerIndex }
  | { type: 'hit'; player: PlayerIndex; overTable: boolean }
  | { type: 'bounce'; side: PlayerIndex }
  | { type: 'net' }
  /** Floor, side of the table, or the rally timed out. */
  | { type: 'out' };

export type RallyOutcome = { kind: 'point'; winner: PlayerIndex; reason: FaultReason } | { kind: 'let' };

export interface RallyState {
  server: PlayerIndex;
  stage: RallyStage;
  lastHitter: PlayerIndex | null;
  /** The ball touched the net since the last stroke. */
  netTouched: boolean;
}

export interface RallyStep {
  rally: RallyState;
  outcome: RallyOutcome | null;
}

export function createRally(server: PlayerIndex): RallyState {
  return { server, stage: 'awaitingServe', lastHitter: null, netTouched: false };
}

export function applyRallyEvent(rally: RallyState, event: RallyEvent): RallyStep {
  if (rally.stage === 'finished') return { rally, outcome: null };

  switch (event.type) {
    case 'serve':
      if (rally.stage !== 'awaitingServe' || event.player !== rally.server) return { rally, outcome: null };
      return { rally: { ...rally, stage: 'serveOwnBounce', lastHitter: event.player, netTouched: false }, outcome: null };

    case 'hit':
      return onHit(rally, event.player, event.overTable);

    case 'bounce':
      return onBounce(rally, event.side);

    case 'net':
      if (rally.stage === 'awaitingServe' || rally.stage === 'awaitingReturn') return { rally, outcome: null };
      return { rally: { ...rally, netTouched: true }, outcome: null };

    case 'out':
      return onOut(rally);
  }
}

function onHit(rally: RallyState, player: PlayerIndex, overTable: boolean): RallyStep {
  const { stage, lastHitter } = rally;
  if (stage === 'awaitingServe' || lastHitter === null) return { rally, outcome: null };
  if (player === lastHitter) return point(rally, otherPlayer(player), 'double-hit');
  if (stage === 'awaitingReturn') {
    return { rally: { ...rally, stage: 'inFlight', lastHitter: player, netTouched: false }, outcome: null };
  }
  // The ball has not bounced on this player's half yet.
  if (overTable) return point(rally, lastHitter, 'volley');
  // It was already past the table, so the opponent's shot was going out.
  return point(rally, player, rally.netTouched ? 'net' : isServeStage(stage) ? 'serve-missed' : 'out');
}

function onBounce(rally: RallyState, side: PlayerIndex): RallyStep {
  const { stage, lastHitter } = rally;
  if (lastHitter === null) return { rally, outcome: null };
  const receiver = otherPlayer(lastHitter);

  switch (stage) {
    case 'serveOwnBounce':
      if (side === lastHitter) return { rally: { ...rally, stage: 'serveOppBounce' }, outcome: null };
      return point(rally, receiver, 'serve-no-own-bounce');

    case 'serveOppBounce':
      if (side === receiver) {
        if (rally.netTouched) return finish(rally, { kind: 'let' });
        return { rally: { ...rally, stage: 'awaitingReturn' }, outcome: null };
      }
      return point(rally, receiver, rally.netTouched ? 'net' : 'serve-missed');

    case 'inFlight':
      if (side === receiver) return { rally: { ...rally, stage: 'awaitingReturn' }, outcome: null };
      return point(rally, receiver, rally.netTouched ? 'net' : 'own-side');

    case 'awaitingReturn':
      return point(rally, lastHitter, side === receiver ? 'double-bounce' : 'missed-return');

    default:
      return { rally, outcome: null };
  }
}

function onOut(rally: RallyState): RallyStep {
  const { stage, lastHitter } = rally;
  if (lastHitter === null) return { rally, outcome: null };
  if (stage === 'awaitingReturn') return point(rally, lastHitter, 'missed-return');
  const reason: FaultReason = rally.netTouched ? 'net' : isServeStage(stage) ? 'serve-missed' : 'out';
  return point(rally, otherPlayer(lastHitter), reason);
}

function isServeStage(stage: RallyStage): boolean {
  return stage === 'serveOwnBounce' || stage === 'serveOppBounce';
}

function point(rally: RallyState, winner: PlayerIndex, reason: FaultReason): RallyStep {
  return finish(rally, { kind: 'point', winner, reason });
}

function finish(rally: RallyState, outcome: RallyOutcome): RallyStep {
  return { rally: { ...rally, stage: 'finished' }, outcome };
}
