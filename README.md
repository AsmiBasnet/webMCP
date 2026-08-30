# SankatSathi · संकट साथी

**One place for the 2026 Nepal flood — and a way to interrogate the record behind it.**

Two pages, one site.

**[`index.html`](public/index.html) — the response page.** What a person actually needs after the
Bhote Koshi flood: the emergency numbers as tap-to-dial targets, the missing-person chain in the order
it has to be followed, what the state owes a survivor, the one lawful way to donate under Nepal's
one-door policy, and how to spot the fundraising fraud that appeared within 72 hours of the water.
Bilingual English/Nepali on everything a person must act on. It works with JavaScript disabled — the
only dynamic part is a live strip of river gauges and road closures on top.

**[`explore.html`](public/explore.html) — the data explorer.** A [WebMCP](https://github.com/webmachinelearning/webmcp)
interface to Nepal's public disaster record, registering twelve tools over the live BIPAD, GDACS and
GloFAS APIs so an agent can interrogate eleven years of national disaster data in one sentence.

Submission for the [WebMCP Challenge](https://webmcp.devpost.com/) (OpenAI / Devpost, 2026).

> It issues no orders and sends no alerts. It has no authority to.

---

## The gap this exists in

On 26 August 2026 a glacier collapsed on Langtang Lirung and sent ice, water and rock down 72 km of
the Trishuli, reaching the Chinese border in seven minutes. **768 dead, 2,502 missing, ~90,000
displaced** across seven districts, by the Nepal Police bulletin of 30 August.

Nepal's own machine-readable incident database, BIPAD, recorded **10 deaths nationwide** across the
same seven days.

Both are government sources. The second is simply not the one that gets updated during an emergency —
it is a district-officer reporting pipeline, and the pipeline is underwater. That gap is why this repo
has two pages instead of one: a dashboard over BIPAD alone would have shown a quiet week.

---

## The problem is not missing data

Nepal has already solved collection. NDRRMA's BIPAD platform holds 60,000+ verified incident records back to April 2015, each with casualty breakdowns **by sex and by disability**; river gauges reporting every ten minutes against per-station warning and danger levels; a live Department of Roads feed with closure reasons, repair ETAs and how many households are cut off.

All public. All free. And essentially unusable — a fixed dashboard over an undocumented API with **no aggregation endpoint at all**, meaning the country's own disaster record cannot be summarised without writing a scraper.

The gap is not collection. The gap is interrogation.

---

## Why WebMCP, specifically

- **The query space cannot be a UI.** 47 hazard types × 77 districts × 774 municipalities × 11 years × ~20 loss metrics, joinable against gauges, roads and facilities. A filter panel covers maybe four of those dimensions before it collapses.
- **DOM scraping fails here, and dangerously.** BIPAD's own portal is a JavaScript SPA that renders nothing to a scraper, and the payload is *casualty counts*. An agent inferring a death toll from a chart image is not merely less accurate — it is harmful. Typed tool returns are a safety requirement.
- **It makes absence askable.** *"Which municipalities have recorded flood incidents but no registered evacuation centre?"* joins two endpoints and aggregates in the browser because no summary endpoint exists. Today that answer is **335 of 388**. No dashboard asks it, because dashboards show what is there.

---

## Run it

No build step, no bundler, no keys.

```bash
node scripts/build-refdata.mjs     # admin hierarchy + hazard taxonomy → public/data/refdata.json
node scripts/build-snapshot.mjs    # offline fallback → public/data/snapshot/
npx http-server public -p 8787 -c-1
```

Then open <http://127.0.0.1:8787/> for the response page, or
<http://127.0.0.1:8787/explore.html> for the data explorer.

For the WebMCP path, open the explorer in Chrome with `chrome://flags/#enable-webmcp-testing`, or inside an agent that implements `document.modelContext`. Without one, the page says so plainly and the Ask box runs the identical tools locally.

### Ask it something

[`PROMPTS.md`](PROMPTS.md) lists every prompt worth trying, grouped by tool, with what each one
actually returned. All sixty were run against the live router before being written down.

### Verify it

```bash
node scripts/smoke.mjs         # every tool against the live APIs
node scripts/e2e.mjs           # real browser: registration, agent calls, rendering
node scripts/offline-test.mjs  # every upstream API blocked — snapshot fallback
node scripts/relief-test.mjs   # response page: live strip, console errors, overflow
```

---

## The tools

Read tools query real government data. The two write-ish tools produce artifacts the **user** owns — an OSM edit, a CAP document. Nothing commands anyone.

| Tool | Source | What it answers |
|---|---|---|
| `get_current_situation` | all four feeds at once | **What is happening right now, and where relief is needed** |
| `query_incidents` | `/incident/?expand=loss` | What happened, where, to whom |
| `get_casualty_breakdown` | same, aggregated in-browser | Totals by year / district / hazard, **split by sex and disability** |
| `get_river_status` | `/river/` (DHM) | Live level against each station's own warning and danger marks |
| `get_flood_forecast` | Open-Meteo GloFAS | Tomorrow — the one thing the record cannot hold |
| `get_road_closures` | `/highway/` (DoR) | What is closed, households cut off, **estimated vs actual** clearance |
| `find_nearby_resources` | `/resource/` | Where a person can actually go |
| `find_coverage_gaps` | two endpoints, joined | **What is missing from the record** |
| `get_global_alert_status` | GDACS | Alert level, GLIDE id, CAP link |
| `find_mapping_task` | HOT campaign | An open task in the flood area |
| `get_verified_donation_channels` | curated, verified | Five channels + how to spot a fake |
| `compose_cap_alert` | `/river/` | A CAP v1.2 document, status `Exercise` |

`get_current_situation` is the one the page opens on, and the one an agent should call first. It is the only tool that crosses the incident record, the gauges, the road register and the GDACS alert in a single answer — which is exactly the join no BIPAD screen performs. It ranks districts by **lives first** (deaths and missing, then injuries), never by incident count, which would only rank the districts whose reporting officers are most diligent. Districts with a road still closed are carried into the list even when they miss that ranking, because a district nobody can reach is a relief problem whether or not the casualty record has caught up with it yet.

### The flywheel

The app **reads** OpenStreetMap for roads and facilities, so it can **detect where OSM coverage is thin** inside flood-affected municipalities, and hand that gap to the user as a deep link into the HOT Tasking Manager campaign NDRRMA, NAXA and HOT opened for this flood on 27 August 2026. Fifteen minutes of tracing improves the same data the next query reads.

The agent finds the hole; the human fills it; the next answer is better.

---

## Findings from building against these APIs

The research docs in [`docs/`](docs/) were written before implementation. Building against the live APIs corrected four of their assumptions — recorded here because they are the parts a reader will otherwise trip over.

| Doc said | Actually |
|---|---|
| BIPAD CORS unverified, assume absent, **proxy required** | BIPAD, GDACS and Open-Meteo **all** return `Access-Control-Allow-Origin: *`. No proxy needed. `worker.js` remains, for caching and http-only photos. |
| `resourceType` filter is broken server-side; pull all and bucket | `resourceType` is indeed ignored — but **`resource_type` (snake_case) works**, as does `district`. Which matters: the register holds **58,650** facilities, far too many to pull in a browser. |
| CARTO basemaps, no key needed | CARTO's keyless endpoint now stamps **"API KEY REQUIRED"** across every tile. Switched to Esri Canvas, still keyless. |
| `tasks.hotosm.org/api/v2/*` returned empty — test from a browser | Returns **403** to browsers. Project deep links work, so the campaign list is curated. |

Two more, from the data rather than the docs.

**A date filter is not a recency filter.** `/river/?water_level_on__gt=…` is honoured, but BIPAD then serves the *oldest* rows matching the cutoff and pages forward. With ~170 gauges reporting every ten minutes that is ~1,000 rows an hour, so six pages of 500 never escape the first afternoon of the window: the app was displaying levels two days old under the heading "right now". `ordering=-water_level_on` puts the newest reading first and a single page then covers every station. The gauge tool now states the age of its newest reading in the answer itself, because a silently stale level reads as reassurance. The same trap applies to `/incident/`, where `ordering=-incident_on` was already in place.

**`/highway/` is a register, not a live board.** It holds 311 records going back to June 2025, most long since reopened. "What is closed" now means *not OPEN, and with no reopening time in the past* — four roads tonight, 242,830 households behind them. The full register is still used for the estimated-vs-actual clearance comparison, which needs the closures that ended.

One more: many gauges report **metres above sea level**, not metres above the river bed. A level-to-threshold *ratio* therefore reads 0.999 for a station sitting 1.8 m clear of its warning mark. Every comparison here is **headroom in metres**.

---

## Trust, as implemented

- **Provenance on every result** — endpoint, source and retrieval time, returned to the agent as well as shown on screen.
- **Failure is never an absence.** A failed fetch returns *"this is a data-source failure, not a finding"*, to the agent and the reader alike. A query that loses its later pages says its totals are floors.
- **The record's own uncertainty surfaces**: `verified` / `approved` flags are shown per incident.
- **Status is never colour alone** — every state carries a glyph and a word.
- **Snapshot mode** (`?mode=snapshot`, and automatic on failure) keeps a demo alive with the staleness stated, never passed off as live.

---

## What "real time" means here, exactly

There is nothing to subscribe to. BIPAD is a read-only REST API over a Django admin — no websocket, no
server-sent events, no webhook — so live means polling, and the only honest questions are how often and
how visibly. The page splits into three tiers, and each one states which it belongs to:

| Tier | What | How live |
|---|---|---|
| **Live** | River gauges, road closures | Polled every 3 min while the tab is open. Displayed age ticks every 15 s with no network traffic. |
| **On demand** | Incidents, GDACS, GloFAS forecast | Fetched per query in the explorer; 2-min memo so a demo audience cannot hammer the server. |
| **Hand-entered** | Casualty counts — 768 dead, 2,502 missing | **Not live and cannot be.** No API publishes them. |

**Three minutes is set by the source, not by what feels live.** DHM's gauges report every ten minutes
and the road register is updated by hand by division officers, so polling faster returns an identical
body and adds load to a government server currently being used to run a flood response. What a reader
actually needs is not a request firing — it is knowing how old the number is. So the fetch is slow and
the clock is fast.

The loop pauses on a hidden tab, refreshes on return if the reading has gone stale, backs off
exponentially to 15 minutes on repeated failure, and keeps the last good reading rather than blanking a
panel — a person looking at a river level needs the old number plus its age far more than an empty box.

**The failure case is the one that matters.** `getJSON` falls back to the built-in snapshot when a source
is unreachable, so a poll can "succeed" while quietly serving canned data hours old. The status line
distinguishes all three states — fresh, last-good, and snapshot — because saying *"fetched 0s ago"* over
stored data would be a lie told in the one place a reader looks to check.

The casualty tier is the honest limit of this whole project: BIPAD's machine record says 10 deaths for
the week, the Nepal Police bulletin says 768, and the bulletin is a press release, not an endpoint.
Those figures carry a `data-captured` timestamp and render their own age — *"entered by hand 11 hours
ago"* — turning red past a day old, with a link to the current bulletin.

---

## Deploy

```bash
npx wrangler pages deploy ./public --project-name sankatsathi
npx wrangler deploy worker.js --name sankatsathi-proxy   # optional
```

Static hosting is enough — there is no server. Cloudflare Pages, Netlify and Vercel all work as-is.

---

## Attribution

Data from Nepal government sources that publish **no stated licence** — BIPAD/NDRRMA, DHM, and the Department of Roads — is displayed with attribution for informational purposes and is not redistributed. See [`docs/05-credits-and-licences.md`](docs/05-credits-and-licences.md) and the credit block in the page footer.

SankatSathi is an independent project. It is not affiliated with, endorsed by, or operated by NDRRMA, DHM, DoR or the Government of Nepal, and it is not an official warning service.

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1149 National Emergency Operation Centre

Licensed under [MIT](LICENSE).
