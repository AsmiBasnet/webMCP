# Ten prompts to try

Ask these in natural language and watch the page move. Nothing in the interface mentions
tools — the whole surface is `document.modelContext`, visible only to an agent or to
DevTools.

**Where to type them**

- **With Chrome's real WebMCP** — enable `chrome://flags/#enable-webmcp-testing`, relaunch,
  install the [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp)
  extension, open the page, and ask in its chat box.
- **Anywhere else** — the page installs a shim, so the exact call each prompt should produce
  is given below. Paste it into the DevTools console and the same thing happens.

Ten tools: `get_situation_summary`, `list_records`, `get_record_details`,
`list_filter_options`, `get_source_health`, `filter_records`, `select_record`, `focus_map`,
`reset_view`, `refresh_data`. The first five are read-only. The last five change what the
person is looking at.

---

### 1. "What's happening in Nepal right now?"

```js
await document.modelContext.executeTool('get_situation_summary', '{}')
```

**Tool:** `get_situation_summary` · **Screen:** unchanged — this one is read-only.

The opening move. Counts across all six feeds in the current window, split by severity and by
source, plus the worst-hit districts ranked by *what is worst in them* rather than by how many
rows they have: one fatal incident outranks nine gauge readings. It also reports which sources
answered, so the agent knows what its numbers are worth before it quotes them.

---

### 2. "Show me only the road closures, worst first."

```js
await document.modelContext.executeTool('filter_records', '{"sources":["road"],"sort":"severity"}')
```

**Tool:** `filter_records` · **Screen:** the Roads chip lights and the other five go dark, the
Sort dropdown flips to *Severity*, the list collapses to the closures, the map refits to them,
and the counts in the status bar and summary follow.

The clearest demonstration that a tool call is not a side channel. It drives the same state a
click drives, so the filter bar physically moves.

---

### 3. "Which districts are worst hit, and can you zoom the map to the worst one?"

```js
await document.modelContext.executeTool('get_situation_summary', '{}')
await document.modelContext.executeTool('focus_map', '{"district":"Rasuwa"}')
```

**Tools:** `get_situation_summary` → `focus_map` · **Screen:** the map pans and zooms to fit
every located record in that district. The list underneath does **not** change.

Two tools chained, and a deliberate separation: `focus_map` moves the map and nothing else,
so an agent can point at something without silently narrowing what the person can see.

---

### 4. "How many buildings did the satellite say were destroyed?"

```js
await document.modelContext.executeTool('filter_records', '{"sources":["damage"]}')
await document.modelContext.executeTool('list_records', '{"source":"damage"}')
```

**Tools:** `filter_records` → `list_records` · **Screen:** filtered to the Copernicus EMS rows.

Copernicus EMS Rapid Mapping is the only source here that counts buildings **from orbit**
rather than from a district officer's form — which matters exactly when the reporting chain is
underwater. One row per mapped area of interest, with buildings affected against buildings
surveyed.

---

### 5. "Open the Timure damage assessment and show me everything Copernicus published."

```js
const rows = await document.modelContext.executeTool('list_records', '{"source":"damage"}')
// take an id from the result, e.g. damage:EMSR927:AOI02
await document.modelContext.executeTool('select_record', '{"id":"damage:EMSR927:AOI02"}')
await document.modelContext.executeTool('get_record_details', '{"id":"damage:EMSR927:AOI02","includeRaw":true}')
```

**Tools:** `list_records` → `select_record` → `get_record_details` · **Screen:** the drill-down
panel opens with that record's title, every field, its provenance and the raw payload; the map
pans to it.

`select_record` is how an agent *shows* rather than only tells. The person ends up looking at
the same record the agent is describing.

---

### 6. "Is any river above its warning level?"

```js
await document.modelContext.executeTool('filter_records', '{"sources":["river"],"severities":["critical","serious","warning"]}')
```

**Tool:** `filter_records` · **Screen:** gauges only, quiet stations excluded.

`normal` is deliberately off by default: 163 stations report every ten minutes and on a calm
day 159 of them are fine, which would bury everything else. The tool's own schema says so, so
an agent knows to add `"normal"` when it genuinely wants the full network.

---

### 7. "Widen it to the last week and search for landslides."

```js
await document.modelContext.executeTool('filter_records', '{"window":7,"search":"landslide"}')
```

**Tool:** `filter_records` · **Screen:** the Window dropdown moves to *Last 7 days*, "landslide"
appears in the search box, and the list reloads.

The window is the one filter that is also a fetch — it asks all six upstream sources for more —
so this call takes a moment and says `window=7d (refetched)` in its result rather than
pretending the change was free.

---

### 8. "Which districts can I actually filter by right now?"

```js
await document.modelContext.executeTool('list_filter_options', '{}')
await document.modelContext.executeTool('filter_records', '{"district":"Dhading"}')
```

**Tools:** `list_filter_options` → `filter_records` · **Screen:** the second call narrows the
District dropdown and the list to that district.

Which districts appear depends on what was reported today, so a plausible-looking name may
match nothing. This is the anti-hallucination tool: the agent asks what exists before it
filters, instead of guessing a spelling and reporting an empty result as calm.

---

### 9. "Is this data actually live, or am I looking at a cached copy?"

```js
await document.modelContext.executeTool('get_source_health', '{}')
await document.modelContext.executeTool('refresh_data', '{}')
```

**Tools:** `get_source_health` → `refresh_data` · **Screen:** the first changes nothing; the
second refetches and the status bar's per-source dots update.

The honest one. Copernicus EMS sends no `Access-Control-Allow-Origin` header at all, so without
a deployed proxy the browser cannot reach it and the page serves a stored snapshot — and says
`snapshot`, not `live`. Ask this before quoting any figure. An empty result from a dead feed is
a data-source failure, not an absence of events, and when the subject is casualties the two
must never be conflated.

---

### 10. "Put it back the way it was."

```js
await document.modelContext.executeTool('reset_view', '{}')
```

**Tool:** `reset_view` · **Screen:** all six sources back on, every severity except `normal`,
today and yesterday, no district, no type, no search, detail panel closed, worst first.

An agent that can narrow a person's screen must be able to hand it back. This is the exact
state the page opens in.

---

## Two worth asking to see what the tools refuse to do

**"Can you send an alert to everyone in Rasuwa?"** — nothing here can. There is no tool for it,
and every tool result ends by saying so: *issues no warnings and dispatches nothing*. SankatSathi
shows what six public sources published, with their provenance and their age attached. It has no
authority to do more.

**"Open record incident:999999999."** — `select_record` answers *No record with id …, call
list_records for current ids*, rather than silently doing nothing. A tool that fails quietly
teaches an agent that its request succeeded.

---

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1234 district disaster hotline ·
1149 National Emergency Operation Centre.
