# Dream AI 2.0 – arkitektur

## Översikt

```mermaid
flowchart LR
  subgraph Mobil-UI [Frontend: public/index.html]
    UI[Hem / Rutiner / To-dos / Hobbyer]
    CHAT[Dream AI-chatt]
  end
  subgraph Server [Backend: Node.js + Express]
    REST[REST-API<br>/api/items, /api/battery]
    AG[Agent<br>/api/chat]
    DB[(db.json)]
  end
  LLM[Claude API<br>tool use]

  UI -- fetch --> REST
  CHAT -- historik + datum --> AG
  AG <-- meddelanden / tool_use --> LLM
  AG -- verktyg --> DB
  REST --> DB
  AG -- svar + actions --> CHAT
  CHAT -- ladda om data --> UI
```

UI:t och agenten använder **samma funktioner i `db.js`**. Det AI:n gör syns direkt i batteriet, radarn och listorna.

## Agent-loopen

```mermaid
flowchart TD
  A[Användaren skriver i chatten] --> B[POST /api/chat]
  B --> C[Skicka historik + verktyg till Claude]
  C --> M{stop_reason = max_tokens?}
  M -- Ja --> N["Kör inga verktyg, input kan vara avklippt<br>Svar: be om färre dagar"]
  N --> J
  M -- Nej --> D{stop_reason = tool_use?}
  D -- Ja --> E[Kör verktyget i db.js]
  E --> F[Skicka tool_result tillbaka]
  F --> G{Max 6 steg?}
  G -- Nej --> C
  G -- Ja --> H[Avbryt med kort svar]
  D -- Nej --> I[Text-svar + lista med actions]
  I --> J[UI visar svar + action-kort, laddar om data]
```

## Verktyg (tools)

| Verktyg | Gör | Exempel på fråga |
|---|---|---|
| `list_items` | Läser schema (datum eller intervall) | "Vad har jag imorgon?" |
| `add_items` | Lägger till 1–30 items | "Gör en gitarrplan för veckan" |
| `update_item` | Ändrar / bockar av | "Jag har tränat" |
| `delete_item` | Tar bort | "Ta bort tandläkaren" |
| `get_battery` | Batteri per kategori | "Hur ligger jag till?" |

## Pseudokod

```
funktion runAgent(historik, idag):
  meddelanden = historik
  actions = []
  upprepa max 6 gånger:
    svar = claude(systemprompt(idag), verktyg, meddelanden)
    om svar inte vill använda verktyg:
      returnera svar.text, actions
    för varje verktygsanrop i svar:
      försök:
        resultat = kör(verktyg, input)   // validerat i db.js
        actions += vad som ändrades
      vid fel:
        resultat = felmeddelande          // modellen får rätta sig själv
    meddelanden += svar, resultat
  returnera "hann inte bli klar", actions
```

## Säkerhet och robusthet

- API-nyckeln ligger bara i `.env` på servern, aldrig i frontend.
- All data valideras i `db.js` (datum, typ, prio, tider), både från UI och AI.
- Servern filtrerar chatthistoriken: bara text, max 20 meddelanden.
- AI-genererade namn escapas innan de visas (`esc()`), så ingen HTML-injektion.
- Max 6 steg i loopen skyddar mot oändliga loopar och höga kostnader.
