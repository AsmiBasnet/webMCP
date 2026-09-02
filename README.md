# SankatSathi · संकट साथी

**Live disaster data for Nepal, from six sources, in one filterable view.**

Nepal publishes a great deal of disaster data and almost none of it together. Incidents sit in one
API, river gauges in another, road closures in a third, international alerts in a fourth, forecasts in
a fifth, satellite damage assessment in a sixth — each with its own shape, its own cadence, and its
own idea of what counts as serious. This puts all six on one screen, normalised into one record type
you can filter, sort and open up.

One page. It opens on today and yesterday, worst first. Filter by source, severity, district, type,
window and free text; click any record for every field the source published, its provenance, and the
raw payload verbatim.

No build step, no bundler, no keys, no server — five ES modules and a stylesheet.

> It issues no orders and sends no alerts. It has no authority to.

---

## Two implementations in this repository

This repository holds two takes on SankatSathi, merged rather than reconciled, because they answer
different questions and neither is a draft of the other.

| | Where | What it is |
|---|---|---|
| **Live data view** | `public/` | This README. Six live public sources, normalised into one filterable record type, with eleven WebMCP tools over the same state. Real endpoints, no mock data. |
| **Command-centre prototype** | `index.html`, `app.js`, `agent.js`, `webmcp.js`, `style.css` at the repository root | An agent-operable flood-response command centre — SOS queues, relief depot inventories, dispatch routing — over authored scenario data. Its README is preserved at [`docs/07-command-center-prototype.md`](docs/07-command-center-prototype.md). |

They share a name, a subject and the WebMCP idea, and nothing else: no shared modules, no shared
data, no shared build. The paths do not collide — the root `webmcp.js` and `public/js/webmcp.js`
are different files serving different pages, as are the two `index.html`. `npm run serve` and the
deploy script both serve `public/`; open the root `index.html` directly to run the prototype.

---

## The six sources

| Source | Origin | Endpoint | Publishes |
|---|---|---|---|
| Incidents | BIPAD / NDRRMA | `/api/v1/incident/?expand=loss` | as district officers file |
| Gauges | DHM via BIPAD | `/api/v1/river/?ordering=-water_level_on` | every 10 min, ~163 stations |
| Roads | Dept. of Roads via BIPAD | `/api/v1/highway/` | as divisions report |
| Alerts | GDACS / EC JRC | `events/geteventlist/SEARCH` | per episode |
| Forecast | GloFAS / Open-Meteo | `v1/flood` | daily, 3 river points |
| Damage | Copernicus EMS Rapid Mapping | `dashboard-api/public-activations/` | per satellite pass |

Forecast points are fixed, because GloFAS is queried per coordinate rather than per country: Rasuwa
(Bhote Koshi), Nuwakot (Trishuli) and Chitwan (Narayani) — the corridor of the 2026 flood.

**Copernicus EMS is the only source that counts buildings from orbit** rather than from a district
officer's form — which matters precisely when the reporting chain is underwater. Activation EMSR927
covers this flood across four areas of interest, and there is one record per area, because a single
row for the whole activation would hide which valley is worst. As of the last capture: Timure,
**431 of 441 buildings affected**; Syapru Besi, 433 of 559.

It takes two calls, since the activation list carries no geometry and no statistics and each open
activation's detail is fetched separately. It is also the one source that cannot be read from a
browser at all.

Each source is fetched in parallel, and **a source that fails does not fail the load**. An unreachable
gauge network is no reason to hide the road closures; the failure is named in the status bar and the
rest of the feed renders.

### The one source that needs the proxy

`worker.js` was written for caching and for upgrading http-only station photos, and this README used
to say it was not needed for CORS. That was true of the first five sources. Verified 30 Aug 2026:
`rapidmapping.emergency.copernicus.eu` returns **no `Access-Control-Allow-Origin` header at all**, so
a browser fetch of it fails outright.

The app treats that like any unreachable source. It falls back to the build-time snapshot — which
works because `build-snapshot.mjs` runs in Node, where CORS does not apply — and the status bar
reports `damage · serving stored snapshot — not live` rather than passing satellite figures off as
current. Set `PROXY` in `config.js` to a deployed worker and the source goes live; leave it empty and
the data is still there, correctly labelled as stored.

---

## The unified record

`public/js/feed.js` is the only file that knows how the six sources differ. Each normaliser returns
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

Damage has a scale of its own, since a building count is not a casualty count:

| Tier | Damage |
|---|---|
| **critical** | ≥50% of surveyed buildings affected |
| **serious** | ≥20% |
| **warning** | >0% |
| **normal** | none affected |
| **info** | mapped, no statistics published yet |

Damage ranks by the **share** of surveyed buildings affected rather than the count: a settlement where
nine in ten are gone is not the same finding as one where three in a hundred are, and a raw count
conflates both with size.

Two more choices worth naming. **An incident ranks by harm, not by hazard type** — a snake bite that killed
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
| Source | Six toggles. Off-state shows as `—` in the status bar, not as zero. |
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
  index.html          the page
  dash.css            its styles
  data/               refdata.json + snapshot/
  js/
    config.js         endpoints, proxy, Nepal bounds
    api.js            fetch, memo, snapshot fallback, provenance, coordinate guard
    refdata.js        name → id, ward → municipality → district
    feed.js           six sources → one record type; severity, day buckets, filters
    dash.js           filter bar, list, drill-down, map, refresh loop
    webmcp.js         eleven WebMCP tools over the same state — invisible to the interface
