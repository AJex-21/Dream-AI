// Testar agent-loopen utan riktig AI: en mock-klient spelar upp svar som Claude skulle ge.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './test/test-db.json';
const db = await import('../db.js');
const { runAgent } = await import('../agent.js');

before(() => rmSync(process.env.DB_PATH, { force: true }));

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
      { date: today, type: 'hobby', name: 'Gitarr: skalor', minTime: 20, maxTime: 30 },
      { date: db.localDate(1), type: 'hobby', name: 'Gitarr: improvisation', minTime: 20, maxTime: 30 }
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

test('bocka av: list_items → update_item, batteriet stiger', async () => {
  const today = db.localDate();
  const before = (await db.getBattery(today)).total;
  const target = (await db.listItems({ date: today })).find(i => !i.done);
  const client = mockClient([
    toolUse('a', 'list_items', { date: today }),
    toolUse('b', 'update_item', { id: target.id, done: true }),
    text('Bra jobbat!')
  ]);
  const out = await runAgent(client, [{ role: 'user', content: `jag har gjort ${target.name}` }], today);
  assert.equal(out.actions[0].kind, 'done');
  assert.ok((await db.getBattery(today)).total > before);
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

test('validering stoppar ogiltig data', async () => {
  await assert.rejects(db.addItem({ date: 'imorgon', type: 'hobby', name: 'x' }), /YYYY-MM-DD/);
  await assert.rejects(db.addItem({ date: '2026-11-02', type: 'sport', name: 'x' }), /type/);
});

test('loopen stannar efter MAX_STEPS', async () => {
  const script = Array.from({ length: 10 }, (_, i) => toolUse('l' + i, 'get_battery', { date: db.localDate() }));
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
