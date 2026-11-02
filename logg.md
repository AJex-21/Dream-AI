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

**Fixat: avklippta svar (`max_tokens`).**
- Problem: de två misslyckade gitarrkörningarna ovan svarade "Klart!" utan att lägga in något.
- Varför: steget där modellen skriver alla sju pass (tänkande + verktygsanrop) använde 817–1012 output-tokens i sex loggade körningar, och taket var `max_tokens: 1024`. Når svaret taket klipps verktygsanropet av. Loopen tolkade det som ett färdigt svar och visade standardtexten "Klart!", fast inget hade sparats. `stop_reason` loggades inte i just de två misslyckade körningarna, så orsaken var trolig men inte bevisad.
- Ändring: `max_tokens` höjt till 4096. Om `stop_reason` är `max_tokens` körs inga verktyg, eftersom input kan vara avklippt, och användaren får "Planen blev för lång för mig, be om färre dagar så försöker jag igen." Standardtexten "Klart!" visas bara om något faktiskt har ändrats, annars "Jag fick inget svar, försök igen." Nytt test med mock-klient: avklippt `tool_use` lägger inte in något. Testet misslyckas med den gamla koden och går igenom med den nya.
- Resultat: gitarrplan i ett meddelande **8/8** (förut 3/4). 0 svar stoppades av `max_tokens`. Varje körning loggade `stop_reason` och output-tokens per steg: steget med sju pass använde 821–1085 tokens. I två av åtta körningar (1065 och 1085) gick det över det gamla taket 1024, och de hade alltså klippts av före fixen.

**Kvarstår.**
- Tid per pass: i 2 av 8 gitarrkörningar beskrev modellens svar passen som 15–20 min, fast användaren bad om 20 min. Kontrollen räknade dem ändå som godkända, eftersom den bara kollar att hobby-items läggs in. Uppgiften kommer från svarstexten. De sparade värdena för `minTime`/`maxTime` loggades inte. Möjlig fix: en promptregel, "använd exakt den tid användaren anger".

## Iteration: persona-test och ny datamodell (2026-11-02)

**Metod.** En agent använde appen som Oscar (19) och Nora (22) i en riktig webbläsare, först utan att läsa koden, sedan för att hitta rotorsaken till varje fynd. Hela listan med status finns i `docs/persona-test.md`.

**Resultat av första testet.** 44 fynd, varav 2 blockerare: rutiner upprepades inte och inget gick att ändra eller ta bort i appen. Nästan allt kom från två grundbeslut: en rad per dag, och batteriet som "klara / totalt för valt datum". Därför byttes modellen i stället för att lappa symptomen.

**10. Rutiner är regler, inte rader.**
- Alternativ: (a) kopiera en rad per dag, som agenten gjort hittills, (b) en regel + bockar per dag, som kalenderappar.
- Val: (b). (a) tar slut: "gym fram till sommaren" gav 61 rader och stoppades av `max_tokens`.

**11. Batteriet är läget nu, uträknat ur historiken.**
- Problem: att planera in något sänkte batteriet, en 5-minuters stretch kunde ge 100 %, och varje morgon började på 0 %.
- Lösning: nivån spelas upp ur avbockningarna: laddas när man gör saker, sjunker med tiden. Timern "12:57:36" var hårdkodad och är borta. I stället visas "Räcker ca 3 dygn, till torsdag morgon".

**12. Att göra har deadline och följer med tills det är klart.** Klockslag gör uppgiften till en tid att passa, som aldrig blir försenad.

**13. Hem-skärmen är dagen i tidsordning.** "Schema" på tre flikar var inget schema. Rutiner, Att göra och Hobby visar nu varje sak över tid, inte per datum.

**14. Samtalet sparas på servern med en logg över vad som gjordes.**
- Problem: modellen såg bara sina egna svar, inte sina verktygsanrop. Den trodde därför att den ljugit och "rättade" sådant den faktiskt gjort.
- Lösning: varje svar sparas med `[Utfört: ...]`. Löser också att samtalet försvann vid omladdning.

**15. Skrivningar går genom en kö, och filen skrivs atomiskt.** Två nästan samtidiga anrop kunde göra `db.json` permanent trasig.

**16. Tester.** Enhetstester för schema, batteri och lagring, plus en körning i riktig webbläsare med en kontroll per fynd. Webbläsartestet ligger inte i projektet, eftersom det skulle kräva Playwright som beroende.

**Andra testet: en ny agent som inte sett fixarna.** 26 fynd, 0 blockerare. Viktigaste lärdomen: min första batterimodell var fel.
- Problem: en realistisk liten plan som hölls till 100 % låg ändå nära tomt, eftersom laddningen var fast. Batteriet belönade att ha mycket planerat, inte att hålla planen. Jag hade kalibrerat mot en stor plan och inte sett det.
- Lösning: varje pass laddar sin andel av veckans plan. Stor eller liten plan fylls lika bra om den hålls.

Övrigt från andra testet:
- En bock fryser vad passet var värt. Innan gav en ändring av längden 8 % gratis på ett pass som redan var gjort.
- Ett enskilt pass går att flytta, hoppa över eller göra en annan dag, och agenten har ett eget verktyg för det. Innan gav en flytt en kopia av rutinen.
- Tandläkaren blev röd och "försenad" dagen efter. Därför tid att passa, se beslut 12.
- Hobby sa "0 av 7" ovanför två fyllda prickar: siffran var kalenderveckan, prickarna senaste 7 dagarna. Båda gäller nu kalenderveckan.
- Agenten kan svara på "håller jag i det?" (`get_progress`) och göra en plan ovanpå ett dagligt pass (`set_session_notes`).

