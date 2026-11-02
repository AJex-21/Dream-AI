// schedule.js – när ett item inträffar. Rena funktioner utan I/O, så de går att testa utan databas.

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // samma numrering som Date.getDay(): 0 = söndag
const PRIO_ORDER = { High: 0, Medium: 1, Low: 2 };

const parse = date => new Date(date + 'T12:00:00'); // mitt på dagen: sommartid kan inte byta datum

export function formatDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Riktig kalenderkontroll: en regex ensam släpper igenom 2026-13-45.
export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && formatDate(parse(s)) === s;
}

export function addDays(date, n) {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export const weekStart = date => addDays(date, -((parse(date).getDay() + 6) % 7)); // måndag

// En uppgift med klockslag är en tid att passa: den har ingen deadline och kan inte bli försenad.
export const isAppointment = item => item.type === 'todo' && Boolean(item.time);

// Hamnar item på den här dagen? Att göra följer sin deadline: öppna rullar över till idag,
// klara ligger kvar den dag de blev klara. Avbockat syns alltid, även om regeln ändrats efteråt.
export function occursOn(item, date, today) {
  if (item.doneOn[date] !== undefined) return true;
  if (item.type === 'todo') {
    if (Object.keys(item.doneOn).length) return false;
    return date === item.date || (!isAppointment(item) && date === today && item.date < today);
  }
  if (!item.repeat) return date === item.date;
  if (item.skip.includes(date)) return false;
  if (item.extra.includes(date)) return true; // ett enskilt pass som flyttats hit
  if (date < item.date || (item.repeat.until && date > item.repeat.until)) return false;
  return item.repeat.days.includes(parse(date).getDay());
}

// En rad i schemat: regelns fält plus dagens status. `start` är regelns första dag.
export function occurrence(item, date, today) {
  const { doneOn, skip, extra, notes, ...rest } = item;
  const entry = doneOn[date];
  const occ = { ...rest, start: item.date, date, done: Boolean(entry), desc: notes[date] ?? item.desc };
  if (entry) Object.assign(occ, { minutes: entry.minutes, time: entry.time }); // gjort är gjort, även om regeln ändras
  if (item.type === 'todo') {
    occ.deadline = item.date;
    occ.appointment = isAppointment(item);
    occ.overdue = !entry && !occ.appointment && item.date < today;
  }
  return occ;
}

export function expand(items, from, to, today) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const item of items) if (occursOn(item, d, today)) out.push(occurrence(item, d, today));
  }
  return out;
}

// Dagens ordning: öppet före klart, försenat först, sedan klockslag, sedan prioritet.
export function sortDay(list) {
  return [...list].sort((a, b) =>
    a.done - b.done ||
    Boolean(b.overdue) - Boolean(a.overdue) ||
    (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
    PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] ||
    a.id - b.id
  );
}

// "Gitarr: skalor" och "Gitarr: ackordbyten" är samma hobby.
export const groupName = name => name.split(':')[0].trim();

// Hur det har gått över tid. Svit räknas i planerade pass, så Gym mån+tor bryts inte av en tisdag.
export function progress(items, today) {
  const occs = expand(items, addDays(today, -59), today, today);
  const days = {}; // datum → klart minst ett pass den dagen?
  for (const o of occs) days[o.date] ||= o.done;

  let streak = 0;
  for (const date of Object.keys(days).sort().reverse()) {
    if (days[date]) streak++;
    else if (date !== today) break; // idag är inte missat förrän dagen är slut
  }

  // Prickarna och siffrorna gäller samma sak: den här veckan, måndag till söndag.
  const monday = weekStart(today);
  const week = expand(items, monday, addDays(monday, 6), today);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const sessions = week.filter(o => o.date === date);
    if (!sessions.length) return { date, state: 'none' };
    if (sessions.some(o => o.done)) return { date, state: 'done' };
    if (date > today) return { date, state: 'planned' };
    return { date, state: date === today ? 'pending' : 'missed' };
  });

  const weekDone = week.filter(o => o.done);
  const month = occs.filter(o => o.date >= addDays(today, -29));
  return {
    week: weekDays,
    streak,
    weekDone: weekDone.length,
    weekPlanned: week.length,
    weekMinutes: weekDone.reduce((sum, o) => sum + (o.minutes ?? 0), 0),
    monthDone: month.filter(o => o.done).length,
    monthPlanned: month.length
  };
}

// Livsbalans: andel klart av det planerade per kategori senaste 7 dagarna. null = inget planerat.
// Det som är kvar idag är inte missat än, och försenat räknas en gång.
export function balance(items, today) {
  const occs = expand(items, addDays(today, -6), today, today)
    .filter(o => o.done || (o.date !== today && (o.type !== 'todo' || o.date === o.deadline)));
  const out = {};
  for (const type of ['routine', 'todo', 'hobby', 'bonus']) {
    const of = occs.filter(o => o.type === type);
    out[type] = of.length ? Math.round((of.filter(o => o.done).length / of.length) * 100) : null;
  }
  return out;
}
