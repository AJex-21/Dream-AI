// db.js – en JSON-fil som databas. Räcker för en användare/demo.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { batteryAt, gainFor } from './battery.js';
import {
  ALL_DAYS, addDays, balance, expand, formatDate, groupName, isAppointment, isValidDate,
  occurrence, occursOn, progress, sortDay, weekStart
} from './schedule.js';

const DB_PATH = process.env.DB_PATH || './db.json';
const VERSION = 2;
const MAX_RANGE_DAYS = 366;
export const TYPES = ['routine', 'todo', 'hobby', 'bonus'];
export const PRIOS = ['High', 'Medium', 'Low'];

// Lokalt datum (YYYY-MM-DD). toISOString() ger UTC → fel dag efter midnatt i Sverige.
export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
}

const fail = message => { throw new Error(message); };
const eveningOf = date => new Date(date + 'T20:00:00').getTime(); // efterregistrering hamnar på dagen, inte nu
const blankHistory = () => ({ doneOn: {}, skip: [], extra: [], notes: {} });

// En bock fryser vad passet var värt, så att en ändring av regeln inte skriver om det förflutna.
const tick = (item, items, date, at) => ({ at, gain: gainFor(item, items, date), minutes: item.minutes, time: item.time });

// ---- Lagring ----

// Format 1 hade en rad per dag och rutiner var kopior, så de slås ihop till en regel per namn.
function migrate(db) {
  if (db.version === VERSION) return db;
  const items = [];
  const routines = new Map();
  const doneDates = new Map();
  for (const { minTime, maxTime, done, ...old } of db.items) {
    const minutes = maxTime ? Math.round(((minTime ?? maxTime) + maxTime) / 2) : null;
    const twin = old.type === 'routine' && routines.get(old.name.toLowerCase());
    const item = twin || { ...old, time: null, minutes, repeat: null, ...blankHistory() };
    if (twin) {
      if (old.date < twin.date) twin.date = old.date;
    } else {
      if (old.type === 'routine') {
        item.repeat = { days: ALL_DAYS, until: null };
        routines.set(old.name.toLowerCase(), item);
      }
      items.push(item);
      doneDates.set(item, []);
    }
    if (done) doneDates.get(item).push(old.date);
  }
  for (const [item, dates] of doneDates) {
    for (const date of dates) item.doneOn[date] = tick(item, items, date, eveningOf(date));
  }
  return { version: VERSION, nextId: db.nextId, profile: { name: 'Oscar' }, items, chat: [] };
}

async function load() {
  if (!existsSync(DB_PATH)) return { version: VERSION, nextId: 1, profile: null, items: [], chat: [] };
  return migrate(JSON.parse(await readFile(DB_PATH, 'utf8')));
}

// Temporär fil + rename: den riktiga filen är alltid hel, även om något avbryts mitt i.
async function save(db) {
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, DB_PATH);
}

// Alla ändringar går genom en kö: läs, ändra, spara. Två samtidiga skrivningar kan då inte
// skriva över varandra. Kastar fn sparas ingenting, så add_items är allt eller inget.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

// ---- Validering på ett ställe – används av både REST-API:t och AI-agenten ----

function cleanRepeat(r) {
  if (r === null) return null;
  const days = [...new Set(r?.days ?? ALL_DAYS)].sort();
  if (!days.length || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
    fail('Välj minst en veckodag (0 = söndag ... 6 = lördag).');
  }
  const until = r?.until ?? null;
  if (until !== null && !isValidDate(until)) fail('Slutdatumet måste vara ett riktigt datum (YYYY-MM-DD).');
  return { days, until };
}

