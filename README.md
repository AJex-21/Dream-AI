# Dream AI

A mobile-first daily planner (the app is called **Pulse**) with an AI assistant, **Dream AI**, that can read and change your schedule by calling tools. School project, built with Node.js, Express and the Claude API. The app itself is in Swedish.

## What it does

- Plans four kinds of things: **routines** (repeat on chosen weekdays), **to-dos** (with a deadline, or a fixed time), **hobbies** and **chargers** (personal things that give you energy back).
- Shows today's **energy**, calculated from a morning check-in: one hour of focus costs 20%, chargers add energy back, and the app shows what is left tonight.
- Tracks progress over time: streaks, sessions per week, minutes.
- A chat where you write things like "move Thursday's gym to Friday", "I'm exhausted today" or "I just finished studying". The assistant picks the right tools, the changes appear as action cards in the chat, and the schedule updates.

## How the agent works

`agent.js` runs a loop:

1. Send the conversation and the tool definitions to Claude (`@anthropic-ai/sdk`).
2. If Claude asks to use a tool, run it against `db.js` and send the result back. Errors go back to the model as `tool_result` with `is_error`, so it can correct itself.
3. Repeat, at most 6 steps, until Claude answers with text.

Ten tools: `list_items`, `add_items`, `update_item`, `move_session`, `set_session_notes`, `set_done`, `delete_item`, `get_energy`, `set_checkin`, `get_progress`.

Guards: a step limit against endless loops and cost, no tools are run if a reply is cut off by `max_tokens`, and the conversation is stored on the server together with a log of what was actually done, so the model does not contradict its own actions.

## Structure

| File | Role |
|---|---|
| `server.js` | Express server: static frontend, REST API, `/api/chat` |
| `agent.js` | Tool definitions, system prompt and the agent loop |
| `db.js` | Storage and validation, used by both the REST API and the agent |
| `schedule.js` | When an item occurs (pure functions, no I/O) |
| `energy.js` | The energy rules (pure functions, no I/O) |
| `public/index.html` | The frontend |
| `test/` | Tests for the agent (with a mock client), storage, schedule and energy |
| `docs/arkitektur.md` | Architecture, data model and diagrams (in Swedish) |
| `logg.md` | Decision log: what was chosen, the alternatives and why (in Swedish) |
| `docs/persona-test.md` | Findings from user-persona testing and what was fixed |

## Design decisions

- The UI and the AI share the same functions in `db.js`, so there is one set of validation rules and one energy formula.
- A routine is one **rule**, not a row per day. Ticks are stored per day and freeze what a session was worth.
- Energy is calculated every time and never stored. Only the morning check-in is saved.
- The data is a single JSON file. All writes go through a queue and are saved to a temporary file and then renamed, so the file cannot be corrupted by simultaneous requests.
- The API key stays on the server. The server only listens on `127.0.0.1` by default, because there is no login and the chat costs money.

## Run it

```bash
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm start                # http://localhost:3000
npm test
```

Optional settings in `.env`: `MODEL` (default `claude-haiku-5-5`), `PORT`, `HOST`. Setting `HOST=0.0.0.0` lets a phone on the same network reach the app, but then everyone on that network can use the chat.

## Limits

No login, no settings page, one user, and no desktop layout. It has not been tested on real phones or with a screen reader.
