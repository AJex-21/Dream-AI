# Persona test: full list of findings

An agent used the app in a real browser as Oscar (19) and Nora (22), then read the code to find each root cause. After the fixes, a second agent that had not seen them repeated the test.

- **First test:** 44 findings (F1–F44): 2 blockers, 14 major, 23 minor, 5 polish.
- **Second test:** 26 findings (R1–R26): 0 blockers, 9 major, 12 minor, 5 polish.

Status: **Fixed**, **Partly** (the main problem is solved and the rest is stated), or **Not fixed** (a deliberate decision).

## Your four notes

| Your note | Verdict | What changed |
|---|---|---|
| The schema layout doesn't fit the app | Agreed. The problem was structure, not styling | Home is now the actual day in time order, with a week strip and a week view |
| Routines should carry over, or have a from/to | Agreed, this was the top issue | Routines are now rules: weekdays plus an optional from/to period |
| Date and time feel irrelevant when adding | Partly. Min, Max and Priority did nothing, but the date was needed | One form that adapts to the type. Routines ask which days, to-dos ask for a deadline, and there is one optional length |
| The timer and clock are a poor way to grasp the battery | Agreed, and the timer was fake: a hard-coded `12:57:36` | Gone. It now reads like "Räcker ca 3 dygn, till torsdag morgon" |

## First test (F1–F44)

### Blockers

| # | Finding | Status | Fix |
|---|---|---|---|
| F1 | Routines did not repeat | Fixed | A routine is one rule with weekdays and an optional period |
| F2 | Nothing could be edited, deleted or rescheduled | Fixed | Tap a row to edit it. Sessions can be moved, skipped or deleted |

### Major

| # | Finding | Status | Fix |
|---|---|---|---|
| F3 | The battery timer was a hard-coded string | Fixed | Calculated from the level, shown in words |
| F4 | The bar showed the wrong amount | Fixed | The bar's width equals the level, and its parts add up to it |
| F5 | The battery measured ticks, not health | Fixed | It charges when you do things and drains over time. Planning changes nothing |
| F6 | "Idag" meant yesterday after midnight, in chat too | Fixed | Today is recalculated all the time and the view follows at midnight |
| F7 | The chat denied its own actions | Fixed | Each reply is stored with a log of what was actually done |
| F8 | Overlapping saves could permanently corrupt `db.json` | Fixed | Writes go through a queue and are saved atomically |
| F9 | A saved item seemed to vanish | Fixed | Confirmation message with a "Visa" button |
| F10 | Deadlines were invisible, then vanished unfinished | Fixed | Upcoming ones show under "Snart". Unfinished ones carry over as overdue |
| F11 | An appointment could not have a time | Fixed | Optional time of day, used for sorting |
| F12 | "Schema" was not a schedule | Fixed | One day, in time order, in one place |
| F13 | No week overview, dates changeable only from Home | Fixed | Week strip and week view. The other tabs no longer depend on a date |
| F14 | No guitar progress over time | Fixed | Streak, sessions and minutes this week, and dots for each day |
| F15 | A phone inside a phone, with the tab bar off-screen | Fixed | Full screen on phones. The frame appears only on a computer and fits the window |
| F16 | Pointless fields, and the useful ones were missing | Fixed | The form follows the type. Only the name is required |

### Minor

| # | Finding | Status | Fix |
|---|---|---|---|
| F17 | Past and future days acted like today | Fixed | The battery always means now, future sessions can't be ticked, and an empty day is neutral |
| F18 | A failed load looked like an empty day | Fixed | A clear error with "Försök igen" |
| F19 | No feedback at the tick, and the glow got stuck | Fixed | The message appears where you tick, and the glow ends by itself |
| F20 | First run showed a stranger's life | Fixed | Asks your name and starts empty. Example data is a choice |
| F21 | Weak input validation | Fixed | Clear Swedish errors in the form, with limits on the server too |
| F22 | The chat's reply was hidden behind its cards | Fixed | Cards are grouped and come first, so the reply is what you read |
| F23 | The conversation was lost on reload | Fixed | Stored on the server, with a "Ny chatt" button |
| F24 | The chat promised reminders that never came | Fixed | It now says there are no notifications (4/4 with the real model) |
| F25 | The chat missed items on other days | Fixed | It can search by name regardless of date (4/4) |
| F26 | Guitar plan doubled up what was already there | Fixed | It checks first and adds no duplicates (4/4) |
| F27 | The chat greeting showed the wrong battery | Fixed | The greeting no longer shows a number |
| F28 | Bonus could not be added | Fixed | A type in the add form, plus a button on Hobby |
| F29 | Home repeated numbers instead of showing tasks | Fixed | The radar moved to the battery's explanation, and the day takes its place |
| F30 | The add button scrolled away and covered rows | Fixed | It stays in place |
| F31 | Swedish and English were mixed | Fixed | All Swedish |
| F32 | The add sheet was awkward with a keyboard | Fixed | Focus goes to the name, Enter saves, Esc closes, and Tab stays inside |
| F33 | Controls had no accessible names | Fixed | Names, roles, labels and a text alternative for the chart. No real screen reader was tested |
| F34 | Small tap targets, low contrast | Fixed | 44 px targets, larger tab text, and contrast measured above 4.5:1 |
| F35 | Fast date changes could show the wrong day | Fixed | Only the latest response is used |
| F36 | Chat could say "nothing worked" after saving part | Fixed | It says what was done. Plans are now saved all or nothing |
| F37 | Impossible dates were accepted | Fixed | Real calendar validation |
| F38 | The paid chat was open to the network | Partly | Local only by default. There is still no login, which matters if you set `HOST=0.0.0.0` |
| F39 | `DB_PATH` in `.env` was ignored | Fixed | `.env` loads before everything else |