function clean(input, partial = false) {
  const out = {};
  if (input.date !== undefined) {
    if (!isValidDate(input.date)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
    out.date = input.date;
  }
  if (input.type !== undefined) {
    if (!TYPES.includes(input.type)) fail(`type måste vara en av ${TYPES.join(', ')}`);
    out.type = input.type;
  }
  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) fail('Namnet får inte vara tomt.');
    if (n.length > 80) fail('Namnet får vara högst 80 tecken.');
    out.name = n;
  }
  if (input.desc !== undefined) {
    const d = String(input.desc).trim();
    if (d.length > 200) fail('Beskrivningen får vara högst 200 tecken.');
    out.desc = d;
  }
  if (input.prio !== undefined) {
    if (!PRIOS.includes(input.prio)) fail(`prio måste vara en av ${PRIOS.join(', ')}`);
    out.prio = input.prio;
  }
  if (input.time !== undefined) {
    if (input.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail('Klockslaget måste skrivas HH:MM.');
    out.time = input.time;
  }
  if (input.minutes !== undefined) {
    const m = input.minutes === null ? null : Number(input.minutes);
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 600)) fail('Längden måste vara ett heltal, 1–600 minuter.');
    out.minutes = m;
  }
  if (input.repeat !== undefined) out.repeat = cleanRepeat(input.repeat);

  if (!partial) {
    for (const k of ['date', 'type', 'name']) if (out[k] === undefined) fail(`${k} saknas`);
    out.desc ??= '';
    out.prio ??= 'Medium';
    out.time ??= null;
    out.minutes ??= null;
    out.repeat ??= null;
  }
  return out;
}

// Regler som gäller hela itemet, så de kollas efter att en ändring slagits ihop.
function checkWhole(item) {
  if (item.type === 'routine') item.repeat ??= { days: ALL_DAYS, until: null };
  if (item.type === 'todo' && item.repeat) fail('En uppgift kan inte upprepas. Lägg den som rutin i stället.');
  if (item.repeat?.until && item.repeat.until < item.date) fail('Slutdatumet ligger före startdatumet.');
  return item;
}

// Vad omvärlden får se av ett lagrat item: doneOn kan bli långt och är en intern detalj.
function publicItem({ doneOn, skip, extra, notes, ...rest }) {
  const dates = Object.keys(doneOn).sort();
  return rest.repeat
    ? { ...rest, lastDone: dates.at(-1) ?? null }
    : { ...rest, done: dates.length > 0, doneDate: dates.at(-1) ?? null };
}

const findItem = (db, id) => db.items.find(i => i.id === Number(id)) ?? fail(`Inget item med id ${id}`);
const visible = items => items.filter(i => !i.archived);
const isActiveRule = (item, today) => item.repeat && (!item.repeat.until || item.repeat.until >= today);
const hasHistory = item => Object.keys(item.doneOn).length > 0;
// Vad en rad skulle ladda om den bockas av nu. Beror på hela planen, inte bara raden själv.
const priced = (occ, items) => ({ ...occ, charge: gainFor(occ, items, occ.date) });

function pushItem(db, input) {
  const item = checkWhole({ id: db.nextId, ...clean(input), ...blankHistory() });
  db.nextId++;
  db.items.push(item);
  return item;
}

// ---- Läsa ----

