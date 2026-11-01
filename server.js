// server.js – Express: serverar frontend + REST-API + agent-endpoint.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import * as db from './db.js';
import { runAgent } from './agent.js';

const app = express();
const PORT = process.env.PORT || 3000;
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

// ---- REST: samma data som AI:n använder ----
app.get('/api/items', handle(req => db.listItems(req.query)));
app.post('/api/items', handle(req => db.addItem(req.body)));
app.patch('/api/items/:id', handle(req => db.updateItem(req.params.id, req.body)));
app.delete('/api/items/:id', handle(req => db.deleteItem(req.params.id)));
app.get('/api/battery', handle(req => db.getBattery(req.query.date)));

// ---- AI-agent ----
// Body: { history: [{role, content}], today: 'YYYY-MM-DD' }
app.post('/api/chat', async (req, res) => {
  const { history, today } = req.body ?? {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history saknas' });
  }
  // Lita inte på klienten: bara text, bara user/assistant, max 20 senaste, måste börja med user.
  let msgs = history
    .filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) return res.status(400).json({ error: 'history saknar användarmeddelande' });

  try {
    const out = await runAgent(client, msgs, today || db.localDate());
    res.json(out);
  } catch (err) {
    console.error('Agent-fel:', err.message);
    const status = err.status === 401 ? 'API-nyckeln är fel eller saknas (.env).' : 'AI:n svarar inte just nu.';
    res.status(500).json({ error: status });
  }
});

app.listen(PORT, () => console.log(`Dream AI körs på http://localhost:${PORT}`));