scripts/
  build-refdata.mjs   admin hierarchy + hazard taxonomy → data/refdata.json
  build-snapshot.mjs  six captures, plus one per open EMS activation → data/snapshot/
  dash-test.mjs       six sources, day grouping, filters, drill-down, refresh, mid-session outage
  offline-test.mjs    every upstream dead before first byte — snapshot only
  webmcp-test.mjs     calls every tool through document.modelContext; asserts the page moved
  shots.mjs           the same calls at seven viewport widths; asserts nothing overflows
worker.js             Cloudflare proxy — required for Copernicus, optional for the rest
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
- Snapshot mode, for a demo with no network: <http://127.0.0.1:8787/?mode=snapshot>

### Verify it

```bash
npm run test:dash      # six sources, day grouping, filters, drill-down, refresh, mid-session outage
npm run test:offline   # every upstream dead before the first byte — snapshot only
npm run test:webmcp    # every tool called through document.modelContext, and the DOM checked after
npm run shots          # the same calls at seven widths, 360px to 1920px → shots/
```

`test:dash` asserts the things that are easy to get quietly wrong: that all six sources contribute,
that the default window is today + yesterday with `Today` first, that `normal` is off and toggling it
reveals the rest, that widening the window re-fetches rather than re-filters, that drill-down shows
provenance and raw payload, that Copernicus still yields records from its snapshot and discloses that
it did, and that an induced outage keeps the last good records on screen while saying so.

`test:offline` is the harder case: every upstream is dead *before the first byte*, so there is no last
good reading to fall back on. All six sources must render from the snapshot, every one must be
labelled stale, the filters must still work, and nothing on screen may claim to be live.

---

## The same page, addressed by an agent

The interface is for a person with a mouse. Underneath it, the page registers **eleven
[WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools** on `document.modelContext`, so an
agent can ask for the same things in a sentence. Nothing about this is visible in the interface —
it appears only in DevTools and to whatever agent is reading the page.

| Tool | | |
|---|---|---|
| `get_situation_summary` | read | counts by severity and source, worst districts, per-source freshness |
| `list_records` | read | the rows on screen, worst first, with their ids |
| `get_record_details` | read | every field one source published for one record, plus the raw payload |
| `list_filter_options` | read | the district and hazard names the filter will actually accept |
| `cross_reference_district` | read | **everything all six sources say about one district, side by side, with the divergences between them named** |
| `get_source_health` | read | which sources are live, on snapshot, or unreachable — and how old |
| `filter_records` | **write** | the whole filter bar in one call: sources, severities, window, district, type, search, sort |
| `select_record` | **write** | opens a record's drill-down and pans the map to it |
| `focus_map` | **write** | moves the map only — a district, coordinates, or all of Nepal |
| `reset_view` | **write** | back to how the page opens |
| `refresh_data` | **write** | refetch all six sources now |

**The five write tools move the screen the person is looking at**, because they mutate the same
`state.filters` a click mutates and then re-render. Ask for road closures and the Roads chip lights,
the list collapses, the map refits, the counts follow. There is no agent-only code path and no
agent-only data — which is the argument for WebMCP over DOM actuation: the page declares what it can
do instead of the agent guessing which button to press, and the human watching sees the work happen.

`cross_reference_district` is the one that earns the whole exercise. Nepal publishes all six of
these feeds and none of them together, so the comparison is the product. Ask it about Rasuwa
during the August 2026 GLOF flood and it returns, in one answer: Copernicus grading **864 of
1,000 surveyed buildings** as affected across two settlements, the incident record holding **one
record** for the same window, a highway closed since 26 August with **7,025 households behind
it**, a gauge, a forecast — and an explicit note that satellite assessment does not depend on a
district officer being able to file, and the filing chain is what breaks when the roads are cut.
It states the divergence and refuses to resolve it; it cannot know which source is right, only
that reading either alone would be a mistake.

Every result carries the same footer the page does — no warnings issued, nothing dispatched — and a
tool that fails says so in a sentence telling the agent not to read it as an absence of events. That
is what `get_source_health` is for: when the subject is casualties, *nothing happened* and *the feed
is down* must never come out looking the same.

WebMCP is an origin trial from Chrome 149 and a flag (`chrome://flags/#enable-webmcp-testing`) before
that, so on most browsers `document.modelContext` does not exist. Where it is missing the page
installs a small shim of the same shape, marked `shim: true` and announced in the console, so the
tools stay callable from DevTools and from Playwright. Where it exists, the shim never installs.

```js
await document.modelContext.getTools();                        // eleven tools
await document.modelContext.executeTool('filter_records', '{"sources":["road"]}');
```

Ten prompts to try are in [`PROMPTS.md`](PROMPTS.md); the API, the security model and the design
rules are in [`docs/06-webmcp.md`](docs/06-webmcp.md).

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
| `worker.js` is not needed for CORS | True of five sources. Copernicus EMS sends **no CORS header at all**, so it cannot be read from a browser without the proxy. |

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
Esri. GDACS © European Commission JRC.

Copernicus data is used under the Copernicus data and information policy — free, full and open access,
with attribution required. **Contains Copernicus Emergency Management Service information 2026**:
GloFAS forecasts via Open-Meteo, and Rapid Mapping activation EMSR927. Of every source here, it is the
only one that states a licence at all.

SankatSathi is an independent project. It is not affiliated with, endorsed by, or operated by NDRRMA,
DHM, DoR or the Government of Nepal, and it is not an official warning service.

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1234 district disaster hotline · 1149 National
Emergency Operation Centre

Licensed under [MIT](LICENSE).
