// Testar energins fyra regler: start, fokus, laddare och prognos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, deltaOf, energyFor, statusOf } from '../energy.js';

const focus = (minutes, type = 'routine') => ({ type, minutes });
const charger = charge => ({ type: 'bonus', minutes: null, charge });

test('1 timme fokus = 20 %, avrundat till hela 5 och minst 5', () => {
  assert.equal(costOf(focus(60)), 20);
  assert.equal(costOf(focus(45)), 15);
  assert.equal(costOf(focus(15)), 5);
  assert.equal(costOf(focus(2)), 5);
  assert.equal(costOf(focus(null)), 5); // ingen längd = 20 minuter
  assert.equal(costOf(focus(180)), 60);
});

test('en laddare ger det användaren valt, annars 10', () => {
  assert.equal(deltaOf(charger(15)), 15);
  assert.equal(deltaOf({ type: 'bonus' }), 10);
  assert.equal(deltaOf(focus(60)), -20);
});

test('nu = start − fokus + laddare, ikväll = nu − det som är kvar', () => {
  const e = energyFor({ checkin: 40, done: [focus(60), charger(10)], remaining: [focus(45, 'todo'), focus(30, 'hobby')] });
  assert.equal(e.now, 30);
  assert.equal(e.need, 25);
  assert.equal(e.tonight, 5);
  assert.equal(e.label, 'Trött');
  assert.equal(e.status, 'Hushålla');
  assert.equal(e.focusMinutesLeft, 90);
});

test('överbokad dag: ikväll blir negativt, energin nu aldrig under 0 eller över 100', () => {
  const tired = energyFor({ checkin: 20, done: [focus(120)], remaining: [focus(60)] });
  assert.equal(tired.now, 0);
  assert.equal(tired.tonight, -20);
  const full = energyFor({ checkin: 100, done: [charger(20)] });
  assert.equal(full.now, 100);
});

test('utan check-in finns ingen energi, men planen räknas ändå', () => {
  const e = energyFor({ done: [focus(30)], remaining: [focus(30, 'hobby')] });
  assert.equal(e.now, null);
  assert.equal(e.plan.pct, 50);
});

test('dagens plan räknas i minuter per typ, laddare räknas inte', () => {
  const e = energyFor({ checkin: 60, done: [focus(60), focus(15, 'todo'), charger(10)], remaining: [focus(60), focus(45, 'hobby')] });
  assert.deepEqual(e.plan.byType, { routine: { done: 60, planned: 120 }, todo: { done: 15, planned: 15 }, hobby: { done: 0, planned: 45 } });
  assert.equal(e.plan.pct, Math.round((75 / 180) * 100));
});

test('statusord följer nivån', () => {
  assert.deepEqual([0, 19, 20, 49, 50, 79, 80, 100].map(statusOf),
    ['Ladda', 'Ladda', 'Hushålla', 'Hushålla', 'Bra läge', 'Bra läge', 'Full fart', 'Full fart']);
});