export async function listItems({ date, from, to, type, query, today = localDate() } = {}) {
  const items = visible((await load()).items);
  const q = query?.trim().toLowerCase();
  const wanted = items.filter(i =>
    (!type || i.type === type) &&
    (!q || `${i.name} ${i.desc}`.toLowerCase().includes(q))
  );
  if (!date && !from && !to) return wanted.map(publicItem);

  const start = date ?? from ?? today;
  const end = date ?? to ?? addDays(start, 90);
  if (!isValidDate(start) || !isValidDate(end)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
  if (end > addDays(start, MAX_RANGE_DAYS)) fail('Välj ett intervall på högst ett år.');
  return expand(wanted, start, end, today);
}

export async function getBattery() {
  return batteryAt((await load()).items);
}

// En dag i schemat. Batteriet är alltid läget just nu, oavsett vilken dag man tittar på.
export async function getDay(date, today = localDate()) {
  if (!isValidDate(date)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
  const items = (await load()).items;
  const shown = visible(items);
  const list = sortDay(expand(shown, date, date, today)).map(o => priced(o, items));
  const todays = sortDay(expand(shown, today, today, today));
  const next = todays.find(o => !o.done && !o.overdue); // "Nästa" är dagens plan, inte gammalt som släpar
  const upcoming = date === today
    ? shown
      .filter(i => i.type === 'todo' && !hasHistory(i) && i.date > today && i.date <= addDays(today, 7))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3)
      .map(i => priced(occurrence(i, i.date, today), items))
    : [];
  return {
    date,
    today,
    items: list,
    done: list.filter(o => o.done).length,
    total: list.length,
    todayTotal: todays.length,
    upcoming,
    next: next ? priced(next, items) : null,
    battery: batteryAt(items)
  };
}

export async function getWeek(date, today = localDate()) {
  if (!isValidDate(date)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
  const shown = visible((await load()).items);
  const start = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const items = sortDay(expand(shown, d, d, today));
    return { date: d, items, done: items.filter(o => o.done).length, total: items.length };
  });
  return { start, days };
}

// Rutiner, att göra och hobby är inte kopplade till en dag, så de hämtas tillsammans.
export async function getOverview(today = localDate()) {
  const all = (await load()).items;
  const items = visible(all);
  const todayOf = item => {
    const occ = expand([item], today, today, today)[0];
    return occ ? priced(occ, all) : null;
  };

  const routines = items
    .filter(i => i.type === 'routine' && isActiveRule(i, today))
    .map(i => ({ ...publicItem(i), today: todayOf(i), charge: gainFor(i, all, today), progress: progress([i], today) }));

  // En avslutad period försvinner inte utan visar hur det gick.
  const ended = items
    .filter(i => i.type === 'routine' && !isActiveRule(i, today))
    .sort((a, b) => b.repeat.until.localeCompare(a.repeat.until))
    .slice(0, 5)
    .map(i => {
      const sessions = expand([i], i.date, i.repeat.until, today);
      return { ...publicItem(i), sessionsDone: sessions.filter(o => o.done).length, sessions: sessions.length };
    });

  const todos = items.filter(i => i.type === 'todo');
  const open = todos.filter(i => !hasHistory(i) && !(isAppointment(i) && i.date < today))
    .map(i => priced(occurrence(i, i.date, today), all))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  const done = todos.filter(hasHistory)
    .map(i => ({ doneDate: Object.keys(i.doneOn)[0], at: Object.values(i.doneOn)[0].at, item: i }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
    .map(({ doneDate, item }) => occurrence(item, doneDate, today));

  const groups = new Map();
  for (const i of items.filter(it => it.type === 'hobby')) {
    const key = groupName(i.name).toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: groupName(i.name), items: [] });
    groups.get(key).items.push(i);
  }
  const hobbies = [...groups.values()].map(g => {
    const next = expand(g.items, today, addDays(today, 14), today).find(o => !o.done);
    const offDay = g.items.find(i => isActiveRule(i, today) && !occursOn(i, today, today));
    return {
      name: g.name,
      progress: progress(g.items, today),
      next: next ? priced(next, all) : null,
      offDay: offDay ? { id: offDay.id, name: offDay.name, type: offDay.type } : null
    };
  });

  return {
    routines,
    ended,
    todos: { open, done },
    hobbies,
    bonus: expand(items.filter(i => i.type === 'bonus'), today, today, today).map(o => priced(o, all)),
    balance: balance(all, today)
  };
}

