// db.js – en JSON-fil som databas. Räcker för en användare/demo.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH || './db.json';
export const TYPES = ['routine', 'todo', 'hobby', 'bonus'];
export const PRIOS = ['High', 'Medium', 'Low'];

// Lokalt datum (YYYY-MM-DD). toISOString() ger UTC → fel dag efter midnatt i Sverige.
export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seed() {
  const t = localDate(0), tm = localDate(1);
  const items = [
    { date: t, type: 'routine', name: 'Morgonmeditation', desc: 'Mindfulnessövning', minTime: 10, maxTime: 15, prio: 'Medium', done: true },
    { date: t, type: 'routine', name: 'Plugga & läsa', desc: 'Läs 30 sidor och anteckna', minTime: 30, maxTime: 60, prio: 'High', done: true },
    { date: t, type: 'routine', name: 'Styrketräning', desc: 'Pass för överkroppen', minTime: 45, maxTime: 60, prio: 'High', done: false },
    { date: t, type: 'todo', name: 'Tandläkarbesök', desc: 'Kontroll på Centrumkliniken', minTime: 30, maxTime: 45, prio: 'High', done: true },
    { date: t, type: 'todo', name: 'Betala räkningar', desc: 'El- och internetfakturor', minTime: 15, maxTime: 20, prio: 'Medium', done: false },
    { date: t, type: 'hobby', name: 'Gitarrövning', desc: 'Fingerplockning på akustisk gitarr', minTime: 20, maxTime: 40, prio: 'Low', done: true },
    { date: t, type: 'bonus', name: 'Kall dusch', desc: '2 minuters återhämtningsboost', minTime: 2, maxTime: 5, prio: 'Low', done: false },
    { date: tm, type: 'routine', name: 'Morgonlöpning', desc: '5 km konditionsrunda', minTime: 25, maxTime: 35, prio: 'High', done: false },
    { date: tm, type: 'todo', name: 'Veckohandla', desc: 'Köp ingredienser till matlådor', minTime: 45, maxTime: 60, prio: 'Medium', done: false },
    { date: tm, type: 'hobby', name: 'Läsa sci-fi-roman', desc: 'Kapitel 4 till 6', minTime: 30, maxTime: 45, prio: 'Low', done: false }
  ].map((it, i) => ({ id: i + 1, ...it }));
  return { nextId: items.length + 1, items };
}

async function load() {
  if (!existsSync(DB_PATH)) await save(seed());
  return JSON.parse(await readFile(DB_PATH, 'utf8'));
}

async function save(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// Validering på ett ställe – används av både REST-API:t och AI-agenten.
function clean(input, partial = false) {
  const out = {};
  if (input.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date måste vara YYYY-MM-DD');
    out.date = input.date;
  }
  if (input.type !== undefined) {
    if (!TYPES.includes(input.type)) throw new Error(`type måste vara en av ${TYPES.join(', ')}`);
    out.type = input.type;
  }
  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) throw new Error('name får inte vara tomt');
    out.name = n.slice(0, 80);
  }
  if (input.desc !== undefined) out.desc = String(input.desc).slice(0, 200);
  if (input.prio !== undefined) {
    if (!PRIOS.includes(input.prio)) throw new Error(`prio måste vara en av ${PRIOS.join(', ')}`);
    out.prio = input.prio;
  }
  for (const k of ['minTime', 'maxTime']) {
    if (input[k] !== undefined) {
      const v = Number(input[k]);
      if (!Number.isFinite(v) || v < 0) throw new Error(`${k} måste vara ett tal >= 0`);
      out[k] = Math.round(v);
    }
  }
  if (input.done !== undefined) out.done = Boolean(input.done);

  if (!partial) {
    for (const k of ['date', 'type', 'name']) if (out[k] === undefined) throw new Error(`${k} saknas`);
    out.desc ??= '';
    out.prio ??= 'Medium';
    out.minTime ??= 15;
    out.maxTime ??= Math.max(out.minTime, 30);
    out.done ??= false;
  }
  return out;
}

export async function listItems({ date, from, to, type } = {}) {
  const db = await load();
  return db.items.filter(i =>
    (!date || i.date === date) &&
    (!from || i.date >= from) &&
    (!to || i.date <= to) &&
    (!type || i.type === type)
  );
}

export async function addItem(input) {
  const db = await load();
  const item = { id: db.nextId++, ...clean(input) };
  db.items.push(item);
  await save(db);
  return item;
}

export async function updateItem(id, patch) {
  const db = await load();
  const item = db.items.find(i => i.id === Number(id));
  if (!item) throw new Error(`Inget item med id ${id}`);
  Object.assign(item, clean(patch, true));
  await save(db);
  return item;
}

export async function deleteItem(id) {
  const db = await load();
  const idx = db.items.findIndex(i => i.id === Number(id));
  if (idx === -1) throw new Error(`Inget item med id ${id}`);
  const [removed] = db.items.splice(idx, 1);
  await save(db);
  return removed;
}

// Samma formel som batteriet i frontend: klara / totalt, per kategori och totalt.
export async function getBattery(date) {
  const items = await listItems({ date });
  const pct = (d, t) => (t ? Math.round((d / t) * 100) : 0);
  const byType = {};
  for (const t of TYPES) {
    const of = items.filter(i => i.type === t);
    byType[t] = { done: of.filter(i => i.done).length, total: of.length, pct: pct(of.filter(i => i.done).length, of.length) };
  }
  const done = items.filter(i => i.done).length;
  return { date, total: pct(done, items.length), byType };
}