### Polish

| # | Finding | Status | Fix |
|---|---|---|---|
| F40 | Hobbies had a dollar-sign icon | Fixed | New icon |
| F41 | Things had too many names | Fixed | Pulse, Dream AI, Rutiner, Att göra, Hobby, Batteri |
| F42 | Dream AI subtitle had the wrong size | Fixed | Matches the other tabs |
| F43 | iPhone would zoom on text fields | Fixed | Fields are 16 px. Not tested on a real iPhone |
| F44 | Reload and Back lost your place | Fixed | Tab and date are in the address |

## Second test (R1–R26)

### Major

| # | Finding | Status | Fix |
|---|---|---|---|
| R1 | 100% of a small plan left the battery near empty | Fixed | Each session charges its share of your week's plan. A kept plan fills up at any size |
| R2 | The dentist turned red and overdue the next day | Fixed | A to-do with a time is an appointment and can't become overdue |
| R3 | Hobby said "0 of 7" above two filled dots | Fixed | The numbers and dots both cover this calendar week |
| R4 | Hobby showed the same activity twice | Fixed | One row: the next session, with its day |
| R5 | No way to change one session, and editing changed all | Partly | Move and skip one session, and the form says what an edit applies to. You can't change the time or length of one session only |
| R6 | A session done on another day couldn't be logged | Fixed | "Gjorde det idag" counts as the latest missed session, so the streak holds |
| R7 | Editing a routine rewrote the past | Fixed | A tick freezes what the session was worth |
| R8 | The chat couldn't answer "am I keeping up?" | Fixed | New tool with the same numbers as the app (4/4) |
| R9 | The chat's own example prompt gave no plan | Fixed | A plan right away, with different content per day (4/4) |

### Minor

| # | Finding | Status | Fix |
|---|---|---|---|
| R10 | Nobody explained what the battery is for | Fixed | The app and the chat both say it shows how you keep your plan, not how you feel, and that nothing happens at 0% |
| R11 | Tapping your gym days turned them off | Fixed | With all days on, the first tap selects just that day |
| R12 | The message blocked the add button | Fixed | It sits above the button |
| R13 | The Idag tab didn't go to today | Fixed | It always does now |
| R14 | "Nästa" showed old appointments as if today | Fixed | It shows only today's plan |
| R15 | Moving a session through the chat left a duplicate | Fixed | A real move operation (4/4) |
| R16 | Grey "20" looked filled in | Fixed | The hint is gone |
| R17 | Deleting a finished item took its charge back | Fixed | It stays in the battery's history |
| R18 | A past day's "+12%" could pay nothing | Fixed | Past days promise no number |
| R19 | A finished period vanished without a trace | Fixed | An "Avslutade" section shows how it went |
| R20 | The radar counted tonight's gym as failed | Partly | Sessions still open today no longer count. The tester also felt it adds little; it stays because it comes from Del 1 |
| R21 | Nora couldn't get an overview of her week | Partly | The week view now fills the screen. There is still no separate computer layout |

### Polish

| # | Finding | Status | Fix |
|---|---|---|---|
| R22 | The battery's status line didn't fit the situation | Fixed | Separate wording for nothing planned and all done |
| R23 | The dots had no legend | Fixed | A legend on Rutiner, and the letters stay in Monday-to-Sunday order |
| R24 | The same thing had different names | Fixed | One way to write weekdays, and the chat uses the app's words |
| R25 | Old dates were accepted and the year dropped | Fixed | A new to-do can't be dated in the past, and other years are shown |
| R26 | Example data and name are one-time choices | Not fixed | A settings page isn't worth adding for a one-person demo. Delete `db.json` to start over |

## How it was checked

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 65/65 |
| Browser checks, one or more per finding | 136 checks, run in the scratchpad and not part of the project |
| Real model, 4 runs per check | 14 checks. All 4/4 by reading the replies |
| Real model, "I did X" in 5 wordings | 20/20 |

For the battery explanation check, the automatic pattern scored 1/4. The other three replies were correct ("inte hur du mår"), and the pattern tripped on the negation.

Not tested: real phones, a real screen reader, native date pickers, and real time passing across days. Multi-day battery behaviour was simulated in unit tests. Time inputs show AM/PM in the test browser, but a Swedish system should show 24-hour time.
