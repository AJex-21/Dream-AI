// Testar lagringen: validering, ändringar och att filen tål samtidiga skrivningar.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

process.env.DB_PATH = './test/test-db-store.json';
const db = await import('../db.js');

const today = '2026-11-02'; // måndag
const addDays = n => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const routine = over => ({ date: today, type: 'routine', name: 'Gym', ...over });

beforeEach(() => rmSync(process.env.DB_PATH, { force: true }));

test('samtidiga skrivningar: inget förloras och filen förblir giltig', async () => {
  await Promise.all(Array.from({ length: 40 }, (_, i) => db.addItem(routine({ name: `Pass ${i}` }))));
  const stored = JSON.parse(readFileSync(process.env.DB_PATH, 'utf8'));
  assert.equal(stored.items.length, 40);
  assert.equal(new Set(stored.items.map(i => i.id)).size, 40);
});

test('ett misslyckat anrop stoppar inte kön', async () => {
  await assert.rejects(db.addItem(routine({ date: 'imorgon' })), /YYYY-MM-DD/);
  assert.equal((await db.addItem(routine())).name, 'Gym');
});

test('validering stoppar ogiltig data med begripliga fel', async () => {
  await assert.rejects(db.addItem(routine({ date: 'imorgon' })), /YYYY-MM-DD/);
  await assert.rejects(db.addItem(routine({ date: '2026-13-45' })), /riktigt datum/);
  await assert.rejects(db.addItem(routine({ type: 'sport' })), /type/);
  await assert.rejects(db.addItem(routine({ name: 'x'.repeat(81) })), /80 tecken/);
  await assert.rejects(db.addItem(routine({ minutes: -5 })), /1–600/);
  await assert.rejects(db.addItem(routine({ minutes: 9999 })), /1–600/);
  await assert.rejects(db.addItem(routine({ minutes: 1.5 })), /1–600/);
  await assert.rejects(db.addItem(routine({ time: '25:00' })), /HH:MM/);
  await assert.rejects(db.addItem(routine({ repeat: { days: [] } })), /veckodag/);
  await assert.rejects(db.addItem(routine({ repeat: { days: [9] } })), /veckodag/);
  await assert.rejects(db.addItem(routine({ repeat: { days: [1], until: '2026-10-01' } })), /före startdatumet/);
  await assert.rejects(db.addItem({ date: today, type: 'todo', name: 'x', repeat: { days: [1] } }), /kan inte upprepas/);
});

test('en rutin utan repeat blir varje dag', async () => {
  const r = await db.addItem(routine());
  assert.deepEqual(r.repeat, { days: [0, 1, 2, 3, 4, 5, 6], until: null });
});

test('bocka av per dag: måndagens bock påverkar inte tisdag', async () => {
  const { id } = await db.addItem(routine());
  await db.setDone(id, { date: today, today });
  assert.equal((await db.getDay(today, today)).items[0].done, true);
  assert.equal((await db.getDay(addDays(1), today)).items[0].done, false);
});

test('framtida dagar kan inte bockas av, men en uppgift kan bli klar i förtid', async () => {
  const r = await db.addItem(routine());
  await assert.rejects(db.setDone(r.id, { date: addDays(1), today }), /framtiden/);
  const t = await db.addItem({ date: addDays(4), type: 'todo', name: 'Uppsats' });
  await db.setDone(t.id, { date: addDays(4), today });
  assert.equal((await db.getDay(addDays(4), today)).total, 1); // bara rutinen kvar på fredag
  assert.ok((await db.getDay(today, today)).items.some(o => o.name === 'Uppsats' && o.done));
});

test('en tid att passa går inte att bocka av i förtid och försvinner från listan efteråt', async () => {
  const t = await db.addItem({ date: addDays(2), time: '14:30', type: 'todo', name: 'Tandläkare' });
  await assert.rejects(db.setDone(t.id, { date: addDays(2), today }), /framtiden/);
  assert.equal((await db.getOverview(today)).todos.open.length, 1);
  assert.equal((await db.getOverview(addDays(3))).todos.open.length, 0);
  assert.equal((await db.getDay(addDays(3), addDays(3))).total, 0);
});

