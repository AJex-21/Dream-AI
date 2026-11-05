// Testar schemat och batteriet: rena funktioner, så tiden kan styras exakt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, addDays, balance, expand, isValidDate, occursOn, progress, sortDay, weekStart } from '../schedule.js';
import { batteryAt, gainFor, DRAIN_PER_HOUR } from '../battery.js';

const MON = '2026-11-02'; // måndag
const at = (date, time = '12:00') => new Date(`${date}T${time}:00`).getTime();
const item = over => ({ id: 1, type: 'routine', name: 'Gym', desc: '', prio: 'Medium', time: null, minutes: null, date: MON, repeat: null, doneOn: {}, skip: [], extra: [], notes: {}, ...over });
const done = (date, time = '12:00', gain = 20) => ({ at: at(date, time), gain, minutes: null, time: null });
const days = (it, from, to, today = from) => expand([it], from, to, today).map(o => o.date);

test('isValidDate stoppar påhittade datum', () => {
  assert.equal(isValidDate('2026-11-02'), true);
  for (const bad of ['2026-13-45', '2026-02-30', '2026-1-1', 'imorgon', undefined]) assert.equal(isValidDate(bad), false, bad);
});

test('veckan börjar på måndag, även från en söndag', () => {
  assert.equal(weekStart('2026-11-08'), MON);
  assert.equal(weekStart(MON), MON);
});

test('regel varje dag följer med dag för dag', () => {
  const it = item({ repeat: { days: ALL_DAYS, until: null } });
  assert.equal(days(it, MON, addDays(MON, 29)).length, 30);
});