// Hur det går över tid, per rutin och hobby. Samma siffror som i appen, för agenten.
export async function getProgress({ query, today = localDate() } = {}) {
  const items = visible((await load()).items).filter(i => i.type === 'routine' || i.type === 'hobby');
  const q = query?.trim().toLowerCase();
  const groups = new Map();
  for (const i of items.filter(it => !q || it.name.toLowerCase().includes(q))) {
    const key = groupName(i.name).toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: groupName(i.name), type: i.type, items: [] });
    groups.get(key).items.push(i);
  }
  return [...groups.values()].map(({ name, type, items: list }) => {
    const { week, ...numbers } = progress(list, today);
    return { name, type, ...numbers };
  });
}

// ---- Ändra ----

export const addItems = inputs => mutate(db => inputs.map(i => publicItem(pushItem(db, i))));
export const addItem = input => mutate(db => publicItem(pushItem(db, input)));

export const updateItem = (id, patch) => mutate(db => {
  const item = findItem(db, id);
  checkWhole(Object.assign(item, clean(patch, true)));
  return publicItem(item);
});

// Bocka av en dag. Regler har en bock per dag, att göra blir klart den dag man gör det.
export const setDone = (id, { date, done = true, today = localDate() } = {}) => mutate(db => {
  const item = findItem(db, id);
  const day = date ?? today;
  if (!isValidDate(day)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
  const before = batteryAt(db.items).level;

  let key = item.repeat ? day : item.date;
  if (item.type === 'todo' && !isAppointment(item)) key = day > today ? today : day; // går att bli klar i förtid
  let covered = null;
  if (done) {
    if (key > today) fail('Det ligger i framtiden. Bocka av det på dagen.');
    if (item.type === 'todo') item.doneOn = {};
    const entry = tick(item, db.items, key, key === today ? Date.now() : eveningOf(key));
    if (item.repeat && !occursOn(item, key, today)) covered = entry.covers = coverMissed(item, key, today);
    item.doneOn[key] = entry;
  } else if (item.type === 'todo') {
    item.doneOn = {};
  } else {
    item.skip = item.skip.filter(d => d !== item.doneOn[key]?.covers);
    delete item.doneOn[key];
  }

  const battery = batteryAt(db.items);
  return { item: occurrence(item, key, today), battery, gained: battery.level - before, covered };
});

// Gjort en annan dag än planerat: det räknas som det senast missade passet, så att sviten håller.
// Att byta dag är inget misslyckande, det är ju precis det man ska göra om måndagen sprack.
function coverMissed(item, date, today) {
  for (let i = 1; i <= 6; i++) {
    const missed = addDays(date, -i);
    if (occursOn(item, missed, today) && item.doneOn[missed] === undefined) {
      item.skip.push(missed);
      return missed;
    }
  }
  return null;
}

// Flyttar ett enda pass i en regel. Regeln och dess svit är kvar, det blir ingen kopia.
export const moveSession = (id, { from, to, today = localDate() } = {}) => mutate(db => {
  const item = findItem(db, id);
  if (!item.repeat) fail('Det går bara att flytta enstaka pass i något som upprepas. Ändra datumet i stället.');
  if (!isValidDate(from) || !isValidDate(to)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
  if (!occursOn(item, from, today)) fail(`${item.name} är inte planerad ${from}.`);
  if (item.doneOn[from] !== undefined) fail('Det passet är redan bockat.');
  if (occursOn(item, to, today)) fail(`${item.name} ligger redan på ${to}.`);
  item.extra = item.extra.filter(d => d !== from);
  item.skip = item.skip.filter(d => d !== to);
  item.skip.push(from);
  item.extra.push(to);
  if (item.notes[from]) {
    item.notes[to] = item.notes[from];
    delete item.notes[from];
  }
  return occurrence(item, to, today);
});

// Eget innehåll per dag i en regel, t.ex. en stegrande gitarrplan ovanpå ett dagligt pass.
export const setNotes = (id, notes) => mutate(db => {
  const item = findItem(db, id);
  for (const { date, text } of notes) {
    if (!isValidDate(date)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
    const t = String(text ?? '').trim();
    if (t.length > 200) fail('Beskrivningen får vara högst 200 tecken.');
    if (t) item.notes[date] = t;
    else delete item.notes[date];
  }
  return publicItem(item);
});

// Med date tas bara den dagen bort. Något med historik arkiveras i stället för att raderas,
// annars skulle batteriet tappa det man redan gjort.
export const deleteItem = (id, { date, today = localDate() } = {}) => mutate(db => {
  const item = findItem(db, id);
  if (item.repeat && date) {
    if (!isValidDate(date)) fail('Datumet måste vara ett riktigt datum (YYYY-MM-DD).');
    if (!item.skip.includes(date)) item.skip.push(date);
    delete item.doneOn[date];
    return occurrence(item, date, today);
  }
  const removed = publicItem(item);
  if (hasHistory(item)) {
    if (item.repeat) item.repeat.until = addDays(today, -1);
    item.archived = true;
  } else {
    db.items.splice(db.items.indexOf(item), 1);
  }
  return removed;
});

// ---- Profil och chatt ----

export async function getProfile() {
  return (await load()).profile;
}

// Exempeldata är ett val vid första start, inte något som dyker upp av sig självt.
function demoItems(today) {
  const start = addDays(today, -13);
  const friday = addDays(weekStart(today), 4);
  const deadline = friday > today ? friday : addDays(today, 4);
  const rule = { date: start, repeat: { days: ALL_DAYS, until: null } };
  return [
    { ...rule, type: 'routine', name: 'Morgonstretch', minutes: 10, time: '07:30', miss: 5 },
    { ...rule, type: 'routine', name: 'Gym', desc: 'Pass för överkroppen', minutes: 60, time: '18:00', prio: 'High', miss: 4, repeat: { days: [1, 4], until: null } },
    { ...rule, type: 'routine', name: 'Plugga', desc: 'Läs 30 sidor och anteckna', minutes: 45, prio: 'High', miss: 3, repeat: { days: [1, 2, 3, 4, 5], until: null } },
    { ...rule, type: 'hobby', name: 'Gitarr: fingerplockning', desc: 'Akustisk gitarr', minutes: 20, prio: 'Low', miss: 4 },
    { date: today, type: 'todo', name: 'Betala räkningar', desc: 'El- och internetfakturor' },
    { date: addDays(today, 2), type: 'todo', name: 'Tandläkarbesök', desc: 'Kontroll på Centrumkliniken', time: '14:30', prio: 'High' },
    { date: deadline, type: 'todo', name: 'Lämna in uppsats', prio: 'High' },
    { date: today, type: 'bonus', name: 'Kall dusch', desc: '2 minuters återhämtningsboost', minutes: 2, prio: 'Low' }
  ];
}

export const setup = ({ name, demo = false } = {}, today = localDate()) => mutate(db => {
  const n = String(name ?? '').trim();
  if (!n) fail('Skriv vad du heter.');
  if (n.length > 30) fail('Namnet får vara högst 30 tecken.');
  db.profile = { name: n };
  if (demo && !db.items.length) {
    const plan = demoItems(today).map(({ miss, ...input }) => ({ miss, item: pushItem(db, input) }));
    for (const { miss, item } of plan.filter(p => p.miss)) {
      expand([item], addDays(today, -7), addDays(today, -1), today).forEach((o, i) => {
        if ((i + 1) % miss) item.doneOn[o.date] = tick(item, db.items, o.date, eveningOf(o.date));
      });
      if (item.name === 'Morgonstretch') item.doneOn[today] = tick(item, db.items, today, Date.now() - 3600e3); // dagen har börjat
    }
  }
  return db.profile;
});

export async function getChat() {
  return (await load()).chat;
}

export const appendChat = messages => mutate(db => {
  db.chat = [...db.chat, ...messages].slice(-100);
});

export const clearChat = () => mutate(db => {
  db.chat = [];
  return db.chat;
});
