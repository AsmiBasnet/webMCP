# SankatSathi · संकट साथी

**Live disaster data for Nepal, from five sources, in one filterable view.**

Nepal publishes a great deal of disaster data and almost none of it together. Incidents sit in one
API, river gauges in another, road closures in a third, international alerts in a fourth, forecasts in
a fifth — each with its own shape, its own cadence, and its own idea of what counts as serious. This
puts all five on one screen, normalised into one record type you can filter, sort and open up.

Two pages:

- **`index.html`** — the live view. Filter by source, severity, district, type, time window and free
  text; click any record for every field the source published, its provenance, and the raw payload.
- **`explore.html`** — the same data as [WebMCP](https://github.com/webmachinelearning/webmcp) tools,
  so an agent can query it in a sentence. Twelve tools, plus a keyword ask box for browsers with no
  agent.

Submission for the [WebMCP Challenge](https://webmcp.devpost.com/) (OpenAI / Devpost, 2026).

> It issues no orders and sends no alerts. It has no authority to.

---

## The five sources

| Source | Origin | Publishes | Records |
|---|---|---|---|
| Incidents | BIPAD / NDRRMA | as district officers file | ~270 in a 7-day window |
| Gauges | DHM via BIPAD | every 10 min | ~163 stations |
| Roads | Dept. of Roads via BIPAD | as divisions report | blockages still in force |
| Alerts | GDACS / EC JRC | per episode | active events for Nepal |
| Forecast | GloFAS / Open-Meteo | daily | 3 river points, 21-day window |

Each is normalised into one record — `{ source, kind, title, at, severity, district, point, line,
metrics, raw }` — so the list can sort a road closure against a gauge reading against a casualty
report. `raw` is the untouched payload, so drill-down shows exactly what the source said rather than
what this app made of it.

**Severity is comparable across sources, and derived, not copied.** An incident ranks by harm (deaths,
then missing, then injured) rather than by hazard type. A gauge ranks by headroom in metres, never a
ratio — many stations report metres above sea level, so level/threshold reads 0.999 for a gauge
sitting 1.8 m clear. A road ranks by status and how many households are behind it.

---

## What it opens on

**Today and yesterday, worst first.** The list groups under sticky day headers —
`Today` / `Yesterday` / `Earlier` — and sorts by severity inside each, because sorting by severity
alone floats a fatal incident from nine days ago above a highway that closed this morning.

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

---

## What "live" means here

There is nothing to subscribe to: BIPAD is a read-only REST API over a Django admin, with no
websocket, no server-sent events and no webhook. So live means polling, and the honest questions are
how often and how visibly.

**Every three minutes**, set by the source rather than by what feels live — DHM's gauges publish every
ten minutes and the road register is updated by hand, so polling harder returns an identical body and
adds load to a government server currently being used to run a flood response. The displayed age ticks
every fifteen seconds without touching the network, because what a reader needs is not a request
firing but knowing how old the number is.

The loop pauses on a hidden tab, refreshes on return if the reading has gone stale, and backs off
exponentially to fifteen minutes on repeated failure.

**The status bar distinguishes three states per source**, not two: live, unreachable, and *serving
stored snapshot*. The third is the one that matters — `getJSON` falls back to a built-in snapshot when
a source is down, so a poll can "succeed" while quietly returning hours-old canned rows. A green dot
over stored data is the one lie this bar must never tell.

---

## Run it

No build step, no bundler, no keys.

```bash
node scripts/build-refdata.mjs     # admin hierarchy + hazard taxonomy → public/data/refdata.json
node scripts/build-snapshot.mjs    # offline fallback → public/data/snapshot/
npx http-server public -p 8787 -c-1
```

- Live view: <http://127.0.0.1:8787/>
- Agent tools and ask box: <http://127.0.0.1:8787/explore.html>
- Snapshot mode, for a demo with no network: <http://127.0.0.1:8787/explore.html?mode=snapshot>

### Verify it

```bash
node scripts/dash-test.mjs     # live view: five sources, filters, drill-down, refresh, degradation
node scripts/smoke.mjs         # every tool against the live APIs
node scripts/e2e.mjs           # real browser: WebMCP registration, agent calls, rendering
node scripts/offline-test.mjs  # every upstream API blocked — snapshot fallback
```

[`PROMPTS.md`](PROMPTS.md) lists every prompt worth trying against the explorer.

---

## Findings from building against these APIs

The research docs in [`docs/`](docs/) were written before implementation. Building against the live
APIs corrected several of their assumptions, and turned up more in the data itself.

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
window — this app was showing levels two days old under the heading "right now" until
`ordering=-water_level_on` was added.

**Gauges report against different datums.** Many publish metres above sea level rather than above the
river bed, so a level-to-threshold ratio reads 0.999 for a station 1.8 m clear of its warning mark.
Every comparison here is headroom in metres.

**`/highway/` is a register, not a live board.** 311 records going back to June 2025, most long
reopened. "Currently blocked" means not OPEN with no reopening time in the past — and a closure logged
more than a week ago with no reopening is flagged unverified rather than reported as current, because
routing someone around a road that reopened in July is as harmful as missing one that is shut.

**One gauge publishes its coordinates transposed.** "Roshi Khola at Kavre" comes back as [lat, lon]
where every other record is [lon, lat]. Flipped again it lands at 85.7 N in the Arctic Ocean — a valid
latitude, so it survives every range check while dragging the map off the country. The flip is now
verified rather than assumed.

**BIPAD's `count` is always int64 max** (9223372036854775807), so pagination has to walk until a short
page comes back, and every total is computed client-side.

**The incident record lags the disaster it is recording.** During the Bhote Koshi flood, BIPAD held
~10 deaths nationwide for the week while the Nepal Police bulletin reported 768. Both are government
sources; BIPAD is a district-officer reporting pipeline, and during an emergency the pipeline is
underwater. Nothing in this app can fix that — but it is why the live view shows what each source
says, with its age, rather than merging them into a single confident number.

---

## Trust, as implemented

- **Provenance on every record** — source, origin, publishing cadence, and the raw payload.
- **Failure is never an absence.** An empty list says so: *"a data-source failure, not an absence of
  events."* A query that loses its later pages says its totals are floors.
- **Snapshot fallback is disclosed per source**, never shown as healthy.
- **The record's own uncertainty surfaces**: `verified` / `approved` flags per incident.
- **Status is never colour alone** — every state carries a word.

---

## Deploy

```bash
npx wrangler pages deploy ./public --project-name sankatsathi
npx wrangler deploy worker.js --name sankatsathi-proxy   # optional
```

Static hosting is enough — there is no server.

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
