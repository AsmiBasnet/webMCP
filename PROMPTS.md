# Ten prompts to try

Nepal publishes a great deal of disaster data and almost none of it together. Every prompt
below is a question **no single source can answer** — each one makes an agent cross the
incident record against the gauges, the roadblocks, the international alert, the forecast and
the satellite, and several of them end in a contradiction between two official sources that
only shows up when you put them side by side.

Nothing in the interface mentions any of this. The surface is `document.modelContext`, visible
only to an agent or to DevTools.

**Where to type them**

- **With Chrome's real WebMCP** — enable `chrome://flags/#enable-webmcp-testing`, relaunch,
  install the [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp)
  extension, open the page, and ask in its chat box.
- **Anywhere else** — the page installs a shim, so the exact calls each prompt should produce
  are given below. Paste them into the DevTools console and the same thing happens.

**Eleven tools.** Six read: `get_situation_summary`, `list_records`, `get_record_details`,
`list_filter_options`, `cross_reference_district`, `get_source_health`. Five write —
these move the screen the person is looking at: `filter_records`, `select_record`, `focus_map`,
`reset_view`, `refresh_data`.

> Figures below are what the feed held on 30–31 August 2026, during the Rasuwa GLOF flood
> (GDACS `FL1104124`, Copernicus activation `EMSR927`). Run the prompts now and you get
> today's; the *shape* of what they expose is the point.

---

### 1. "What's happening in Nepal right now, and where should I look first?"

```js
await document.modelContext.executeTool('get_situation_summary', '{}')
```

**Sources: all six at once.** Widen to seven days and, on the capture used here, the same window
held 220 incident records, 168 gauge readings, 4 road closures, 3 discharge forecasts, 4 satellite
damage gradings and 1 international alert — counted together, which is the one thing none of the
six publishers does. The exact figures move every ten minutes; the arithmetic is the point.

The ranking is the part that matters. Districts come back ordered by **what is worst in them**,
not by how many rows they have — because on this day the district with the most incident records
was Siraha (17 records, 2 deaths) while the district with a settlement graded 431-of-441
destroyed had exactly **one** record in the incident feed. A dashboard that counts rows sends
relief to the wrong valley.

---

### 2. "The satellite says Timure is destroyed. What does Nepal's own incident record say about Rasuwa?"

```js
await document.modelContext.executeTool('filter_records', '{"window":7}')
await document.modelContext.executeTool('cross_reference_district', '{"district":"Rasuwa"}')
```

**Sources: damage + incidents + roads + gauges + forecast — five of six, in one answer.**

This is the prompt that explains why the site exists. What comes back:

> Rasuwa: 6 records across 5 of 6 sources — 1 incident (0 dead, 0 missing, 1 injured), 1 gauge,
> 1 closure cutting off 7,025 households, **864 of 1,000 buildings graded affected from orbit**.
> 2 divergences between sources.
>
> *Copernicus EMS graded 864 of 1,000 surveyed buildings as affected here, while the incident
> record holds 1 record for the same window. Satellite assessment does not depend on a district
> officer being able to file, and the filing chain is what breaks when the roads are cut — so
> treat the low incident count as a reporting lag to verify, not as evidence that the district
> is fine.*

Two arms of officialdom, describing the same ground on the same day, disagreeing by three orders
of magnitude. Neither is lying. BIPAD's number is what got filed by people whose road was swept
away on 26 August; Copernicus counted from orbit on the 27th and did not need the road. The tool
states the divergence and refuses to resolve it — it cannot know which is right, only that
reading either one alone would be a mistake.

---

### 3. "Can relief actually reach Rasuwa?"

```js
await document.modelContext.executeTool('filter_records', '{"window":7}')
await document.modelContext.executeTool('cross_reference_district', '{"district":"Rasuwa"}')
await document.modelContext.executeTool('filter_records',
  '{"district":"Rasuwa","sources":["road","damage","forecast"],"severities":["critical","serious","warning","normal","info"]}')
```

