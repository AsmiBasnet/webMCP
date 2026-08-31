# SankatSathi · संकट साथी

**Live disaster data for Nepal, from five sources, in one filterable view.**

Nepal publishes a great deal of disaster data and almost none of it together. Incidents sit in one
API, river gauges in another, road closures in a third, international alerts in a fourth, forecasts in
a fifth — each with its own shape, its own cadence, and its own idea of what counts as serious. This
puts all five on one screen, normalised into one record type you can filter, sort and open up.

Two pages, sharing one data layer:

- **`index.html`** — the live view. Opens on today and yesterday, worst first. Filter by source,
  severity, district, type, window and free text; click any record for every field the source
  published, its provenance, and the raw payload.
- **`explore.html`** — the same data as [WebMCP](https://github.com/webmachinelearning/webmcp) tools,
  so an agent can query it in a sentence. Twelve tools, plus a deterministic keyword ask box for
  browsers with no agent.

Submission for the [WebMCP Challenge](https://webmcp.devpost.com/) (OpenAI / Devpost, 2026).

> It issues no orders and sends no alerts. It has no authority to.

---

## The five sources

| Source | Origin | Endpoint | Publishes |
|---|---|---|---|
| Incidents | BIPAD / NDRRMA | `/api/v1/incident/?expand=loss` | as district officers file |
| Gauges | DHM via BIPAD | `/api/v1/river/?ordering=-water_level_on` | every 10 min, ~163 stations |
| Roads | Dept. of Roads via BIPAD | `/api/v1/highway/` | as divisions report |
| Alerts | GDACS / EC JRC | `events/geteventlist/SEARCH` | per episode |
| Forecast | GloFAS / Open-Meteo | `v1/flood` | daily, 3 river points |

Forecast points are fixed, because GloFAS is queried per coordinate rather than per country: Rasuwa
(Bhote Koshi), Nuwakot (Trishuli) and Chitwan (Narayani) — the corridor of the 2026 flood.

Each source is fetched in parallel, and **a source that fails does not fail the load**. An unreachable
gauge network is no reason to hide the road closures; the failure is named in the status bar and the
rest of the feed renders.

---

## The unified record

`public/js/feed.js` is the only file that knows how the five sources differ. Each normaliser returns
the same shape:

```js
{
  id, source, current,          // current: does this describe now, or a past moment?
  kind, title, titleNe, at,
  severity, severityLabel,      // comparable across sources — see below
  district, districtNe, municipality, point,
  line,                         // the one-line summary in the list
  metrics,                      // what drill-down tabulates
  raw,                          // the untouched payload, verbatim
}
```

`raw` rides along on every record so drill-down shows exactly what the source said, not what this app
made of it.

### Severity is derived, not copied

Five feeds with five vocabularies cannot sort against each other, so severity is computed from what
each record actually means:

| Tier | Incident | Gauge | Road | Alert | Forecast |
|---|---|---|---|---|---|
| **critical** | ≥1 death | at/above danger level | closed, >20k households cut off | GDACS Red | — |
| **serious** | ≥1 missing | at/above warning level | closed | GDACS Orange | peak >+50% |
| **warning** | ≥1 injured | within 0.5 m of warning | partly open, or a stale record | GDACS Green | peak >+15% |
| **normal** | — | below warning, or no thresholds published | open | — | peak ≤+15% |
| **info** | no casualties recorded | — | — | — | no signal |

Two choices worth naming. **An incident ranks by harm, not by hazard type** — a snake bite that killed
someone outranks a flood that hurt nobody, because the list is read by people deciding where to look
next. **A gauge ranks by headroom in metres, never a ratio** — many stations report metres above sea
level, so level/threshold reads 0.999 for a gauge sitting 1.8 m clear of its mark.

A gauge with no thresholds published falls to the bottom tier: it cannot be assessed, so it cannot be
urgent. Its label says *"cannot be assessed"* and never anything that reads as "fine".

---

## What it opens on

**Today and yesterday, worst first.** The list groups under sticky day headers — `Today` /
`Yesterday` / `Earlier` — and sorts by severity inside each, because sorting by severity alone floats
a fatal incident from nine days ago above a highway that closed this morning.

Everything else is one control away. The **window** widens to 7, 30 or 90 days; the **severity** chips
start with `normal` switched off, because 163 gauges report every ten minutes and on a quiet day all
but a handful sit below their warning level — 159 rows of "nothing is happening" ahead of anything
that is. One click brings them back.

**The window filters events, not state.** An incident or a closed GDACS episode happened on a date, so
an older one drops out of a two-day view. A gauge reading, a forecast, an open alert and a roadblock
still in force describe the *present* — a highway blocked since July is cutting people off right now,
and hiding it from a "recent" view because it started weeks ago would be the most dangerous kind of
tidy. Those carry `current: true` and are always shown, grouped under `Earlier` with their real start
date.

That rule earns its keep in both directions. GDACS was unreachable while this was built, and the
snapshot fallback carries its events back to 2015: without the rule, eleven-year-old alerts filled a
two-day view while the Mechi highway blocked since July silently vanished from it.

### Filters

| Control | Behaviour |
|---|---|
| Source | Five toggles. Off-state shows as `—` in the status bar, not as zero. |
| Severity | Five toggles, `normal` off by default. |
| Window | Today · today + yesterday (default) · 7 · 30 · 90 days. Changing it **re-fetches**. |
| District | Populated from the data with counts, 77 districts at full window. |
| Type | Hazard, basin or closure reason, also counted. |
| Sort | Today first (default, grouped) · severity · most recent. |
| Search | Free text over title, Nepali title, type, district, location and summary. |

District and type options are computed **before** those two filters are applied, so the dropdowns keep
offering their other values. A filter that erases its own options is a trap.

---

## What "live" means here

There is nothing to subscribe to: BIPAD is a read-only REST API over a Django admin, with no
websocket, no server-sent events and no webhook. So live means polling, and the honest questions are
how often and how visibly.

**Every three minutes**, set by the source rather than by what feels live — DHM's gauges publish every
ten minutes and the road register is updated by hand, so polling harder returns an identical body and
adds load to a government server that may at that moment be coordinating a flood response. The
displayed age ticks every fifteen seconds without touching the network, because what a reader needs is
not a request firing but knowing how old the number is.

The loop pauses on a hidden tab, refreshes on return if the reading has gone stale, and backs off
exponentially to fifteen minutes on repeated failure. A two-minute memo in `api.js` protects the
upstream from a demo audience hitting reload; a deliberate refresh passes `force` to bypass it, so the
page never claims to have updated when nothing moved.

**The status bar distinguishes three states per source**, not two: live, unreachable, and *serving
stored snapshot*. The third is the one that matters — `getJSON` falls back to a built-in snapshot when
a source is down, so a poll can "succeed" while quietly returning hours-old canned rows. A green dot
over stored data is the one lie this bar must never tell.

Counts in that bar are **what each source contributed to the current window**, before the severity and
district filters. Counting the fully filtered list would report "Gauges 4" while 163 stations are
reporting perfectly well; counting everything fetched would report "Alerts 17" while none are in view.

---

## Layout

```
public/
  index.html          the live view
  dash.css            its styles
  explore.html        the agent / ask-box page
  styles.css          its styles
  data/               refdata.json + snapshot/
  js/
    feed.js           five sources → one record type; severity, buckets, filters
    dash.js           filter bar, list, drill-down, map, refresh loop
    api.js            fetch, memo, snapshot fallback, provenance, coordinate guard
    refdata.js        name → id, ward → municipality → district
    tools.js          the twelve tools
    webmcp.js         tool specs and document.modelContext registration
    ask.js            deterministic keyword router (no model)
    app.js            explorer boot
    render.js         one renderer per tool
    charts.js         inline SVG gauge bars, hydrographs, stacked bars
    map.js            Leaflet layers for the explorer
scripts/
  build-refdata.mjs   admin hierarchy + hazard taxonomy → data/refdata.json
  build-snapshot.mjs  six captures → data/snapshot/
  dash-test.mjs       the live view
  smoke.mjs           every tool against the live APIs
  e2e.mjs             browser: WebMCP registration, agent calls, rendering, overflow
  offline-test.mjs    every upstream blocked
  shot.mjs            screenshots three explorer answers (gaps, casualties, forecast)
worker.js             optional Cloudflare proxy — caching and http-only photos, not CORS
```

---

## Run it

No build step, no bundler, no keys.

```bash
npm run refdata     # admin hierarchy + hazard taxonomy → public/data/refdata.json
npm run snapshot    # offline fallback → public/data/snapshot/
npm run serve       # http-server on :8787
```

- Live view: <http://127.0.0.1:8787/>
- Agent tools and ask box: <http://127.0.0.1:8787/explore.html>
- Snapshot mode, for a demo with no network: <http://127.0.0.1:8787/explore.html?mode=snapshot>

For the agent path, open the explorer in Chrome with `chrome://flags/#enable-webmcp-testing`, or
inside an agent that implements `document.modelContext`. Without one the page says so plainly and the
ask box runs the identical tools locally.

### Verify it

```bash
npm run test:dash      # five sources, day grouping, filters, drill-down, refresh, degradation
npm run test:tools     # every tool against the live APIs
npm run test:e2e       # real browser: WebMCP registration, agent calls, rendering, overflow
npm run test:offline   # every upstream API blocked — snapshot fallback
```

`test:dash` asserts the things that are easy to get quietly wrong: that all five sources contribute,
that the default window is today + yesterday with `Today` first, that `normal` is off and toggling it
reveals the rest, that widening the window re-fetches rather than re-filters, that drill-down shows
provenance and raw payload, and that an induced outage keeps the last good records on screen while
saying so.

[`PROMPTS.md`](PROMPTS.md) lists sixty prompts for the explorer, grouped by tool, each run against the
live router before being written down.

---

## Findings from building against these APIs

The research docs in [`docs/`](docs/) were written before implementation. Building against the live
APIs corrected several of their assumptions, and the data turned up more.

| Doc said | Actually |
|---|---|
| BIPAD CORS unverified, assume absent, **proxy required** | BIPAD, GDACS and Open-Meteo **all** return `Access-Control-Allow-Origin: *`. No proxy needed. `worker.js` remains, for caching and http-only photos. |
| `resourceType` filter is broken server-side; pull all and bucket | `resourceType` is indeed ignored — but **`resource_type` (snake_case) works**, as does `district`. Which matters: the register holds **58,650** facilities. |
| CARTO basemaps, no key needed | CARTO's keyless endpoint now stamps **"API KEY REQUIRED"** across every tile. Switched to Esri Canvas, still keyless. |
| `tasks.hotosm.org/api/v2/*` returned empty — test from a browser | Returns **403** to browsers. Project deep links work, so the campaign list is curated. |

From the data rather than the docs:

**A date filter is not a recency filter.** `/river/?water_level_on__gt=…` is honoured, but BIPAD then
serves the *oldest* rows matching the cutoff and pages forward. With ~170 gauges reporting every ten
minutes that is ~1,000 rows an hour, so six pages of 500 never escape the first afternoon of the
window — this app displayed levels two days old under the heading "right now" until
`ordering=-water_level_on` was added.

**Gauges report against different datums.** Many publish metres above sea level rather than above the
river bed, so a level-to-threshold ratio reads 0.999 for a station 1.8 m clear of its warning mark.
Every comparison here is headroom in metres.

**`/highway/` is a register, not a live board.** 311 records going back to June 2025, most long
reopened. "Currently blocked" means not OPEN with no reopening time in the past — and a closure logged
more than a week ago with no reopening is flagged *unverified* rather than reported as current,
because routing someone around a road that reopened in July is as harmful as missing one that is shut.

**One gauge publishes its coordinates transposed.** "Roshi Khola at Kavre" comes back as `[lat, lon]`
where every other record is `[lon, lat]`. Flipped again it lands at 85.7° N in the Arctic Ocean — a
valid latitude, so it survives every range check while dragging the map off the country and zooming
the view out to the whole world. `latlng()` now verifies the flip against Nepal's bounds instead of
assuming it, correcting only unambiguously transposed records and leaving genuinely foreign points
(a GDACS event centred over Tibet) alone.

**BIPAD's `count` is always int64 max** (9223372036854775807), so pagination has to walk until a short
page comes back, and every total is computed client-side.

**The incident record lags the disaster it is recording.** During the Bhote Koshi flood, BIPAD held
~10 deaths nationwide for the week while the Nepal Police bulletin reported 768. Both are government
sources; BIPAD is a district-officer reporting pipeline, and during an emergency the pipeline is
underwater. Nothing in this app can fix that — but it is why the view shows what each source says,
with its age, rather than merging them into a single confident number.

---

## Trust, as implemented

- **Provenance on every record** — source, origin, publishing cadence, record id, and the raw payload.
- **Failure is never an absence.** An empty list says so: *"a data-source failure, not an absence of
  events."* A query that loses its later pages marks its totals as floors.
- **Snapshot fallback is disclosed per source**, never shown as healthy.
- **The record's own uncertainty surfaces** — `verified` / `approved` flags per incident; roadblocks
  whose records look stale are labelled unverified rather than dropped or trusted.
- **Status is never colour alone** — every state carries a word.

---

## Deploy

```bash
npm run deploy         # wrangler pages deploy ./public
npm run deploy:proxy   # optional worker
```

Static hosting is enough — there is no server. Cloudflare Pages, Netlify and Vercel all work as-is.

---

## Attribution

Data from Nepal government sources that publish **no stated licence** — BIPAD/NDRRMA, DHM, and the
Department of Roads — is displayed with attribution for informational purposes and is not
redistributed. See [`docs/05-credits-and-licences.md`](docs/05-credits-and-licences.md). Basemaps ©
Esri. GDACS © European Commission JRC. Forecasts from Open-Meteo / Copernicus EMS GloFAS.

SankatSathi is an independent project. It is not affiliated with, endorsed by, or operated by NDRRMA,
DHM, DoR or the Government of Nepal, and it is not an official warning service.

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1234 district disaster hotline · 1149 National
Emergency Operation Centre

Licensed under [MIT](LICENSE).
