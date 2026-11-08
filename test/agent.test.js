// Testar agent-loopen utan riktig AI: en mock-klient spelar upp svar som Claude skulle ge.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './test/test-db.json';
const db = await import('../db.js');
const { runAgent, toModelMessages } = await import('../agent.js');

before(async () => {
  rmSync(process.env.DB_PATH, { force: true });
  await db.setup({ name: 'Oscar', demo: true });
});

// Mock: returnerar förinspelade svar i ordning och sparar vad agenten skickade.
function mockClient(script) {
  const calls = [];
  return {
    calls,
    messages: { create: async (req) => { calls.push(structuredClone(req)); return script.shift(); } }
  };
}
const toolUse = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const text = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

test('hobbyplan: agenten lägger till flera pass', async () => {
  const today = db.localDate();
  const client = mockClient([
    toolUse('t1', 'add_items', { items: [
      { date: today, type: 'hobby', name: 'Gitarr: skalor', minutes: 20 },
      { date: db.localDate(1), type: 'hobby', name: 'Gitarr: improvisation', minutes: 20 }
    ] }),
    text('Klart! Två gitarrpass inlagda.')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'gör en gitarrplan' }], today);
  assert.equal(out.reply, 'Klart! Två gitarrpass inlagda.');
  assert.equal(out.actions.length, 2);
  assert.equal(out.actions[0].kind, 'add');
  const hobbies = await db.listItems({ type: 'hobby' });
  assert.ok(hobbies.some(i => i.name === 'Gitarr: improvisation'));
  // Andra anropet ska innehålla tool_result kopplat till rätt id
  const last = client.calls[1].messages.at(-1);
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 't1');
});

test('bocka av: list_items → set_done, dagens plan går framåt', async () => {
  const today = db.localDate();
  const before = (await db.getEnergy(today)).plan.doneMinutes;
  const target = (await db.listItems({ date: today })).find(i => !i.done);
  const client = mockClient([
    toolUse('a', 'list_items', { date: today }),
    toolUse('b', 'set_done', { id: target.id, date: today }),
    text('Bra jobbat!')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: `jag har gjort ${target.name}` }], today);
  assert.equal(out.actions[0].kind, 'done');
  assert.ok((await db.getEnergy(today)).plan.doneMinutes > before);
});

test('check-in: "jag är trött" sparar startenergin och visas som kort', async () => {
  const today = db.localDate();
  const client = mockClient([toolUse('c', 'set_checkin', { level: 40 }), text('Okej, vi tar det lugnt idag.')]);
  const out = await runAgent(client, [{ role: 'user', content: 'jag är trött idag' }], today);
  assert.equal(out.actions[0].kind, 'checkin');
  assert.equal(out.actions[0].item.name, 'Check-in: Trött');
  assert.equal((await db.getEnergy(today)).checkin, 40);
});

test('laddare: agenten kan lägga in en personlig laddare med egen laddning', async () => {
  const today = db.localDate();
  const client = mockClient([
    toolUse('l', 'add_items', { items: [{ date: today, type: 'bonus', name: 'Ringa mormor', charge: 15 }] }),
    text('Sparat som laddare.')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'jag blir glad av att ringa mormor' }], today);
  assert.equal(out.actions[0].item.charge, 15);
});

test('återkommande: en post med repeat syns varje dag utan kopior', async () => {
  const today = db.localDate();
  const client = mockClient([
    toolUse('r', 'add_items', { items: [{ date: today, type: 'routine', name: 'Vattna', repeat: { days: [0, 1, 2, 3, 4, 5, 6] } }] }),
    text('Inlagt!')
  ]);
  await runAgent(client, [{ role: 'user', content: 'vattna blommorna varje dag' }], today);
  assert.equal((await db.listItems({ query: 'vattna' })).length, 1);
  assert.equal((await db.listItems({ from: today, to: db.localDate(29), query: 'vattna' })).length, 30);
});

test('list_items hittar saker på namn utan datum', async () => {
  const client = mockClient([toolUse('q', 'list_items', { query: 'dusch' }), text('Hittade den.')]);
  await runAgent(client, [{ role: 'user', content: 'ta bort kall dusch' }], db.localDate());
  const found = JSON.parse(client.calls[1].messages.at(-1).content[0].content);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Kall dusch');
});

