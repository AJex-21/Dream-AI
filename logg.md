# Beslutslogg – Dream AI del 2

Format: vad, alternativ, varför.

## 2026-11-01

**Utgångsläge.** Prototypen från del 1 var en enda HTML-fil. Data var hårdkodad och försvann vid omladdning. Chatten svarade med `if/else` på nyckelord ("tandläkare", "trött") och kunde inte ändra något i appen.

**1. Målet för del 2: chatten ska kunna agera, inte bara prata.**
- Alternativ: (a) bättre nyckelordsregler, (b) LLM som bara svarar med text, (c) LLM-agent med verktyg.
- Val: (c). (a) skalar inte, för varje ny fråga kräver en ny regel. (b) kan ge råd men inte lägga in något, vilket var löftet från del 1 ("botten är mer som en agent").

**2. Backend: Node.js + Express.**
- Alternativ: Python/Flask, serverless-funktioner, bara frontend.
- Val: Express. Samma språk som frontend, och API-nyckeln måste ligga på en server. Bara frontend hade läckt nyckeln.

**3. Datalagring: JSON-fil.**
- Alternativ: SQLite, Supabase, localStorage.
- Val: `db.json`. En användare och en demo, så ingen databasserver behövs. All åtkomst går via `db.js`, så filen kan bytas mot en riktig databas senare utan att agenten ändras.

**4. Datamodell: platt lista med `date`-fält i stället för objekt per datum.**
- Varför: enklare att filtrera på intervall ("hela veckan") och enklare för agenten att söka i.

**5. Verktygsdesign: `add_items` (flera) i stället för ett separat `create_hobby_plan`.**
- Varför: modellen planerar själv och lägger in passen i ett anrop. Färre verktyg ger mindre att gissa fel på, och hobbyplanen hamnar direkt i schemat som del 1 beskrev.

**6. Fel går tillbaka till modellen (`is_error`) i stället för att krascha.**
- Varför: får modellen till exempel fel id kan den köra `list_items` och försöka igen.

**7. UI-ändring: action-kort i chatten.**
- Problem: när AI:n ändrar saker i bakgrunden vet användaren inte vad som hänt.
- Lösning: varje ändring visas som ett kort ("+ La till: Gitarr: improvisation, sön 1 nov."). Klick på kortet går till rätt datum. Batteri och radar laddas om direkt.

**8. Modell: `claude-haiku-5-5`.**
- Alternativ: större modell (Sonnet/Opus).
- Val: Haiku. Uppgifterna är enkla (lägga in och bocka av), svaren går snabbt och kostnaden är låg. Modellen styrs med `MODEL` i `.env`.

**9. Buggfix: datum räknades i UTC.**
- `toISOString()` ger fel dag mellan 00:00 och 01:00 i Sverige. Bytt till lokalt datum.

**Ej gjort / nästa steg**
- Batteritimern ("until empty") är fortfarande statisk.
- Jev (TypeSafe) som snabb router före Claude: avgör om meddelandet är chatt eller en åtgärd, så enkla frågor inte kostar ett LLM-anrop.
- Notifikationer när batteriet är lågt.

## Iteration: test mot riktig modell

**Vad som inte fungerade.** Enhetstesterna (mock-klient) gick igenom, men de manuella kontrollerna mot riktiga Claude (`claude-haiku-5-5`) gjorde det inte. Varje chattkontroll kördes 4 gånger.
- "Gör en gitarrplan för veckan, 20 min om dagen": 0/4. Modellen frågade varje gång vad målet med övningen var i stället för att lägga in pass. När man svarade på frågan lades 7 pass in, så verktygen fungerade.
- "Jag har tagit en kall dusch": 1/4. I tre av fyra fall körde modellen aldrig `list_items`, utan frågade om den skulle lägga in något nytt.
- `MODEL` i `.env` ignorerades. Appen använde alltid `claude-haiku-5-5`, oavsett vad som stod i `.env`.

**Varför.**
- Gitarr: systemprompten sa "fråga om mål och tid per dag om det saknas". Målet saknades alltid, så modellen följde regeln och frågade.
- Dusch: prompten sa inget om att "jag har gjort X" betyder "bocka av X". Dessutom hette uppgiften "Cold Shower" medan användaren skrev på svenska.
- `MODEL`: `agent.js` läste `process.env.MODEL` när filen importerades. I ES-moduler laddas alla importer innan resten av `server.js` körs, så `dotenv.config()` hade inte hunnit läsa `.env` än.

**Vad vi ändrade.**
- Nya regler i systemprompten: agera hellre än fråga. "Jag har gjort X" → `list_items` för idag, hitta bäst matchande item (även om språket skiljer) och bocka av med `update_item`. Hobbyplanen skapas direkt om hobby och tid per dag finns (7 dagar från idag, ett pass per dag, stegrande svårighet).
- `MODEL` läses inne i `runAgent()` i stället för vid import. Kontrollerat: med `MODEL=model-from-dotenv` i `.env` skickas nu den modellen till API:t.
- Seed-datan är översatt till svenska, som är appens språk.
- Buggfix: dubbel punkt i datumraden på hemskärmen ("sön 1 nov..").

**Resultat.** 4 körningar per kontroll. Efter ändringen startade varje körning från ny seed-data.

| Kontroll | Före | Ny prompt, engelsk seed | Ny prompt, svensk seed |
|---|---|---|---|
| Gitarrplan i ett meddelande | 0/4 | 3/4 | 3/4 |
| Kall dusch bockas av, batteriet stiger | 1/4 | 4/4 | 4/4 |

Duschen gick 4/4 redan med engelska namn ("Cold Shower"), så det var promptändringen som gav förbättringen och inte översättningen. I de lyckade gitarrkörningarna lades 7 pass in, ett per dag, från idag.

**Kvarstår.** De två misslyckade gitarrkörningarna svarade "Klart!" utan att lägga in något. I sex extra körningar där varje steg loggades använde steget som skriver alla sju pass (tänkande + verktygsanrop) 817–1012 output-tokens, och taket är `max_tokens: 1024`. Troligen nådde de misslyckade körningarna taket. Då klipps verktygsanropet av, loopen tolkar svaret som färdigt och visar standardtexten "Klart!". Själva `stop_reason` loggades inte i de misslyckade körningarna. Nästa steg: höj `max_tokens` och ge ett ärligt felmeddelande när `stop_reason` är `max_tokens`.