**Sources: roads (Dept. of Roads) + damage (Copernicus) + forecast (GloFAS).** Three agencies,
three countries, one question.

The road answer: NH42 to Rasuwagadhi, **closed since 26 Aug 11:30**, cause recorded as *"Huge
flood from Tibet Region has swept away entire river route road"*, **7,025 households / 27,094
people behind it**, five-day repair estimate. The damage answer: the settlements at the far end
of that road are the ones graded 431-of-441 and 433-of-559. The forecast answer: the Bhote Koshi
peaks at 4.77 m³/s on 3 September, +3% — no second surge coming.

Access, damage and what happens next are published by three different bodies and normally read on
three different screens. The second call puts all three on one — and has to ask for `normal`
explicitly, because a forecast with no surge in it *is* normal, and that is the answer.

---

### 4. "Is Nuwakot as quiet as it looks?"

```js
await document.modelContext.executeTool('filter_records', '{"window":7}')
await document.modelContext.executeTool('cross_reference_district', '{"district":"Nuwakot"}')
```

**Sources: incidents + damage + gauges + forecast.**

The incident record for Nuwakot holds two entries that week: an animal incident and a landslide,
**no casualties recorded**. Copernicus, imaging Bidur on 28 August, graded **3,058 of 11,486
buildings affected** and put **5,000 of 25,000 people** inside the flood extent.

Same district. Same week. This is what a reporting lag looks like from the outside, and it is
invisible to anyone reading one feed.

---

### 5. "Which road closure is cutting off the most people — and is that record even current?"

```js
await document.modelContext.executeTool('filter_records', '{"window":7,"sources":["road"],"sort":"severity"}')
await document.modelContext.executeTool('cross_reference_district', '{"district":"Ilam"}')
```

**Sources: roads + incidents, plus the record's own internal contradiction.**

Prithvi Rajmarg is the loudest — 119,511 households, 528,967 people, closed by landslide, one-day
estimate. But the Ilam cross-reference surfaces something a list never would:

> *Mechi Rajmarg was due to reopen 2026-08-09 and has not been marked reopened. Either it is
> still shut and the estimate is stale, or it opened and nobody updated the record; 99,910
> households are behind it either way.*

Logged with a five-hour repair estimate, still open 53 days later. The page will not quietly
drop it and will not quietly believe it. It says which of the two possibilities you are choosing
between.

---

### 6. "Is any river near its warning level, and is it forecast to rise?"

```js
await document.modelContext.executeTool('filter_records', '{"sources":["river"],"severities":["critical","serious","warning"]}')
await document.modelContext.executeTool('filter_records',
  '{"sources":["river","forecast"],"severities":["critical","serious","warning","normal"]}')
```

**Sources: DHM gauges (observed) + GloFAS (modelled).** The only pairing on the page that puts a
measurement and a prediction side by side — an agency in Kathmandu reading a staff gauge, and a
European model of the same water.

Roshi Khola at Panauti sits **0.226 m below its warning level, steady**; Keshaliya Khola 0.402 m
below, steady. Headroom in **metres**, never a ratio — many Nepali gauges report metres above sea
level, so `level ÷ threshold` reads 0.999 for a station sitting comfortably clear. Getting that
wrong is how a calm river becomes a false alarm.

The second call is where the pairing happens, and it has to name `normal` to get it: the three
GloFAS points sit at `normal` because the model has no surge in them — Bhote Koshi peaking at
4.77 m³/s on 3 September, +3% on today. Observation says *near the line*; model says *no second
wave*. Neither sentence is available from the other source.

`normal` is off by default for a reason: 163 stations report every ten minutes and on a quiet day
159 of them are fine, which would bury everything else. The schema says so, so an agent knows to
ask.

---

### 7. "GDACS calls this an Orange alert. Does the ground data agree?"

```js
await document.modelContext.executeTool('filter_records', '{"window":7}')
await document.modelContext.executeTool('list_records', '{"source":"alert"}')
await document.modelContext.executeTool('cross_reference_district', '{"district":"Rasuwa"}')
```

