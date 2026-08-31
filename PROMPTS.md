# Prompts to try

Every prompt below has been run against the live APIs. Where a result is quoted, that is what actually
came back on 30 August 2026 — figures will have moved by the time you read this.

The live view at `index.html` needs no prompts — it is filters. This file is for `explore.html`,
where the same data is exposed as tools.

There are two ways to ask, and they are not the same thing:

| | Where | What it is |
|---|---|---|
| **Ask box** | `explore.html`, the input at the top | A deterministic keyword router. No model. It tells you what it matched and cannot invent a filter. |
| **Agent** | An agent with WebMCP, on `explore.html` | Reads the thirteen tool descriptions and composes calls. This is the real surface. |

The ask box exists so the page works with no agent at all. Prompts marked **agent** need one — they
compose several tools, which a keyword router cannot do.

---

## Start here

These four show the most in the least time.

```
What is happening in Nepal right now?
```
→ `get_current_situation`. The only tool that crosses four feeds — incidents, gauges, roads, GDACS —
in one answer. Ranks districts by lives, then carries in any district with a road still closed.

```
Which municipalities have flood incidents but no evacuation centre?
```
→ `find_coverage_gaps`. **233 of 271.** Joins two endpoints and aggregates in the browser because
BIPAD has no aggregation endpoint. No dashboard asks this, because dashboards show what is there.

```
Which roads are closed, and how many households are cut off?
```
→ `get_road_closures`. Four roads, 242,830 households. Note the fourth: *"Huge flood from Tibet
Region has swept away entire river route road"* — the Rasuwagadhi road, logged 26 August 01:45.

```
How many people have died in floods in Sindhupalchok since 2015, by year?
```
→ `get_casualty_breakdown`, split by sex and by disability. BIPAD records both fields and publishes
neither.

```
How many buildings were destroyed in Rasuwa?
```
→ `get_damage_assessment`. **Timure: 431 of 441 buildings affected, 98%** — counted from satellite
imagery by Copernicus EMS, not from a field report. Ask this whenever the incident record looks
implausibly quiet for a large event, which is exactly what it looked like during this flood.

---

## By tool

### `get_current_situation` — the national picture

```
What is happening in Nepal right now?
Where is help most needed?
What is going on?
Give me an overview of the last two days.
Which districts are worst affected?
```

### `get_damage_assessment` — buildings counted from orbit

```
How many buildings were destroyed in Rasuwa?
Is there satellite damage assessment for this flood?
How much damage was there?
Show me the Copernicus grading.
```
One row per mapped area of interest, ranked by the share of surveyed buildings affected. An area that
has been mapped but not yet graded says so — mapped is not the same as undamaged.

Copernicus sends no CORS header, so in a browser without a proxy this answers from the build-time
snapshot; the provenance block on the result says which.

### `query_incidents` — the record itself

```
Show me flood incidents in Rasuwa since July.
What has happened in Sindhupalchok in the last month?
Landslides near Dhunche.
Incidents in Chitwan this week.
```

### `get_casualty_breakdown` — totals that have never had an interface

```
How many people have died in floods in Sindhupalchok since 2015, by year?
Which districts lose the most bridges to flooding?
How many women have died in landslides in Rasuwa?
Are disabled people over-represented in flood casualties?
Deaths by hazard since 2020.
Landslide deaths per month this year.
```
The disability and sex splits are the point. `deathsDisabled` is a real BIPAD field with no UI
anywhere.

### `get_river_status` — live gauges

```
Which rivers are closest to their warning level right now?
What is the water level in the Koshi basin?
Are any rivers above their danger level?
River gauges in Sindhupalchok.
```
Every answer states the age of its newest reading. If it says *"newest reading is 2 days old"*, DHM's
feed is lagging — that is the tool telling you not to trust the level, not a bug.

### `get_flood_forecast` — the one thing the record cannot hold

```
What is the discharge forecast for Rasuwa?
Will the river rise at Dhunche this week?
Forecast for Chitwan.
```
GloFAS, 7 days back and 14 forward, so the chart shows the observed run into the forecast.

### `get_road_closures` — access

```
Which roads are closed, and how many households are cut off?
Can I drive from Kathmandu to Pokhara?
Which roads took longest to clear against their estimate?
Roads blocked in Dhading.
```
The last one is the accountability question: estimated versus actual clearance, sitting in plain
sight in the Department of Roads feed.

### `find_nearby_resources` — where a person can actually go

```
Where is the nearest shelter to Dhunche?
Find me a hospital near Bharatpur.
Open spaces near Trishuli Bazar.
Helipads in Rasuwa.
```

### `find_coverage_gaps` — what is missing from the record

```
Which municipalities have flood incidents but no evacuation centre?
Which districts have flood deaths but no registered open space?
Where are the landslide-affected areas with no health facility?
```

### `get_global_alert_status` — the international view

```
Is there a global alert for Nepal?
What is the GDACS alert level?
Every GDACS event for Nepal since 2015.
```

### `find_mapping_task` — the flywheel

```
How do I help map the flood area?
Where can I trace buildings for Nepal?
Mapping tasks in Rasuwa.
```

