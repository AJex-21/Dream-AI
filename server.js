// server.js – Express: serverar frontend + REST-API + agent-endpoint.
import './env.js';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import * as db from './db.js';
import { runAgent, toModelMessages } from './agent.js';
import { isValidDate } from './schedule.js';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // bara den här datorn: chatten kostar pengar och saknar inloggning
const client = new Anthropic(); // läser ANTHROPIC_API_KEY från .env

app.use(express.json());
app.use(express.static('public'));

// Gemensam felhantering: valideringsfel → 400 med meddelande
const handle = fn => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Klienten vet vilken dag det är där användaren är. Saknas datumet gäller serverns.
const todayOf = v => (isValidDate(v) ? v : db.localDate());

// ---- REST: samma data som AI:n använder ----
app.get('/api/items', handle(req => db.listItems({ ...req.query, today: todayOf(req.query.today) })));
app.post('/api/items', handle(req => db.addItem(req.body)));
app.patch('/api/items/:id', handle(req => db.updateItem(req.params.id, req.body)));
app.delete('/api/items/:id', handle(req => db.deleteItem(req.params.id, { date: req.query.date, today: todayOf(req.query.today) })));
app.post('/api/items/:id/done', handle(req => db.setDone(req.params.id, { ...req.body, today: todayOf(req.body?.today) })));
app.post('/api/items/:id/move', handle(req => db.moveSession(req.params.id, { ...req.body, today: todayOf(req.body?.today) })));
app.get('/api/day', handle(req => db.getDay(req.query.date, todayOf(req.query.today))));
app.get('/api/week', handle(req => db.getWeek(req.query.date, todayOf(req.query.today))));
app.get('/api/overview', handle(req => db.getOverview(todayOf(req.query.today))));
app.get('/api/energy', handle(req => db.getEnergy(todayOf(req.query.today))));
app.post('/api/checkin', handle(req => db.setCheckin(req.body?.level, { today: todayOf(req.body?.today) })));
app.get('/api/profile', handle(() => db.getProfile()));
app.post('/api/setup', handle(req => db.setup(req.body, todayOf(req.body?.today))));

// ---- AI-agent ----
// Samtalet sparas på servern, med det agenten faktiskt gjorde. Body: { message, today: 'YYYY-MM-DD' }
app.get('/api/chat', handle(() => db.getChat()));
app.delete('/api/chat', handle(() => db.clearChat()));
app.post('/api/chat', async (req, res) => {
  const { message, today } = req.body ?? {};
  const text = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
  if (!text) return res.status(400).json({ error: 'message saknas' });

  try {
    const user = { role: 'user', content: text };
    const history = toModelMessages([...(await db.getChat()).slice(-19), user]);
    const out = await runAgent(client, history, todayOf(today));
    await db.appendChat([user, { role: 'assistant', content: out.reply, actions: out.actions }]);
    res.json(out);
  } catch (err) {
    console.error('Agent-fel:', err.message);
    const status = err.status === 401 ? 'API-nyckeln är fel eller saknas (.env).' : 'AI:n svarar inte just nu.';
    res.status(500).json({ error: status });
  }
});

app.listen(PORT, HOST, () => console.log(`Dream AI körs på http://localhost:${PORT}`));