**Hittat av testerna, inte av personerna.**
- "Hoppa över" tog bort hela rutinen. I en `onclick` inne i ett `<form>` betyder `form` formulärelementet, inte min variabel, så datumet blev `undefined`.
- Riktiga modellen svarade "Bra jobbat!" utan att bocka av i 3 av 4 körningar på "jag har precis pluggat klart". Regeln i prompten blev skarpare och ligger nu först: 20/20 på fem olika formuleringar mitt i ett samtal.

**Resultat mot riktiga modellen.** 4 körningar per kontroll, ny exempeldata varje gång. Alla 4/4: återkommande blir en regel, inga falska påminnelser, hittar saker på namn, minns vad den gjort, tar inte tillbaka det, flytt utan kopia, svarar med siffror, inga dubbla gitarrpass, exakt tid per pass, plan direkt utan motfråga. Kontrollen av hur batteriet förklaras gav 1/4 automatiskt, men de tre andra svaren var rätt ("inte hur du mår"): mönstret i kontrollen fastnade på nekandet.

**Medvetet inte gjort.**
- Ingen inställningssida: namnet kan inte ändras och exempeldata väljs bara vid första start. Ta bort `db.json` för att börja om.
- Enskilda pass går att flytta och hoppa över, men inte ändra tid eller längd för bara en gång.
- Ingen datorlayout: appen är byggd för telefon och visas i en telefonram på stor skärm.
- Ingen inloggning. Servern lyssnar bara på den egna datorn. För att visa på en telefon, sätt `HOST=0.0.0.0` i `.env`, men då når alla på nätverket både schemat och den betalda chatten.
- Livsbalans-radarn är kvar, eftersom den kommer från del 1, men flyttad från hemskärmen till batteriets förklaring. Det andra testet tyckte att den tillför lite. Det är ett designval för gruppen.
- Inga riktiga telefoner eller skärmläsare är testade.


## Iteration: ny design, Skymning (2026-11-02)

Målet var en modernare design med så lite text som möjligt. Logiken och servern är orörda, bara `public/index.html` ändrades.

**17. Batteriet är en kula med lager i kategorifärgerna, inte en stapel.** Alternativet var att behålla procenttalet ensamt. Kulan visar både hur mycket som är laddat och vad det kommer från, utan förklarande text. Paletten går från hav till sol och kontrollerades för färgblindhet med ett skript. I mörkt läge ligger färgerna något ljusare än skriptets rekommenderade band, vilket jag behöll eftersom de ska lysa mot mörk bakgrund. Färg bär aldrig betydelsen ensam, varje kategori har också en ikon.

**18. Ljust och mörkt läge följer telefonens inställning.** Innan fanns bara mörkt.

**19. Rörelse med fjädrar som går att avbryta, utan bibliotek.** Ark dras ned för att stängas och en rad sveps åt höger för att bockas av. Det är en genväg, ringen fungerar fortfarande. Med "minska rörelse" i telefonen stängs animationerna av.

**20. Rubriken i veckovyn blev "v. 45".** "Vecka 45" fick inte plats bredvid pilarna och reglaget Dag/Vecka, så raden bröts och reglaget hoppade mellan vyerna. Knappen tillbaka till idag ligger nu under rubriken, av samma skäl.

**21. Kulan blev en ring med en båge per kategori.** Ersätter kulan i beslut 17. En blank kula med vätska stack ut i en design som annars är platt och byggd av tunna ringar, och färgerna flöt ihop. Ringen använder samma form som bockarna och tidslinjen, och bågarnas längd går att jämföra direkt. Jämfört med kulan försvann också animationen som ritade om vågen varje bildruta. Ringen rör sig bara när något händer, vilket sparar på telefonens batteri.

**22. Rörelsen har regissör: varje animation visar vad som hände.** Kategorins färg flyger till slutet av sin båge, ringen tar emot stöten och bågen växer. Listor kommer in en rad i taget och från det håll man bläddrade. Alternativet var ett animationsbibliotek, men det behövdes inte eftersom fjädrarna från beslut 19 redan fanns. Allt går via samma funktion så att "minska rörelse" stänger av det, och siffrorna stämmer även utan animation.

**23. Egen kalender i stället för webbläsarens.** Webbläsarens datumruta går inte att styla och såg gammal ut bredvid resten. Kalendern är ett ark som följer kategorins färg och öppnas ovanpå formuläret, och samma ark används av kalenderknappen på Idag. Den har inga fler funktioner än den gamla, bara genvägarna Idag och Imorgon. För uppgifter går det inte att välja ett datum som redan varit. 

**24. Tiden väljs på en klocka som snurras.** Först blev tiden rutor för timme och minut i samma layout som kalendern, men det kändes som ett formulär och togs bort. Nu är det två ringar i batteriets stil, timmar innanför och minuter utanför. Hela klockan är ett enda tal, minuter sedan midnatt, så ringarna hänger ihop som visarna på en riktig klocka. En svepning fortsätter snurra och landar med fjäder: snabbt på jämna fem minuter, lugnt på exakt minut, så att 18:07 fortfarande går. Tiden är valfri, därför finns knappen "Ingen tid". Piltangenter fungerar också.

**Hittat när designen kördes i riktig webbläsare, inte i koden.** Rubriken ovan, ett tomt svepfält utan bock, en prick mitt i radarn för kategorier utan data, flikar som nådde kanten på 320 px och datumet som stod två gånger på andra dagar än idag.
