// agent.js – Dream AI som agent: Claude väljer verktyg, servern kör dem, loopar tills svaret är klart.
import * as db from './db.js';
import { LEVELS } from './energy.js';

const MAX_STEPS = 6; // skydd mot oändlig loop
const PARTIAL_REPLY = 'Jag hann bara med en del, se korten ovanför. Säg till om jag ska fortsätta.';

const repeatSchema = {
  type: 'object',
  description: 'Bara för det som återkommer. Utelämna för engångssaker.',
  properties: {
    days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Veckodagar: 0=sön, 1=mån, 2=tis, 3=ons, 4=tor, 5=fre, 6=lör' },
    until: { type: 'string', description: 'Sista dag, YYYY-MM-DD. Utelämna om det gäller tills vidare.' }
  },
  required: ['days']
};

const itemSchema = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD. Engångssak: dagen. todo: deadline. Med repeat: första dagen.' },
    type: { type: 'string', enum: db.TYPES, description: 'routine = rutin som upprepas, todo = att göra: uppgift med deadline, eller en tid att passa om time anges, hobby = det användaren vill bli bättre på, bonus = laddare: något personligt som ger användaren energi' },
    name: { type: 'string', description: 'Kort titel, max ca 4 ord. Hobbypass skrivs "Hobby: moment", t.ex. "Gitarr: skalor".' },
    desc: { type: 'string', description: 'En mening om vad som ska göras' },
    time: { type: 'string', description: 'Klockslag HH:MM, bara om det finns en bestämd tid. En todo med time är en tid att passa, som tandläkaren.' },
    minutes: { type: 'integer', description: 'Längd i minuter' },
    prio: { type: 'string', enum: db.PRIOS },
    charge: { type: 'integer', minimum: 1, maximum: 30, description: 'Bara för type bonus (laddare): hur många % energi det ger. Litet 5, normalt 10, stort 15–20.' },
    repeat: repeatSchema
  },
  required: ['date', 'type', 'name']
};

export const tools = [
  {
    name: 'list_items',
    description: 'Lista användarens rutiner/uppgifter/hobbyer. Med date eller from+to: det som är planerat de dagarna, med done per dag. Utan datum: alla sparade poster, oavsett dag. Använd query för att hitta något på namn. Kör detta innan du ändrar eller tar bort något, så du har rätt id.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        from: { type: 'string', description: 'YYYY-MM-DD, start (inklusive)' },
        to: { type: 'string', description: 'YYYY-MM-DD, slut (inklusive)' },
        type: { type: 'string', enum: db.TYPES },
        query: { type: 'string', description: 'Del av namnet, t.ex. "dusch". Ange utan datum för att söka överallt.' }
      }
    }
  },
  {
    name: 'add_items',
    description: 'Lägg till en eller flera aktiviteter. Allt som återkommer läggs som EN post med repeat, aldrig en post per dag. Flera poster används bara för pass som skiljer sig åt, som en hobbyplan med stegrande svårighet.',
    input_schema: {
      type: 'object',
      properties: { items: { type: 'array', items: itemSchema, minItems: 1, maxItems: 30 } },
      required: ['items']
    }
  },
  {
    name: 'update_item',
    description: 'Ändra en post via id. Skicka bara fälten som ändras. På en återkommande post gäller ändringen alla dagar.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, ...itemSchema.properties },
      required: ['id']
    }
  },
  {
    name: 'move_session',
    description: 'Flytta ETT pass i något som upprepas till en annan dag. Resten av schemat och sviten är kvar. Använd alltid detta, lägg aldrig till en ny post för att flytta ett pass.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        from: { type: 'string', description: 'Dagen passet ligger på, YYYY-MM-DD' },
        to: { type: 'string', description: 'Dagen det ska flyttas till, YYYY-MM-DD' }
      },
      required: ['id', 'from', 'to']
    }
  },
  {
    name: 'set_session_notes',
    description: 'Ge enskilda dagar i ett återkommande pass eget innehåll. Används för en stegrande plan ovanpå ett pass som redan finns: posten är kvar, men varje dag visar sitt moment.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, text: { type: 'string', description: 'Vad passet handlar om den dagen, en mening' } },
            required: ['date', 'text']
          },
          minItems: 1,
          maxItems: 31
        }
      },
      required: ['id', 'notes']
    }
  },
  {
    name: 'set_done',
    description: 'Bocka av eller ångra. Ange date för vilken dag det gäller, det behövs för återkommande poster.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD, som standard idag' }, done: { type: 'boolean', description: 'false ångrar en avbockning' } },
      required: ['id']
    }
  },
  {
    name: 'delete_item',
    description: 'Ta bort en post via id. Med date tas bara den dagen bort från en återkommande post. Utan date försvinner hela posten.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD, bara för återkommande poster' } },
      required: ['id']
    }
  },
  {
    name: 'get_energy',
    description: 'Dagens energi: check-in, energi nu i %, ikväll (nu minus det som är kvar), hur mycket planen behöver, hur länge energin räcker i fokus och hur stor del av dagens plan som är klar per typ.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'set_checkin',
    description: 'Spara hur användaren mår idag. Det blir dagens startenergi. Använd när användaren säger hur hen mår eller orkar ("helt slut", "trött", "okej", "pigg", "full energi").',
    input_schema: {
      type: 'object',
      properties: { level: { type: 'integer', enum: LEVELS.map(l => l.level), description: LEVELS.map(l => `${l.level} = ${l.label}`).join(', ') } },
      required: ['level']
    }
  },
  {
    name: 'get_progress',
    description: 'Hur det går över tid för rutiner och hobbyer: svit, antal pass denna vecka, minuter, och klart av planerat senaste 30 dagarna. Använd när användaren frågar om hen håller i något.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Del av namnet, t.ex. "gitarr". Utelämna för allt.' } } }
  }
];

