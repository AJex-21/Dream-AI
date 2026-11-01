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