**Sources: GDACS (international) + BIPAD (national) + Copernicus (orbital).** Three tiers of
authority on one event.

GDACS: Orange, 26–28 August, event `FL1104124`. BIPAD: one injury in Rasuwa. Copernicus: 864 of
1,000 buildings across two settlements, activation `EMSR927`, requested by DG ECHO. The tool
returns the alert flagged **national scope** rather than pretending an event geometry is a
district record — a distinction that quietly corrupts a lot of hand-rolled joins.

---

### 8. "Rank the districts by lives lost, not by how many forms were filed."

```js
await document.modelContext.executeTool('get_situation_summary', '{}')
await document.modelContext.executeTool('filter_records', '{"window":7,"severities":["critical","serious"]}')
```

**Sources: incidents + roads + damage, weighted against each other.**

Severity here follows harm, not hazard type: a flood with no casualties ranks below a snake bite
that killed someone, because the list is read by people deciding where to look next. Nationally
that week: 220 incidents, **8 dead, 1 missing, 97 injured, 12 houses destroyed** — against 864
buildings graded affected in Rasuwa alone. Both figures are official. Only one of them was
collected by people who still had a road.

---

### 9. "Am I looking at live data, or a cached copy?"

```js
await document.modelContext.executeTool('get_source_health', '{}')
await document.modelContext.executeTool('refresh_data', '{}')
```

**Sources: all six, reporting on themselves.**

Ask this before quoting any figure above. Copernicus EMS sends **no `Access-Control-Allow-Origin`
header at all**, so without a deployed proxy the browser cannot reach it and the page serves the
build-time snapshot — and says `snapshot`, not `live`. Every one of the six reports `live`,
`snapshot` or `unreachable` separately, and the status bar shows the same thing to the human.

An empty result from a dead feed is a data-source failure, not an absence of events. When the
subject is casualties, those two must never come out looking the same — which is why every tool
that fails returns a sentence telling the agent exactly that.

---

### 10. "Show me all of that on screen."

```js
await document.modelContext.executeTool('filter_records', '{"district":"Rasuwa","sources":["incident","river","road","alert","forecast","damage"],"severities":["critical","serious","warning","normal","info"],"sort":"severity"}')
await document.modelContext.executeTool('select_record', '{"id":"damage:EMSR927:AOI02"}')
await document.modelContext.executeTool('focus_map', '{"district":"Rasuwa"}')
await document.modelContext.executeTool('reset_view', '{}')
```

**Screen:** the District dropdown moves to Rasuwa, all six source chips light, the sort flips to
Severity, the list collapses to that valley, the drill-down opens on Timure with every Copernicus
field and the raw payload, and the map pans to the located records. Then it all goes back.

This is the argument for WebMCP over an agent clicking through the DOM. The tools mutate the same
state a click mutates and re-render — one code path to the screen, not two — so the person
watching sees the work happen and can check it. Chrome's phrasing: tools *execute on your webpage
visibly*. An agent that summarises six feeds is useful; an agent that leaves the human looking at
the evidence is trustworthy.

---

## Two worth asking to see what the tools refuse to do

**"Send an alert to everyone behind that closure."** — nothing here can. There is no tool for it,
and every result ends by saying so: *issues no warnings and dispatches nothing*. SankatSathi shows
what six public sources published, with their provenance and their age attached. It has no
authority to do more. What it *will* give you is the named engineer and phone number the
Department of Roads published for that closure — `get_record_details` on a road record — which is
a real person to call rather than a broadcast nobody authorised.

**"Cross-reference Mustang."** — a district with nothing loaded answers *"That is what the sources
published, which is not the same as nothing having happened — widen the window, and check
`get_source_health` before concluding the district is quiet."* An absence in the data is reported
as an absence in the data, never as calm.

---

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1234 district disaster hotline ·
1149 National Emergency Operation Centre.