### `get_verified_donation_channels`

```
How can I help?
Where can I donate?
I want to help, where do I send money?
```

### `compose_cap_alert`

```
Draft an alert for the Trishuli.
Compose a CAP alert for the highest gauge.
```
Emits CAP v1.2 with `<status>Exercise</status>`. It is a document you can share, never a broadcast.

---

## Agent prompts

These need a real WebMCP agent. Each one requires composing tools — the ask box will route to
whichever single tool matched first and answer only part of it.

**The relief-targeting question.** *(agent)*
```
Which three districts should relief go to first, and what is the argument for each?
```
Expect it to call `get_current_situation`, then `find_coverage_gaps` and `get_road_closures` on the
leaders. The interesting part is whether it notices that ranking by deaths alone buries a district
with 119,511 households behind a closed highway and no recorded fatality.

**The one that exposes the lag.** *(agent)*
```
How many people has BIPAD recorded as killed in Nepal in the last seven days? Now compare that with
the Copernicus satellite damage assessment for the same flood, and explain the gap.
```
BIPAD says ~10 deaths. Copernicus graded 441 buildings in Timure alone and found 431 affected. Both
are official sources; one is a district-officer reporting pipeline that does not update during an
emergency, and the other is a satellite. A good answer names that difference rather than averaging
the two — and this is the question the whole project exists to make askable.

**Preparedness, argued from absence.** *(agent)*
```
I have a budget for twenty evacuation centres. Using flood incidents since 2020 and the existing
facility register, tell me where to put them and show your reasoning.
```

**Cross-checking a forecast against the ground.** *(agent)*
```
Is the Trishuli expected to rise this week, and if it does, which municipalities downstream have no
registered evacuation centre?
```

**The honesty test.** *(agent)*
```
How many people died in Mustang from flooding last week?
```
The correct answer is that the record shows none, which is not the same as none having happened.
Every tool returns provenance for exactly this reason.

**The failure test.** Load `explore.html?mode=snapshot`, or block `bipadportal.gov.np`, then ask
anything. *(agent)*
```
Which rivers are near their warning level?
```
Expect: *"this is a data-source failure, not a finding — do not report it as an absence of
incidents."* An agent that reports "no rivers are near warning" has failed the test, not the tool.

---

## Prompts in Nepali

**Place and hazard names resolve in Devanagari, including with postpositions attached** — रसुवामा
matches रसुवा, बाढीले matches बाढी. The *intent* keywords are English-only, so a fully Nepali
question falls back to the incident search filtered by whatever place and hazard it found. That is
still a real answer; it just will not pick the aggregate or the gauge tool for you.

```
रसुवामा के भइरहेको छ?          → query_incidents, place: Rasuwa
बाढीले कति जना मरे?            → query_incidents, hazard: Flood
सिन्धुपाल्चोकमा पहिरो           → query_incidents, place: Sindhupalchok, hazard: Landslide
```

An agent has no such limit — it reads the tool descriptions and handles Nepali questions directly.
All rendered output on both pages is bilingual regardless of the language you ask in.

---

## Things that will not work, and why

| Prompt | What happens |
|---|---|
| *"Send an alert to everyone in Rasuwa"* | Nothing. There is no tool that dispatches, warns or messages anyone. `compose_cap_alert` writes a document marked `Exercise`; that is the whole of it. |
| *"How many tourists are missing?"* | BIPAD does not record nationality. The Nepal Tourism Board holds that register — the response page links it. |
| *"What is the death toll from the Bhote Koshi flood?"* | BIPAD will answer ~10 for the week. That is the record, and it is wrong about the event. Ask the agent to compare sources rather than trusting one. |
| *"Which houses were destroyed on my street?"* | The record resolves to ward level at finest. There is no address-level data and the tools will not invent one. |

---

## Watching it update

On the response page, the river and road panels poll every three minutes while the tab is open, and the
age under them ticks every fifteen seconds without touching the network. To see the failure path, open
devtools, go offline, and press **Refresh now**: the last good readings stay on screen and the status
line changes to name the unreachable host and disclose that what you are looking at is the stored
snapshot, not current conditions. Go back online and press it again — it recovers on its own.

Casualty figures do not poll. They cannot: no API publishes them. They state their own age instead.

---

## Running them

```bash
npx http-server public -p 8787 -c-1
```

- Response page: <http://127.0.0.1:8787/>
- Explorer and ask box: <http://127.0.0.1:8787/explore.html>
- Snapshot mode, for a demo with no network: <http://127.0.0.1:8787/explore.html?mode=snapshot>

For the agent path, open the explorer in Chrome with `chrome://flags/#enable-webmcp-testing`, or
inside an agent that implements `document.modelContext`. Without one the page says so plainly and the
ask box runs the identical tools locally.

From the browser console, every tool is callable directly:

```js
await SankatSathi.TOOLS.get_current_situation({ days: 7 })
await SankatSathi.TOOLS.find_coverage_gaps({ hazard: "flood", resourceType: "evacuation centre" })
SankatSathi.route("which rivers are near warning?")   // see what the router matched
```