test('en ändring av regeln rör inte det som redan är bockat', async () => {
  const { id } = await db.addItem(routine({ date: db.localDate(), minutes: 20 }));
  await db.setCheckin(60);
  await db.setDone(id, {});
  const before = (await db.getEnergy()).now;
  await db.updateItem(id, { minutes: 60, time: '19:00' });
  assert.equal((await db.getEnergy()).now, before);
  const day = await db.getDay(db.localDate());
  assert.equal(day.items[0].minutes, 20);
  assert.equal(day.items[0].time, null);
});

test('gjort en annan dag än planerat täcker det missade passet och sviten håller', async () => {
  const mon = addDays(0), tue = addDays(1), wed = addDays(2);
  const { id } = await db.addItem(routine({ date: addDays(-7), repeat: { days: [1, 4] } }));
  await db.setDone(id, { date: addDays(-4), today: tue }); // torsdagen innan
  const res = await db.setDone(id, { date: tue, today: tue });
  assert.equal(res.covered, mon);
  assert.equal((await db.getDay(mon, tue)).total, 0);
  assert.equal((await db.getDay(tue, tue)).items[0].done, true);
  assert.equal((await db.getOverview(wed)).routines[0].progress.streak, 2);
  await db.setDone(id, { date: tue, done: false, today: tue });
  assert.equal((await db.getDay(mon, tue)).total, 1); // ångra: måndagen är tillbaka
  assert.equal((await db.getDay(tue, tue)).total, 0);
});

test('flytta ett pass: en regel, ny dag, inget dubbelt', async () => {
  const { id } = await db.addItem(routine({ repeat: { days: [1, 4] } }));
  await db.moveSession(id, { from: addDays(3), to: addDays(4), today });
  assert.equal((await db.getDay(addDays(3), today)).total, 0);
  assert.equal((await db.getDay(addDays(4), today)).total, 1);
  assert.equal((await db.getDay(addDays(7), today)).total, 1); // nästa vecka som vanligt
  assert.equal((await db.listItems()).length, 1);
  await assert.rejects(db.moveSession(id, { from: addDays(1), to: addDays(2), today }), /inte planerad/);
  await assert.rejects(db.moveSession(id, { from: addDays(7), to: addDays(4), today }), /ligger redan/);
});

test('eget innehåll per dag syns den dagen och följer med en flytt', async () => {
  const { id } = await db.addItem(routine({ type: 'hobby', name: 'Gitarr', desc: 'Öva', repeat: { days: [0, 1, 2, 3, 4, 5, 6] } }));
  await db.setNotes(id, [{ date: addDays(1), text: 'Skalor' }]);
  assert.equal((await db.getDay(addDays(1), today)).items[0].desc, 'Skalor');
  assert.equal((await db.getDay(addDays(2), today)).items[0].desc, 'Öva');
});

test('ta bort en laddare som är gjord tar inte tillbaka energin', async () => {
  const { id } = await db.addItem({ date: db.localDate(), type: 'bonus', name: 'Promenad', charge: 15 });
  await db.setCheckin(40);
  await db.setDone(id, {});
  const before = (await db.getEnergy()).now;
  assert.equal(before, 55);
  await db.deleteItem(id, {});
  assert.equal((await db.getEnergy()).now, before);
  assert.equal((await db.listItems({ query: 'Promenad' })).length, 0);
});

test('en avslutad period visar hur det gick i stället för att försvinna', async () => {
  const { id } = await db.addItem(routine({ name: 'Stretch', repeat: { days: [0, 1, 2, 3, 4, 5, 6], until: addDays(2) } }));
  await db.setDone(id, { date: today, today });
  const { routines, ended } = await db.getOverview(addDays(5));
  assert.equal(routines.length, 0);
  assert.equal(ended[0].name, 'Stretch');
  assert.equal(ended[0].sessionsDone, 1);
  assert.equal(ended[0].sessions, 3);
});