test('regel på veckodagar: gym måndag och torsdag', () => {
  const it = item({ repeat: { days: [1, 4], until: null } });
  assert.deepEqual(days(it, MON, addDays(MON, 13)), ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12']);
});

test('regel med period gäller bara mellan från och till', () => {
  const it = item({ date: '2026-11-10', repeat: { days: ALL_DAYS, until: '2026-11-12' } });
  assert.deepEqual(days(it, MON, addDays(MON, 29)), ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('en borttagen dag försvinner bara den dagen', () => {
  const it = item({ repeat: { days: ALL_DAYS, until: null }, skip: [addDays(MON, 1)] });
  assert.deepEqual(days(it, MON, addDays(MON, 2)), [MON, addDays(MON, 2)]);
});

test('avbockat ligger kvar i historiken även om regeln ändras', () => {
  const it = item({ repeat: { days: [2], until: null }, doneOn: { [MON]: done(MON) } });
  assert.equal(occursOn(it, MON, MON), true);
});

test('öppen att göra syns på deadline och följer sedan med till idag', () => {
  const it = item({ type: 'todo', date: '2026-11-06' });
  assert.equal(occursOn(it, '2026-11-06', MON), true);
  assert.equal(occursOn(it, MON, MON), false);
  const late = expand([it], '2026-11-07', '2026-11-07', '2026-11-07')[0];
  assert.equal(late.overdue, true);
  assert.equal(late.deadline, '2026-11-06');
});

test('klar att göra ligger på dagen den blev klar, inte på deadline', () => {
  const it = item({ type: 'todo', date: '2026-11-06', doneOn: { [MON]: done(MON) } });
  assert.equal(occursOn(it, MON, MON), true);
  assert.equal(occursOn(it, '2026-11-06', MON), false);
  assert.equal(occursOn(it, '2026-11-09', '2026-11-09'), false);
});

test('en tid att passa blir aldrig försenad och följer inte med till nästa dag', () => {
  const it = item({ type: 'todo', date: '2026-11-04', time: '14:30' });
  assert.equal(occursOn(it, '2026-11-04', '2026-11-04'), true);
  assert.equal(occursOn(it, '2026-11-05', '2026-11-05'), false);
  const past = expand([it], '2026-11-04', '2026-11-04', '2026-11-05')[0];
  assert.equal(past.overdue, false);
  assert.equal(past.appointment, true);
});

test('dagens ordning: försenat, klockslag, prioritet, klart sist', () => {
  const list = [
    { id: 1, done: true, time: '06:00', prio: 'High' },
    { id: 2, done: false, time: null, prio: 'Low' },
    { id: 3, done: false, time: null, prio: 'High' },
    { id: 4, done: false, time: '18:00', prio: 'Low' },
    { id: 5, done: false, time: '07:30', prio: 'Low' },
    { id: 6, done: false, time: null, prio: 'Low', overdue: true }
  ];
  assert.deepEqual(sortDay(list).map(o => o.id), [6, 5, 4, 3, 2, 1]);
});

test('svit räknas i planerade pass och idag bryter den inte', () => {
  const today = '2026-11-12'; // torsdag
  const it = item({
    date: '2026-10-01',
    repeat: { days: [1, 4], until: null },
    doneOn: { '2026-11-02': done('2026-11-02'), '2026-11-05': done('2026-11-05'), '2026-11-09': done('2026-11-09') }
  });
  const p = progress([it], today);
  assert.equal(p.streak, 3);
  assert.equal(p.week.find(d => d.date === today).state, 'pending');
  assert.equal(p.week.find(d => d.date === '2026-11-10').state, 'none'); // tisdag: inget planerat
});

test('prickarna och siffrorna gäller samma vecka', () => {
  const it = item({ date: '2026-10-01', type: 'hobby', repeat: { days: ALL_DAYS, until: null }, doneOn: { '2026-11-07': done('2026-11-07'), '2026-11-09': done('2026-11-09') } });
  const p = progress([it], '2026-11-09'); // måndag: förra veckans pass ska inte synas
  assert.equal(p.week[0].date, '2026-11-09');
  assert.equal(p.week.at(-1).date, '2026-11-15');
  assert.equal(p.week.filter(d => d.state === 'done').length, p.weekDone);
  assert.equal(p.week.filter(d => d.state === 'planned').length, 6);
});

test('ett bockat pass behåller längd och tid när regeln ändras', () => {
  const it = item({ minutes: 60, time: '19:30', repeat: { days: ALL_DAYS, until: null }, doneOn: { [MON]: { ...done(MON), minutes: 45, time: '18:00' } } });
  const [o] = expand([it], MON, MON, MON);
  assert.equal(o.minutes, 45);
  assert.equal(o.time, '18:00');
  assert.equal(progress([it], MON).weekMinutes, 45);
});

test('en flyttad session hamnar på nya dagen och försvinner från den gamla', () => {
  const it = item({ repeat: { days: [1], until: null }, skip: [MON], extra: ['2026-11-03'] });
  assert.deepEqual(days(it, MON, addDays(MON, 7)), ['2026-11-03', '2026-11-09']);
});

test('eget innehåll per dag, annars regelns beskrivning', () => {
  const it = item({ desc: 'Gitarr', repeat: { days: ALL_DAYS, until: null }, notes: { '2026-11-03': 'Skalor i C-dur' } });
  const list = expand([it], MON, '2026-11-03', MON);
  assert.deepEqual(list.map(o => o.desc), ['Gitarr', 'Skalor i C-dur']);
});

test('missat pass bryter sviten', () => {
  const it = item({ date: '2026-10-30', repeat: { days: ALL_DAYS, until: null }, doneOn: { '2026-11-02': done('2026-11-02') } });
  assert.equal(progress([it], '2026-11-02').streak, 1);
  assert.equal(progress([it], '2026-11-04').streak, 0);
});

test('balans: försenad uppgift räknas en gång, inget planerat blir null', () => {
  const late = item({ type: 'todo', date: '2026-11-03' });
  const b = balance([late], '2026-11-05');
  assert.equal(b.todo, 0);
  assert.equal(b.routine, null);
});

test('balans: det som är kvar idag räknas inte som missat', () => {
  const tonight = item({ repeat: { days: ALL_DAYS, until: null } });
  assert.equal(balance([tonight], MON).routine, null);
  const yesterday = item({ date: '2026-11-01', repeat: { days: ALL_DAYS, until: null } });
  assert.equal(balance([yesterday], MON).routine, 0);
});

test('batteri: längre pass ger mer, en räkning ger mindre än ett träningspass', () => {
  const long = item({ id: 1, minutes: 60, repeat: { days: [1], until: null } });
  const short = item({ id: 2, minutes: 10, repeat: { days: [1], until: null } });
  const plan = [long, short];
  assert.ok(gainFor(long, plan, MON) > gainFor(short, plan, MON));
  assert.ok(gainFor(item({ type: 'todo' }), plan, MON) < gainFor(short, plan, MON));
});

test('batteri: första passet på en söndag är inte värt en hel vecka', () => {
  const sun = '2026-11-08';
  const it = item({ date: sun, minutes: 20, repeat: { days: ALL_DAYS, until: null } });
  assert.equal(gainFor(it, [it], sun), gainFor(it, [it], addDays(sun, 1)));
});

// Tre veckor med en plan, helt eller delvis gjord. Visar att det är följsamheten som räknas.
function simulate(plan, doneShare = 1) {
  const start = new Date(2026, 10, 2);
  const rules = plan.map((p, i) => item({ id: i + 1, name: `P${i}`, minutes: p.minutes, repeat: { days: p.days, until: null } }));
  let credit = 0;
  for (let n = 0; n < 21; n++) {
    const d = new Date(start); d.setDate(d.getDate() + n);
    const date = addDays(MON, n);
    for (const r of rules) {
      if (!r.repeat.days.includes(d.getDay())) continue;
      credit += doneShare;
      if (credit < 1) continue;
      credit -= 1;
      r.doneOn[date] = { at: at(date, '19:00'), gain: gainFor(r, rules, date) };
    }
  }
  return batteryAt(rules, at(addDays(MON, 20), '21:00')).level;
}

test('batteri: att hålla sin plan fyller batteriet, oavsett hur stor planen är', () => {
  const small = [{ minutes: 20, days: ALL_DAYS }];
  const oscar = [{ minutes: 60, days: [1, 4] }, { minutes: 20, days: ALL_DAYS }, { minutes: 10, days: ALL_DAYS }];
  const big = [...oscar, { minutes: 45, days: [1, 2, 3, 4, 5] }, { minutes: 30, days: ALL_DAYS }, { minutes: 30, days: [2, 4, 6] }];
  for (const plan of [small, oscar, big]) assert.ok(simulate(plan) >= 85, `full plan: ${simulate(plan)}`);
});

test('batteri: hälften av planen ger tydligt lägre nivå än hela', () => {
  const oscar = [{ minutes: 60, days: [1, 4] }, { minutes: 20, days: ALL_DAYS }, { minutes: 10, days: ALL_DAYS }];
  assert.ok(simulate(oscar, 0.5) < simulate(oscar) - 40, `${simulate(oscar, 0.5)} mot ${simulate(oscar)}`);
});

test('batteri: att planera in något påverkar det inte', () => {
  const finished = item({ minutes: 60, doneOn: { [MON]: done(MON, '09:00') } });
  const now = at(MON, '10:00');
  const before = batteryAt([finished], now).level;
  const planned = item({ id: 2, name: 'Gitarr', type: 'hobby', repeat: { days: ALL_DAYS, until: null } });
  assert.equal(batteryAt([finished, planned], now).level, before);
});

test('batteri: sjunker med tiden, når noll och går att räkna på', () => {
  const it = item({ minutes: 60, doneOn: { [MON]: done(MON, '09:00') } }); // +20 %
  assert.equal(batteryAt([it], at(MON, '09:00')).level, 20);
  const left = 20 - 4 * DRAIN_PER_HOUR;
  assert.equal(batteryAt([it], at(MON, '13:00')).level, left);
  assert.equal(batteryAt([it], at(MON, '13:00')).hoursLeft, Math.round((left / DRAIN_PER_HOUR) * 10) / 10);
  const empty = batteryAt([it], at('2026-11-04', '09:00'));
  assert.equal(empty.level, 0);
  assert.equal(empty.emptyAt, null);
});

test('batteri: gårdagens pass följer med till nästa morgon', () => {
  const it = item({ minutes: 60, doneOn: { [MON]: done(MON, '18:00') } });
  assert.ok(batteryAt([it], at('2026-11-03', '00:30')).level > 0);
});

test('batteri: ångra ger samma nivå som om bocken aldrig satts', () => {
  const a = item({ minutes: 60, doneOn: { [MON]: done(MON, '09:00') } });
  const b = item({ id: 2, minutes: 30, doneOn: { [MON]: done(MON, '10:00') } });
  const now = at(MON, '11:00');
  const undone = { ...b, doneOn: {} };
  assert.equal(batteryAt([a, undone], now).level, batteryAt([a], now).level);
});

test('batteri: taket är 100 och delarna summerar alltid till nivån', () => {
  const many = Array.from({ length: 12 }, (_, i) => item({
    id: i + 1,
    type: ['routine', 'hobby', 'todo', 'bonus'][i % 4],
    minutes: 60,
    doneOn: { [MON]: done(MON, `0${i % 9}:30`, 20) }
  }));
  for (const now of [at(MON, '09:00'), at(MON, '17:45'), at('2026-11-03', '03:10')]) {
    const b = batteryAt(many, now);
    assert.ok(b.level <= 100);
    assert.equal(Object.values(b.byType).reduce((s, v) => s + v, 0), b.level);
  }
});