test('flytta ett pass: en post, ingen kopia', async () => {
  const today = db.localDate();
  const weekday = new Date(db.localDate(2) + 'T12:00:00').getDay();
  const r = await db.addItem({ date: today, type: 'routine', name: 'Simning', repeat: { days: [weekday] } });
  const before = (await db.listItems()).length;
  const client = mockClient([
    toolUse('m', 'move_session', { id: r.id, from: db.localDate(2), to: db.localDate(3) }),
    text('Flyttat!')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'flytta simningen' }], today);
  assert.equal(out.actions[0].kind, 'move');
  assert.equal(out.actions[0].item.date, db.localDate(3));
  assert.equal((await db.listItems()).length, before);
});

test('fel i verktyg skickas tillbaka till modellen (is_error)', async () => {
  const client = mockClient([
    toolUse('x', 'delete_item', { id: 99999 }),
    text('Hittade inte den uppgiften.')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'ta bort grejen' }], db.localDate());
  const res = client.calls[1].messages.at(-1).content[0];
  assert.equal(res.is_error, true);
  assert.match(res.content, /Inget item/);
  assert.equal(out.actions.length, 0);
});

test('ett ogiltigt item i add_items sparar ingenting', async () => {
  const before = (await db.listItems()).length;
  const client = mockClient([
    toolUse('v', 'add_items', { items: [
      { date: db.localDate(), type: 'hobby', name: 'Giltigt pass' },
      { date: '2026-13-45', type: 'hobby', name: 'Trasigt pass' }
    ] }),
    text('Det gick inte.')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'lägg in två pass' }], db.localDate());
  assert.equal(out.actions.length, 0);
  assert.equal((await db.listItems()).length, before);
});

test('loopen stannar efter MAX_STEPS', async () => {
  const script = Array.from({ length: 10 }, (_, i) => toolUse('l' + i, 'get_energy', {}));
  const out = await runAgent(mockClient(script), [{ role: 'user', content: 'loop' }], db.localDate());
  assert.match(out.reply, /hann inte/);
});

test('max_tokens: avklippt tool_use körs inte', async () => {
  const before = (await db.listItems()).length;
  const client = mockClient([
    { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 'm1', name: 'add_items', input: { items: [
      { date: db.localDate(), type: 'hobby', name: 'Avklippt pass' }
    ] } }] }
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'gör en plan för hela året' }], db.localDate());
  assert.equal(out.reply, 'Planen blev för lång för mig, be om färre dagar så försöker jag igen.');
  assert.equal(out.actions.length, 0);
  assert.equal((await db.listItems()).length, before);
  assert.equal(client.calls.length, 1); // inget tool_result skickades tillbaka
});

test('max_tokens efter en sparad ändring: svaret säger inte att allt misslyckades', async () => {
  const client = mockClient([
    toolUse('p', 'add_items', { items: [{ date: db.localDate(), type: 'bonus', name: 'Promenad' }] }),
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Och sen' }] }
  ]);
  const out = await runAgent(client, [{ role: 'user', content: 'lägg in en promenad och mer' }], db.localDate());
  assert.equal(out.actions.length, 1);
  assert.match(out.reply, /hann bara med en del/);
});

test('API-fel efter en sparad ändring: det som gjorts går inte förlorat', async () => {
  const script = [toolUse('e', 'add_items', { items: [{ date: db.localDate(), type: 'bonus', name: 'Vatten' }] })];
  const client = { messages: { create: async () => { if (script.length) return script.shift(); throw new Error('overloaded'); } } };
  const out = await runAgent(client, [{ role: 'user', content: 'lägg in vatten' }], db.localDate());
  assert.equal(out.actions.length, 1);
  assert.match(out.reply, /hann bara med en del/);
});

test('historiken bär med sig vad agenten faktiskt gjorde', () => {
  const msgs = toModelMessages([
    { role: 'user', content: 'flytta tandläkaren' },
    { role: 'assistant', content: 'Fixat!', actions: [{ kind: 'update', item: { id: 6, name: 'Tandläkarbesök', date: '2026-11-05' } }] },
    { role: 'user', content: 'tack' }
  ]);
  assert.match(msgs[1].content, /^Fixat!/);
  assert.match(msgs[1].content, /\[Utfört: Ändrade "Tandläkarbesök" \(2026-11-05, id 6\)\]/);
  assert.equal(msgs[2].content, 'tack');
});
