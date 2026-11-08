// energy.js – energin för idag. Rena funktioner, så att reglerna går att testa och förklara.
//
// Fyra regler:
// 1. Start: morgonens check-in (20–100).
// 2. Fokus använder energi: 1 timme = 20 %. Längden kommer från passet, ingen behöver gissa.
// 3. Laddare (typen bonus) ger energi tillbaka, så mycket som användaren själv valt.
// 4. Ikväll = nu minus det som är kvar i dagens plan.

export const FOCUS_PER_HOUR = 20;
export const DEFAULT_MINUTES = 20; // saknas längd räknas ett pass som 20 minuter
export const DEFAULT_CHARGE = 10;
export const LEVELS = [
  { level: 20, label: 'Helt slut' },
  { level: 40, label: 'Trött' },
  { level: 60, label: 'Okej' },
  { level: 80, label: 'Pigg' },
  { level: 100, label: 'Full energi' }
];
export const PLAN_TYPES = ['routine', 'todo', 'hobby'];

const MAX = 100;
const clamp = v => Math.max(0, Math.min(MAX, v));

export const isFocus = item => item.type !== 'bonus';
export const minutesOf = item => item.minutes ?? DEFAULT_MINUTES;

// Avrundat till hela 5 %, minst 5: ett kort pass kostar ändå något.
export const costOf = item => Math.max(5, Math.round((minutesOf(item) * FOCUS_PER_HOUR) / 60 / 5) * 5);
export const chargeOf = item => item.charge ?? DEFAULT_CHARGE;

// Vad en rad gör med energin: negativt för fokus, positivt för en laddare.
export const deltaOf = item => (isFocus(item) ? -costOf(item) : chargeOf(item));

export const statusOf = level => (level >= 80 ? 'Full fart' : level >= 50 ? 'Bra läge' : level >= 20 ? 'Hushålla' : 'Ladda');
export const labelOf = level => LEVELS.find(l => l.level === level)?.label ?? null;

/**
 * @param {object} p
 * @param {number|null} p.checkin   dagens check-in, null om användaren inte checkat in
 * @param {Array} p.done            det som bockats av idag: { type, minutes, charge }
 * @param {Array} p.remaining       det som är kvar idag (inga laddare): { type, minutes }
 */
export function energyFor({ checkin = null, done = [], remaining = [] }) {
  const spent = done.filter(isFocus).reduce((s, i) => s + costOf(i), 0);
  const charged = done.filter(i => !isFocus(i)).reduce((s, i) => s + chargeOf(i), 0);
  const need = remaining.filter(isFocus).reduce((s, i) => s + costOf(i), 0);

  const byType = Object.fromEntries(PLAN_TYPES.map(t => [t, { done: 0, planned: 0 }]));
  for (const i of done.filter(isFocus)) { byType[i.type].done += minutesOf(i); byType[i.type].planned += minutesOf(i); }
  for (const i of remaining.filter(isFocus)) byType[i.type].planned += minutesOf(i);
  const doneMin = PLAN_TYPES.reduce((s, t) => s + byType[t].done, 0);
  const plannedMin = PLAN_TYPES.reduce((s, t) => s + byType[t].planned, 0);
  const plan = { byType, doneMinutes: doneMin, plannedMinutes: plannedMin, pct: plannedMin ? Math.round((doneMin / plannedMin) * 100) : 0 };

  if (checkin === null) return { checkin: null, label: null, now: null, tonight: null, need, spent, charged, focusMinutesLeft: null, status: null, plan };

  const now = clamp(checkin - spent + charged);
  return {
    checkin,
    label: labelOf(checkin),
    now,
    tonight: now - need, // kan bli negativt: då är dagen överbokad
    need,
    spent,
    charged,
    focusMinutesLeft: Math.round((now / FOCUS_PER_HOUR) * 60 / 15) * 15,
    status: statusOf(now),
    plan
  };
}