test('agentens framsteg är samma siffror som i appen', async () => {
  const a = await db.addItem({ date: today, type: 'hobby', name: 'Gitarr: skalor', minutes: 20 });
  await db.addItem({ date: addDays(1), type: 'hobby', name: 'Gitarr: ackord', minutes: 20 });
  await db.setDone(a.id, { date: today, today });
  const [g] = await db.getProgress({ query: 'gitarr', today });
  assert.equal(g.name, 'Gitarr');
  assert.equal(g.streak, 1);
  assert.equal(g.weekDone, 1);
  assert.equal(g.weekPlanned, 2);
});

test('ångra på att göra: tillbaka till deadline', async () => {
  const t = await db.addItem({ date: addDays(4), type: 'todo', name: 'Uppsats' });
  await db.setDone(t.id, { date: today, today });
  await db.setDone(t.id, { date: today, done: false, today });
  const { todos } = await db.getOverview(today);
  assert.equal(todos.open[0].name, 'Uppsats');
  assert.equal(todos.done.length, 0);
});

test('ta bort en dag lämnar resten av regeln', async () => {
  const { id } = await db.addItem(routine());
  await db.deleteItem(id, { date: addDays(1), today });
  assert.equal((await db.getDay(addDays(1), today)).total, 0);
  assert.equal((await db.getDay(addDays(2), today)).total, 1);
});

test('regel med historik avslutas: försvinner framåt, dagens bock räknas kvar i energin', async () => {
  const { id } = await db.addItem(routine({ date: addDays(-7), minutes: 60 }));
  await db.setCheckin(80, { today });
  await db.setDone(id, { date: today, today });
  const before = (await db.getEnergy(today)).now;
  await db.deleteItem(id, { today });
  assert.equal((await db.getDay(addDays(1), today)).total, 0);
  assert.equal((await db.listItems()).length, 0);
  assert.equal((await db.getEnergy(today)).now, before);
});

test('regel utan historik raderas helt', async () => {
  const { id } = await db.addItem(routine());
  await db.deleteItem(id, { today });
  assert.equal(JSON.parse(readFileSync(process.env.DB_PATH, 'utf8')).items.length, 0);
});

test('dagvyn: energin gäller idag, inte den valda dagen', async () => {
  const { id } = await db.addItem(routine({ minutes: 60, date: db.localDate() }));
  await db.setCheckin(60);
  await db.setDone(id, { date: db.localDate() });
  const a = await db.getDay('2026-01-01');
  const b = await db.getDay('2027-06-01');
  assert.equal(a.energy.now, 40);
  assert.equal(b.energy.now, 40);
});

test('dagvyn: kommande deadlines syns idag, försenade rullar över', async () => {
  await db.addItem({ date: addDays(4), type: 'todo', name: 'Uppsats' });
  await db.addItem({ date: addDays(-2), type: 'todo', name: 'Räkning' });
  const day = await db.getDay(today, today);
  assert.deepEqual(day.upcoming.map(o => o.name), ['Uppsats']);
  assert.equal(day.items[0].name, 'Räkning');
  assert.equal(day.items[0].overdue, true);
});

test('översikten grupperar hobbypass och visar framsteg', async () => {
  const a = await db.addItem({ date: today, type: 'hobby', name: 'Gitarr: skalor', minutes: 20 });
  await db.addItem({ date: addDays(1), type: 'hobby', name: 'Gitarr: ackord', minutes: 20 });
  await db.setDone(a.id, { date: today, today });
  const { hobbies } = await db.getOverview(today);
  assert.equal(hobbies.length, 1);
  assert.equal(hobbies[0].name, 'Gitarr');
  assert.equal(hobbies[0].progress.streak, 1);
  assert.equal(hobbies[0].progress.weekMinutes, 20);
});

test('sökning hittar saker på namn oavsett datum', async () => {
  await db.addItem({ date: addDays(-30), type: 'bonus', name: 'Kall dusch' });
  assert.equal((await db.listItems({ query: 'DUSCH' })).length, 1);
  assert.equal((await db.listItems({ query: 'finns inte' })).length, 0);
});

