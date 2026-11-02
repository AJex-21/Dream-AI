// battery.js – hälsobatteriet. Nivån sparas aldrig utan räknas fram ur det som är avbockat,
// så ångra, efterregistrering och nästa morgon blir rätt utan specialfall.
import { addDays, weekStart } from './schedule.js';

export const DRAIN_PER_HOUR = 1; // 100 % räcker ca 4 dygn
const HOUR = 3600e3;
const MAX = 100;
const FLAT_CHARGE = 5; // att göra och bonus ligger utanför planen: lite extra, aldrig huvudsaken
// En hel vecka enligt plan laddar 1,5 gånger det batteriet tappar: håller man två tredjedelar
// står nivån still, håller man allt stiger den.
const WEEK_CHARGE = 7 * 24 * DRAIN_PER_HOUR * 1.5;

const inPlan = item => item.type === 'routine' || item.type === 'hobby';
const weight = item => 8 + Math.round(Math.min(item.minutes ?? 20, 60) / 5); // längre pass väger mer

// Planens tyngd den vecka datumet ligger i. En regel räknas per hel vecka oavsett startdag,
// annars skulle första passet en söndag vara värt en hel veckas laddning.
function planWeight(items, date) {
  const monday = weekStart(date);
  const sunday = addDays(monday, 6);
  return items.filter(inPlan).reduce((sum, it) => {
    if (!it.repeat) return sum + (it.date >= monday && it.date <= sunday ? weight(it) : 0);
    const active = it.date <= sunday && (!it.repeat.until || it.repeat.until >= monday);
    return sum + (active ? weight(it) * it.repeat.days.length : 0);
  }, 0);
}

// Det något laddar är dess andel av veckans plan. Det är att hålla planen som räknas,
// inte hur mycket man planerat: en liten plan fylls lika bra som en stor.
export function gainFor(item, items, date) {
  if (!inPlan(item)) return FLAT_CHARGE;
  const share = weight(item) / Math.max(planWeight(items, date), weight(item));
  return Math.min(MAX, Math.max(1, Math.round(share * WEEK_CHARGE)));
}

// Fördelar heltal så att delarna alltid summerar till nivån som visas.
function roundParts(parts, total) {
  const keys = Object.keys(parts);
  const out = Object.fromEntries(keys.map(k => [k, Math.floor(parts[k])]));
  let rest = total - keys.reduce((sum, k) => sum + out[k], 0);
  const byFraction = [...keys].sort((a, b) => (parts[b] % 1) - (parts[a] % 1));
  for (let i = 0; rest > 0; i++, rest--) out[byFraction[i % keys.length]]++;
  return out;
}

/** Spelar upp alla avbockningar i tidsordning: nivån sjunker mellan dem och stiger vid varje. */
export function batteryAt(items, now = Date.now()) {
  const events = items
    .flatMap(it => Object.values(it.doneOn).map(({ at, gain }) => ({ at, gain, type: it.type })))
    .filter(e => e.at <= now)
    .sort((a, b) => a.at - b.at);

  const parts = { routine: 0, todo: 0, hobby: 0, bonus: 0 };
  let level = 0;
  let clock = null;
  const drainTo = time => {
    if (clock !== null && level > 0) {
      const next = Math.max(0, level - ((time - clock) / HOUR) * DRAIN_PER_HOUR);
      for (const k in parts) parts[k] *= next / level; // varje kategori sjunker lika mycket
      level = next;
    }
    clock = time;
  };

  for (const e of events) {
    drainTo(e.at);
    const gain = Math.min(e.gain, MAX - level);
    parts[e.type] += gain;
    level += gain;
  }
  drainTo(now);

  const hoursLeft = level / DRAIN_PER_HOUR;
  const rounded = Math.round(level);
  return {
    level: rounded,
    byType: roundParts(parts, rounded),
    hoursLeft: Math.round(hoursLeft * 10) / 10,
    emptyAt: level > 0 ? new Date(now + hoursLeft * HOUR).toISOString() : null,
    drainPerHour: DRAIN_PER_HOUR
  };
}
