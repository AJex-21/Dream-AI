// agent.js – Dream AI som agent: Claude väljer verktyg, servern kör dem, loopar tills svaret är klart.
import * as db from './db.js';

const MAX_STEPS = 6; // skydd mot oändlig loop

const itemSchema = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD' },
    type: { type: 'string', enum: db.TYPES, description: 'routine = återkommande vana, todo = engångsuppgift, hobby = hobbyträning, bonus = hälsoboost (vatten, promenad, paus)' },
    name: { type: 'string', description: 'Kort titel, max ca 4 ord' },
    desc: { type: 'string', description: 'En mening om vad som ska göras' },
    minTime: { type: 'integer', description: 'Minsta tid i minuter' },
    maxTime: { type: 'integer', description: 'Max tid i minuter' },
    prio: { type: 'string', enum: db.PRIOS }
  },
  required: ['date', 'type', 'name']
};

export const tools = [
  {
    name: 'list_items',
    description: 'Lista användarens rutiner/uppgifter/hobbyer. Använd innan du ändrar eller tar bort något, så du har rätt id. Ange date ELLER from+to.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        from: { type: 'string', description: 'YYYY-MM-DD, start (inklusive)' },
        to: { type: 'string', description: 'YYYY-MM-DD, slut (inklusive)' },
        type: { type: 'string', enum: db.TYPES }
      }
    }
  },
  {
    name: 'add_items',
    description: 'Lägg till en eller flera aktiviteter. Använd för enstaka uppgifter och för hela hobbyplaner över flera dagar (ett item per pass).',
    input_schema: {
      type: 'object',
      properties: { items: { type: 'array', items: itemSchema, minItems: 1, maxItems: 30 } },
      required: ['items']
    }
  },
  {
    name: 'update_item',
    description: 'Ändra ett item via id. Sätt done=true för att bocka av. Skicka bara fälten som ändras.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, ...itemSchema.properties, done: { type: 'boolean' } },
      required: ['id']
    }
  },
  {
    name: 'delete_item',
    description: 'Ta bort ett item via id.',
    input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
  },
  {
    name: 'get_battery',
    description: 'Hämta hälsobatteriet för ett datum: total % och % per kategori.',
    input_schema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] }
  }
];

// Kör ett verktyg. Returnerar { result, actions } – actions visas som kort i chatten.
async function runTool(name, input) {
  switch (name) {
    case 'list_items':
      return { result: await db.listItems(input), actions: [] };
    case 'add_items': {
      const added = [];
      for (const it of input.items) added.push(await db.addItem(it));
      return { result: added, actions: added.map(i => ({ kind: 'add', item: i })) };
    }
    case 'update_item': {
      const { id, ...patch } = input;
      const item = await db.updateItem(id, patch);
      return { result: item, actions: [{ kind: patch.done === true ? 'done' : 'update', item }] };
    }
    case 'delete_item': {
      const item = await db.deleteItem(input.id);
      return { result: item, actions: [{ kind: 'delete', item }] };
    }
    case 'get_battery':
      return { result: await db.getBattery(input.date), actions: [] };
    default:
      throw new Error(`Okänt verktyg: ${name}`);
  }
}

function systemPrompt(today) {
  const weekday = new Date(today + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long' });
  return `Du är Dream AI, en personlig assistent i appen Dream Assistent för unga (17–23 år).
Appen har tre delar: hälsa (hälsobatteri), vardagsrutiner och hobbystöd.
Idag är ${weekday} ${today}. Räkna ut datum som "imorgon" eller "på fredag" utifrån det.

Du kan läsa och ändra användarens schema med verktygen. Regler:
- Agera hellre än fråga. Fråga bara om du inte kan göra en rimlig gissning.
- När användaren säger att hen gjort något: kör list_items för idag, hitta det item som matchar bäst (även om språket skiljer, t.ex. "kall dusch" = "Cold Shower") och bocka av med update_item done=true. Finns inget som matchar, fråga om du ska lägga till det.
- Hobbyplan: om hobby och tid per dag finns, skapa planen direkt med add_items (7 dagar från idag om inget annat sägs, type "hobby", ett pass per dag, stegrande svårighet). Fråga bara om hobbyn saknas.
- Hälsotips (vatten, promenad, mikropaus) läggs som type "bonus".
- Hämta id med list_items innan du ändrar eller tar bort. Ta bort flera saker bara om användaren tydligt bett om det.
- Svara på svenska, kort (1–3 meningar), peppigt men inte överdrivet. Ingen markdown.`;
}

/**
 * @param {object} client  Anthropic-klient (eller mock i tester)
 * @param {Array}  history [{role:'user'|'assistant', content:string}]
 * @param {string} today   YYYY-MM-DD (klientens lokala datum)
 */
export async function runAgent(client, history, today) {
  // Läses här, inte vid import: server.js kör dotenv.config() först efter att importerna laddats.
  const model = process.env.MODEL || 'claude-haiku-5-5';
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  const actions = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt(today),
      tools,
      messages
    });

    if (res.stop_reason !== 'tool_use') {
      const reply = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { reply: reply || 'Klart!', actions };
    }

    // Modellen vill köra verktyg: spara dess tur, kör alla tool_use, skicka tillbaka resultaten.
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const block of res.content.filter(b => b.type === 'tool_use')) {
      try {
        const { result, actions: a } = await runTool(block.name, block.input);
        actions.push(...a);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        // Felet går tillbaka till modellen så den kan rätta sig själv.
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Fel: ${err.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'Jag hann inte bli klar, försök formulera dig kortare.', actions };
}