test('första start: tomt tills användaren väljer', async () => {
  assert.equal(await db.getProfile(), null);
  assert.equal((await db.listItems()).length, 0);
  await db.setup({ name: 'Nora' }, today);
  assert.deepEqual(await db.getProfile(), { name: 'Nora' });
  assert.equal((await db.listItems()).length, 0);
});

test('chatten sparas och kan rensas', async () => {
  await db.appendChat([{ role: 'user', content: 'hej' }, { role: 'assistant', content: 'hej hej', actions: [] }]);
  assert.equal((await db.getChat()).length, 2);
  await db.clearChat();
  assert.equal((await db.getChat()).length, 0);
});

test('migrering från gamla formatet behåller rutiner, bockar och tider', async () => {
  writeFileSync(process.env.DB_PATH, JSON.stringify({ nextId: 13, items: [
    { id: 1, date: '2026-11-01', type: 'routine', name: 'Morgonmeditation', desc: '', minTime: 10, maxTime: 15, prio: 'Medium', done: true },
    { id: 2, date: '2026-11-02', type: 'routine', name: 'morgonmeditation', desc: '', minTime: 10, maxTime: 15, prio: 'Medium', done: false },
    { id: 11, date: '2026-11-01', type: 'routine', name: 'Studera', desc: '', minTime: 30, maxTime: 60, prio: 'High', done: false },
    { id: 12, date: '2026-11-06', type: 'todo', name: 'Uppsats', desc: '', minTime: 30, maxTime: 60, prio: 'High', done: false }
  ] }));
  const items = await db.listItems();
  assert.deepEqual(items.map(i => i.name), ['Morgonmeditation', 'Studera', 'Uppsats']);
  assert.equal(items[0].minutes, 13);
  assert.equal(items[0].lastDone, '2026-11-01');
  assert.equal(items[1].repeat.days.length, 7);
  assert.equal(items[2].repeat, null);
  assert.equal((await db.addItem(routine())).id, 13);
});

test('check-in: bara de fem nivåerna, bara idag', async () => {
  await assert.rejects(db.setCheckin(50, { today }), /Välj en nivå/);
  await assert.rejects(db.setCheckin(60, { date: addDays(1), today }), /checka in för idag/);
  const e = await db.setCheckin(80, { today });
  assert.equal(e.now, 80);
  assert.equal(e.label, 'Pigg');
});

test('energin: fokus använder, laddare ger, ikväll räknar med det som är kvar', async () => {
  const gym = await db.addItem(routine({ minutes: 60 }));
  await db.addItem({ date: today, type: 'hobby', name: 'Gitarr', minutes: 30 });
  const music = await db.addItem({ date: today, type: 'bonus', name: 'Spela favoritlåten', charge: 15 });
  await db.setCheckin(40, { today });
  const done = await db.setDone(gym.id, { date: today, today });
  assert.equal(done.delta, -20);
  assert.equal(done.energy.now, 20);
  assert.equal(done.energy.tonight, 10);
  const charged = await db.setDone(music.id, { date: today, today });
  assert.equal(charged.delta, 15);
  assert.equal(charged.energy.now, 35);
  assert.equal(charged.energy.plan.pct, Math.round((60 / 90) * 100));
});

test('laddning: bara för laddare och inom 1–30 %', async () => {
  await assert.rejects(db.addItem({ date: today, type: 'bonus', name: 'Musik', charge: 50 }), /1–30/);
  const gym = await db.addItem(routine({ charge: 10 }));
  assert.equal(gym.charge, null);
});

test('en laddare finns varje dag, med ikon, och ligger inte i schemat', async () => {
  const c = await db.addItem({ date: today, type: 'bonus', name: 'Spela gitarr för skojs skull', icon: 'music', charge: 10 });
  assert.deepEqual(c.repeat.days, [0, 1, 2, 3, 4, 5, 6]);
  await assert.rejects(db.addItem({ date: today, type: 'bonus', name: 'X', icon: 'raket' }), /Ikonen/);
  const day = await db.getDay(addDays(3), addDays(3));
  assert.equal(day.items.length, 0);
  assert.equal(day.chargers[0].icon, 'music');
  assert.equal((await db.getWeek(today, today)).days.every(d => d.total === 0), true);
});
