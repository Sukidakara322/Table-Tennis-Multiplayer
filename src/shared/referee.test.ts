import { describe, expect, it } from 'vitest';
import { applyRallyEvent, createRally, type RallyEvent, type RallyStep } from './referee';

function run(events: RallyEvent[], server: 0 | 1 = 0): RallyStep {
  let step: RallyStep = { rally: createRally(server), outcome: null };
  for (const event of events) {
    step = applyRallyEvent(step.rally, event);
    if (step.outcome) return step;
  }
  return step;
}

const serve: RallyEvent[] = [
  { type: 'serve', player: 0 },
  { type: 'bounce', side: 0 },
  { type: 'bounce', side: 1 },
];

describe('rally referee', () => {
  it('accepts a legal serve and return', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'bounce', side: 0 }]);
    expect(step.outcome).toBeNull();
    expect(step.rally.stage).toBe('awaitingReturn');
    expect(step.rally.lastHitter).toBe(1);
  });

  it('faults a serve that skips the own half', () => {
    const step = run([{ type: 'serve', player: 0 }, { type: 'bounce', side: 1 }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 1, reason: 'serve-no-own-bounce' });
  });

  it('calls a let when a good serve clips the net', () => {
    const step = run([{ type: 'serve', player: 0 }, { type: 'bounce', side: 0 }, { type: 'net' }, { type: 'bounce', side: 1 }]);
    expect(step.outcome).toEqual({ kind: 'let' });
  });

  it('faults a serve that clips the net and goes out', () => {
    const step = run([{ type: 'serve', player: 0 }, { type: 'bounce', side: 0 }, { type: 'net' }, { type: 'out' }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 1, reason: 'net' });
  });

  it('allows a rally ball to touch the net', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'net' }, { type: 'bounce', side: 0 }]);
    expect(step.outcome).toBeNull();
  });

  it('gives the point to the striker on a double bounce', () => {
    const step = run([...serve, { type: 'bounce', side: 1 }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 0, reason: 'double-bounce' });
  });

  it('gives the point to the striker when the return is missed', () => {
    const step = run([...serve, { type: 'out' }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 0, reason: 'missed-return' });
  });

  it('faults a volley over the table', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'hit', player: 0, overTable: true }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 1, reason: 'volley' });
  });

  it('rewards touching a ball that was already going long', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'hit', player: 0, overTable: false }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 0, reason: 'out' });
  });

  it('faults a return that lands on the own half', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'bounce', side: 1 }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 0, reason: 'own-side' });
  });

  it('faults a double hit', () => {
    const step = run([...serve, { type: 'hit', player: 1, overTable: false }, { type: 'hit', player: 1, overTable: false }]);
    expect(step.outcome).toEqual({ kind: 'point', winner: 0, reason: 'double-hit' });
  });

  it('ignores events once finished', () => {
    const done = run([...serve, { type: 'out' }]);
    expect(applyRallyEvent(done.rally, { type: 'bounce', side: 0 }).outcome).toBeNull();
  });
});