// Kör ett verktyg. Returnerar { result, actions } – actions visas som kort i chatten.
async function runTool(name, input, today) {
  switch (name) {
    case 'list_items':
      return { result: await db.listItems({ ...input, today }), actions: [] };
    case 'add_items': {
      const added = await db.addItems(input.items);
      return { result: added, actions: added.map(i => ({ kind: 'add', item: i })) };
    }
    case 'update_item': {
      const { id, ...patch } = input;
      const item = await db.updateItem(id, patch);
      return { result: item, actions: [{ kind: 'update', item }] };
    }
    case 'move_session': {
      const item = await db.moveSession(input.id, { from: input.from, to: input.to, today });
      return { result: item, actions: [{ kind: 'move', item }] };
    }
    case 'set_session_notes': {
      const item = await db.setNotes(input.id, input.notes);
      return { result: item, actions: [{ kind: 'notes', item }] };
    }
    case 'set_done': {
      const out = await db.setDone(input.id, { date: input.date, done: input.done ?? true, today });
      return { result: out, actions: [{ kind: input.done === false ? 'undone' : 'done', item: out.item }] };
    }
    case 'delete_item': {
      const item = await db.deleteItem(input.id, { date: input.date, today });
      return { result: item, actions: [{ kind: input.date ? 'skip' : 'delete', item }] };
    }
    case 'get_energy':
      return { result: await db.getEnergy(today), actions: [] };
    case 'set_checkin': {
      const energy = await db.setCheckin(input.level, { today });
      const item = { id: 0, type: 'routine', name: `Check-in: ${energy.label}`, date: today };
      return { result: energy, actions: [{ kind: 'checkin', item }] };
    }
    case 'get_progress':
      return { result: await db.getProgress({ query: input.query, today }), actions: [] };
    default:
      throw new Error(`Okänt verktyg: ${name}`);
  }
}

function systemPrompt(today) {
  const weekday = new Date(today + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long' });
  return `Du är Dream AI, assistenten i appen Pulse för unga (17–23 år).
Appen har tre delar: hälsa (hälsobatteri), vardagsrutiner och hobbystöd.
Idag är ${weekday} ${today}. Räkna ut datum som "imorgon" eller "på fredag" utifrån det.

Så fungerar appen:
- Det som återkommer är EN post med repeat (veckodagar och ev. sista dag). Det gäller hur långt fram som helst, och man bockar av dag för dag.
- En todo har en deadline i date. Är den inte klar när dagen passerat följer den med till idag.
- Energin gäller idag. Den börjar på morgonens check-in (20 helt slut, 40 trött, 60 okej, 80 pigg, 100 full energi). Fokus använder energi: 1 timme = 20 %, och längden kommer från passet (20 minuter om den saknas). Laddare (type bonus) ger tillbaka så många % som användaren valt. Ikväll = energin nu minus det som är kvar idag. Under 0 betyder att dagen är överbokad.
- Att använda energi på fokus är bra, inte en förlust: det blir framsteg i dagens plan. Prata aldrig om uppgifter som något som "tar" eller "kostar".
- En todo med klockslag är en tid att passa, som tandläkaren. Den kan inte bli försenad.
- Appen har inga notiser. Lova aldrig att påminna, säg i stället att det ligger i schemat.

Du kan läsa och ändra användarens schema med verktygen. Regler:
- Agera hellre än fråga. Fråga bara om du inte kan göra en rimlig gissning.
- Det viktigaste: så fort användaren säger att hen gjort, är klar med eller hunnit något ("pluggat klart", "var på gymmet", "klar med gitarren") ska du bocka av det. Kör list_items för idag, hitta det som matchar bäst (även om språket eller ordformen skiljer, t.ex. "pluggat" = "Plugga", "kall dusch" = "Cold Shower") och kör set_done. Gäller även mitt i ett annat samtal. Beröm aldrig utan att ha bockat av först. Finns inget som matchar, fråga om du ska lägga till det.
- När något ska hittas, ändras eller tas bort: sök med list_items och query utan datum, så hittar du det oavsett vilken dag det ligger på.
- Innan du lägger till något: kolla med list_items och query om det redan finns, så att inget blir dubbelt.
- Använd exakt den tid användaren anger. Saknas tid, utgå från det som redan finns för samma sak, annars 20 minuter.
- Ett enstaka pass som ska byta dag: move_session. Lägg aldrig till en ny post för det.
- Frågar användaren om hen håller i något eller hur det går: kör get_progress och svara med siffrorna.
- Hobbyplan: skapa planen direkt, utan motfrågor, 7 dagar från idag om inget annat sägs och med stegrande svårighet. Finns redan ett återkommande pass för hobbyn: behåll det och ge varje dag sitt moment med set_session_notes. Annars: lägg ett pass per dag med add_items (type "hobby", namn som "Gitarr: skalor"). Fråga bara om hobbyn saknas.
- Säger användaren hur hen mår: kör set_checkin med närmaste nivå.
- Är dagen överbokad (ikväll under 0) och användaren frågar vad hen ska göra: föreslå att flytta det som är minst viktigt med move_session eller ett nytt datum. Flytta inget utan att användaren sagt ja.
- Laddare är personliga. Föreslå aldrig allmänna saker som vatten eller promenad. Vill användaren hitta sina laddare: fråga en gång vad som brukar ge hen energi eller göra hen glad, och lägg sedan in det hen säger som type "bonus" med charge, med repeat om det är något återkommande. Nämner användaren något som gav energi, erbjud att spara det som laddare.
- Hämta id med list_items innan du ändrar eller tar bort. Ta bort flera saker bara om användaren tydligt bett om det.
- Rader i historiken som börjar med [Utfört: är appens egen logg över vad du faktiskt gjorde. De stämmer. Skriv aldrig sådana rader själv, och ta inte tillbaka eller rätta tidigare svar om användaren inte frågar.
- Lova inget du inte gjort än. Gör det först och berätta sedan vad som hände.
- Använd appens ord: Rutiner, Att göra, Hobby, Laddare, Energi, Fokus. Säg inte vanor, poäng, batteri eller hälsotips.
- Svara på svenska, kort (1–3 meningar), peppigt men inte överdrivet. Ingen markdown.`;
}

// Modellen minns bara text, så det den gjorde följer med som en loggrad. Utan den ser den
// sina egna påståenden utan spår av arbetet och "rättar" dem.
const ACTION_LOG = { checkin: 'Sparade check-in', add: 'La till', done: 'Bockade av', undone: 'Ångrade bock', update: 'Ändrade', delete: 'Tog bort', skip: 'Tog bort en dag av', move: 'Flyttade ett pass av', notes: 'Planerade innehåll i' };

export function toModelMessages(chat) {
  return chat.map(({ role, content, actions }) => {
    if (!actions?.length) return { role, content };
    const log = actions.map(a => `${ACTION_LOG[a.kind]} "${a.item.name}" (${a.item.date}, id ${a.item.id})`).join('; ');
    return { role, content: `${content}\n\n[Utfört: ${log}]` };
  });
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
    let res;
    try {
      res = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt(today),
        tools,
        messages
      });
    } catch (err) {
      if (!actions.length) throw err;
      return { reply: PARTIAL_REPLY, actions }; // det som hunnit sparas ska inte se misslyckat ut
    }

    // Svaret klipptes av: tool_use-input kan vara ofullständig, så inga verktyg körs.
    if (res.stop_reason === 'max_tokens') {
      return { reply: actions.length ? PARTIAL_REPLY : 'Planen blev för lång för mig, be om färre dagar så försöker jag igen.', actions };
    }

    if (res.stop_reason !== 'tool_use') {
      const reply = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { reply: reply || (actions.length ? 'Klart!' : 'Jag fick inget svar, försök igen.'), actions };
    }

    // Modellen vill köra verktyg: spara dess tur, kör alla tool_use, skicka tillbaka resultaten.
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const block of res.content.filter(b => b.type === 'tool_use')) {
      try {
        const { result, actions: a } = await runTool(block.name, block.input, today);
        actions.push(...a);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        // Felet går tillbaka till modellen så den kan rätta sig själv.
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Fel: ${err.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: actions.length ? PARTIAL_REPLY : 'Jag hann inte bli klar, försök formulera dig kortare.', actions };
}
