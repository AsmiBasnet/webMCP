# SankatSathi v2 — Data · Views · Actions

**The reframe:** stop simulating a government command centre nobody gave you authority to run. Build the thing that doesn't exist yet — **a queryable public interface to Nepal's real disaster data, where every query ends in something the person can actually do.**

BIPAD has 11 years of incident data behind an undocumented API and a dashboard almost nobody can interrogate. Your contribution is making that corpus answerable in natural language, by an agent, with a real action at the end of every answer.

All endpoints below verified live on 30 August 2026.

---

## Part 1 — What data I can bring

I enumerated the BIPAD API root: **~150 routes, no auth, no key.** Here is what's actually useful.

### 1.1 The four load-bearing datasets

**`/api/v1/incident/` — 60,000–65,000 real incidents, Apr 2015 → today**

With `?expand=loss` each incident carries a full casualty breakdown. Verified live, an incident created *today*:

```
GET /api/v1/incident/?hazard=11&expand=loss&ordering=-incident_on&limit=50
```
```json
{ "id": 93811,
  "title": "Flood at Dharche Rural Municipality-5",
  "titleNe": "गण्डकी, गोरखा, धार्चे-५ मा बाढी",
  "point": {"coordinates": [84.8101, 28.27345]},
  "incidentOn": "2026-08-30T00:00:00+05:45",
  "verified": true, "approved": true,
  "hazard": 11,
  "loss": {
    "peopleDeathCount": 0, "peopleMissingCount": 0, "peopleInjuredCount": 0,
    "peopleAffectedCount": 0, "familyAffectedCount": 1,
    "familyRelocatedCount": 0, "familyEvacuatedCount": 0,
    "infrastructureDestroyedHouseCount": 0, "infrastructureDestroyedBridgeCount": 0,
    "infrastructureAffectedRoadCount": 0, "livestockDestroyedCount": 0,
    "infrastructureEconomicLoss": 0, "agricultureEconomicLoss": 0, "estimatedLoss": null }}
```

Death/missing/injured counts are further broken down **male / female / other / unknown / disabled** — which means you can ask *"are disabled people disproportionately represented in flood casualties in the Terai?"* and get a real answer. That question has never had a public interface.

Working filters (verified): `hazard=`, `district=`, `municipality=`, `incident_on__gt=`, `incident_on__lt=`, `search=`, `expand=loss`, `ordering=-incident_on`.
Broken (accepted but ignored — do not trust): `verified=`, `approved=`, `source=`, `hazard__in=`.

**`/api/v1/river/` — live gauges, 10-minute interval**

`waterLevel` (m), `warningLevel`, `dangerLevel`, `status`, `steady` (`RISING`/`STEADY`/`FALLING`), `basin`, `point`, district/municipality/ward. **Must** pass `?water_level_on__gt=` or you get 2025 data. Use **`/river-trimed/`** (daily averages) for long time-series — don't pull 10-minute readings across years.

**`/api/v1/highway/` — this one is a gift.** Live Department of Roads roadblock feed:

```json
{ "title": "Thori-Bharatpur-Mugling, Aarughat-Sirdibas-Roila Bhanjyang",
  "roadRefno": "NH44", "status": "OPEN",
  "closureReason": "Debris flow from gully.",
  "repairEta": "1 hours", "actualRepairTime": "4 hours",
  "effortsBeingMade": "Loader and excavator are mobilized for clearance",
  "contactPerson": "Er. Arjun Ghimire",
  "images": ["https://navigate.dor.gov.np/api/uploads/images/f798..."],
  "affectedDemography": {"maleCount": 458011, "femaleCount": 494874, "householdCount": 238616},
  "dateRoadblockStart": "...", "dateRoadblockEndEstimated": "...", "dateRoadblockEnd": "..." }
```

Status enum `OPEN / PARTIAL_OPEN / CLOSED`, with photos, a **named engineer and phone number**, estimated *vs* actual repair time, and how many households are cut off. This replaces your invented `get_safest_route` with something real — and "estimated 1 hour, actual 4 hours" is a genuine accountability metric sitting in plain sight.

**`/api/v1/resource/` — where people can go.** Confirmed `resourceType` vocabulary from `/enum-choice/`:
`health · education · evacuation centre · open space · community space · helipad · fire engine · fire fighting apparatus · bridge · roadway · waterway · water supply · sanitation · electricity · communication · finance · governance · industry · energy · cultural · hotel and restaurant`

Caveat: the `resourceType` filter is **broken server-side** — pull all and bucket client-side.

### 1.2 Supporting routes worth using

| Route | What it gives you |
|---|---|
| `/citizen-report/` | crowd-sourced unverified public reports — `verified: false`, hazard, ward, point |
| `/event/` | named multi-incident events (groups incidents into one disaster) |
| `/situation-report/` | narrative sitreps tied to events, HTML narration, date range |
| `/alert/` | alerts, `source: dhm / nsc / icimod / doe / dor` |
| `/earthquake/` | full historical quake catalogue, magnitude + location |
| `/rain/`, `/rain-trimed/` | rainfall gauges, 1/3/6/12/24h averages w/ warning flags |
| `/flood-station/` | forecast station master; some records start **1962**, `valid_glofas` flag |
| `/district/`, `/municipality/`, `/ward/`, `/province/` | full admin hierarchy, EN **and** NE names, bbox, centroid |
| `/hazard/` | 47 hazard types, EN + NE, natural vs non-natural |
| `/enum-choice/` | dictionary of every enum in the API — read this first |
| `/vizrisk-household/`, `/demographic/`, `/vulnerability/` | census-linked vulnerability layers, 2011 & 2021 |
| `/inventory*`, `/relief-flow/`, `/relief-release*` | warehouse stock and relief release tracking |

### 1.3 External, verified

- **GDACS** — `geteventlist/SEARCH?eventlist=FL,EQ,TC,DR&country=Nepal&fromDate=2015-01-01&toDate=2026-08-30` returns **17 events, 2015→today** in one call, including the live Orange flood (event `1104124`, GLIDE `FL-2026-000167-NPL`) and the 2015 M7.8 Gorkha quake. Free, CC BY 4.0. Also serves ready-made **CAP v1.2 XML** per event.
- **Open-Meteo Flood API** — GloFAS river discharge forecast, no key. Gives you *tomorrow*, which BIPAD doesn't.
- **OSM / Overpass** — hospitals, bridges, shelters.

### 1.4 The hard limits — build around these

- **No aggregation endpoint exists.** No `/summary/`, `/statistics/`, `/dashboard/`. Every total you show must be computed client-side.
- **`count` is always `9223372036854775807`** (int64 max). Useless. Page or offset-probe.
- Ordering works on `/incident/` and `/earthquake/`, **not** on `/river/`.
- Undocumented, no licence, no SLA, built by Youth Innovation Lab. **Cache a snapshot** so a judge watching your video isn't at the mercy of their uptime.

---

## Part 2 — What to show

Four views. Each one answers questions no existing interface answers.

### View 1 — Ask Nepal's disaster record anything
The centrepiece. A natural-language query box over 11 years and 60k+ incidents, where the agent composes the API call and renders the result as map + chart + table.

Questions it can genuinely answer today:
- *"How many people have died in floods in Sindhupalchok since 2015, by year?"*
- *"Which districts lose the most bridges to monsoon flooding?"*
- *"Compare landslide deaths in the 3 months after the 2015 earthquake to the same months in 2014."*
- *"Show me every incident within 20 km of Dhunche in the last week."*
- *"Which municipalities have flood incidents but no registered evacuation centre?"* ← two datasets joined, a real gap-finding question

That last class is the interesting one: **questions that expose absences.** No dashboard does that.

### View 2 — Live basin watch
Every gauge as a dot, coloured by `waterLevel` against its own `warningLevel`/`dangerLevel`, arrow for `steady`. Overlay `/highway/` roadblocks and GDACS alert polygons. Click a gauge → its 30-day `/river-trimed/` series with threshold lines, plus the Open-Meteo forecast discharge for the same point. **Observed past and forecast future on one axis.**

### View 3 — Roads & access
`/highway/` as a live table + map. Sortable by households cut off. Show `repairEta` vs `actualRepairTime` — the delta is a story. Each row has a real DoR engineer's name and number.

### View 4 — Your place
Enter a district or drop a pin. Get: nearest gauge and current level vs threshold, nearest evacuation centre / open space / helipad / health facility, roads currently closed between you and the district HQ, and this location's incident history. Every field real, every field sourced.

**Language:** every incident, hazard, district and municipality ships with a Nepali name (`titleNe`, `title_ne`). A genuinely bilingual interface costs you almost nothing here and matters enormously for who this is actually for.

---

## Part 3 — What people can actually do

I filtered hard for actions that are **real, verifiable, and deep-linkable.** Ranked by impact per minute.

### ⭐ Action 1 — Map the flood zone (anyone, worldwide, 15 min, genuinely useful)

HOT + NAXA + **NDRRMA** launched an official Tasking Manager campaign on **27 Aug 2026** for this exact flood. Hashtag `#nepal-flood-2026-trisuli-bhotekoshi`, campaign **"2026 Nepal Floods"**, covering Rasuwa, Nuwakot, Dhading, Gorkha.

- Campaign: `https://tasks.hotosm.org/explore?campaign=2026%20Nepal%20Floods`
- A live project: `https://tasks.hotosm.org/projects/62970`
- Official activation record: `https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Nepal_Floods_2026`
- Live contributor stats: ohsomeNow dashboard, filtered by that hashtag
- Daily OSM export for the disaster area: `https://data.humdata.org/dataset/hot_flood_npl`

Volunteers trace buildings, roads and bridges from post-flood imagery. Responders use that to route into villages with no prior map coverage and to count structures per settlement for relief planning. This is not feel-good busywork — it's the input to the same road network your app queries.

**Why this closes the loop beautifully:** your app *consumes* OSM data for routing and facilities. The CTA is *"the map you just used is incomplete here — fix it."* An agent can identify which flood-affected municipality has the thinnest OSM building coverage and deep-link the user into the matching task. That's a human-agent collaboration that produces a real artifact in a real database.

⚠️ **Verify before building:** `tasks.hotosm.org/api/v2/*` returned empty from the research sandbox (likely bot protection on `/api/` — the site root and other JSON APIs loaded fine). Test it from your own browser/server before depending on the REST API. Deep-linking to `/projects/{id}` works regardless.

### ⭐ Action 2 — Donate to a verified channel (anyone, 2 min)

All verified live 30 Aug 2026:

| Channel | URL | Note |
|---|---|---|
| **IFRC Emergency Appeal MDRNP022** | `https://donate.redcrossredcrescent.org/ifrc/nepal-flash-floods/` | CHF 25M appeal, funds route to Nepal Red Cross |
| **Nepal Red Cross Society** | `https://donation.nrcs.org/` | direct, accepts NPR/USD via Khalti/eSewa/ConnectIPS |
| **PM Disaster Relief Fund** | `https://opmcm.gov.np/content/586/heartfelt-appeal/` · intl: `https://pmdrf.nchl.com.np/` | official government appeal |
| **GlobalGiving Nepal Flood Relief** | `https://www.globalgiving.org/projects/nepal-flood-relief-fund/` | Charity Navigator 4-star; $301K of $1.5M at time of check |
| **UNICEF Nepal Flash Flood Appeal** | `https://www.unicef.org.au/donate/nepal-flash-flood-appeal-2026` | |

Build a **scam warning** into this panel. The Kathmandu Post explicitly flagged fundraising fraud in the first 48–72 hours of this event. An app that says "here are five verified channels, and here's how to spot a fake" is doing real work.

### ⭐ Action 3 — File a citizen report (people in Nepal)

`/api/v1/citizen-report/` exists and holds unverified public reports with `hazard`, `ward`, `point`. **I confirmed the route reads; I did not confirm it accepts public POSTs** — check that before promising it.

The confirmed reporting chain today is a phone call: **100** Police (**112** from mobile if busy) · **102** ambulance · **1149** National Emergency Operation Centre · **1155** DHM/Ncell flood-alert short code. Surface these prominently and let the agent hand over the right one for the situation.

### Action 4 — Adopt a gauge

Pick a station, get notified when it crosses `warningLevel`. Purely client-side, no permission needed, and it makes the abstract data personal. Nepal has no public self-service flood-alert subscription — DHM/Ncell alerts are pushed to at-risk areas automatically, and ICIMOD's CBFEWS is village-level. **This is a genuine gap you can partially fill,** as long as you're explicit that it's a convenience layer over public data and not an official warning service.

### Action 5 — Share a proper alert

Generate a real **CAP v1.2** alert from a live gauge crossing, with correct `urgency`/`severity`/`certainty`/`responseType`/`areaDesc`. Cross-check your output against GDACS's own CAP XML for the same event. Shareable, standards-compliant, and it teaches the format.

### Honest gaps — say these out loud

Research turned up things that *should* exist and don't. Naming them is stronger than faking them:
- No public self-service flood-warning subscription for citizens.
- No confirmed public web form to report an incident into BIPAD.
- No aggregate/statistics endpoint — Nepal's own disaster data can't be summarised without scraping it yourself.
- No published licence or documentation on an API that serves national disaster data.
- Unskilled international volunteers are **not** wanted on the ground (per Project HOPE and standard humanitarian guidance) — only accredited medical, WASH, structural, SAR and geospatial specialists. Say so; it's the responsible thing and it redirects goodwill to mapping and cash.

---

## Part 4 — The new WebMCP tool set

Retire: `dispatch_relief`, `broadcast_safety_message`, `explain_dispatch_decision` — all simulated authority.

| Tool | Backed by | Real? |
|---|---|---|
| `query_incidents` | `/incident/?hazard&district&incident_on__gt&expand=loss` | ✅ live |
| `get_casualty_breakdown` | `loss` object — by sex, disability, families evacuated | ✅ live |
| `get_river_status` | `/river/?water_level_on__gt` + `/river-trimed/` | ✅ live |
| `get_flood_forecast` | Open-Meteo GloFAS discharge | ✅ live |
| `get_road_closures` | `/highway/` — status, ETA, households cut off, contact | ✅ live |
| `find_nearby_resources` | `/resource/` — evacuation centre, health, helipad, open space | ✅ live |
| `get_global_alert_status` | GDACS event + CAP XML | ✅ live |
| `find_mapping_task` | HOT TM campaign, deep-link to project | ✅ (verify API) |
| `get_verified_donation_channels` | curated, verified list | ✅ |
| `compose_cap_alert` | CAP v1.2 from live gauge data | ✅ |

Read tools query real government data. Write tools produce artifacts the user actually owns — an OSM edit, a donation, a CAP alert, a saved watch. **Nothing pretends to command anyone.**

That's a better answer to *"what can people and agents do together that was difficult before"* than a fake dispatch button: **an agent that can interrogate a decade of national disaster records in one sentence, and then hand you something real to do about it.**

---

## Sources

- [BIPAD API root](https://bipadportal.gov.np/api/v1/) · [BIPAD Portal](https://bipadportal.gov.np/) · [NDRRMA](https://ndrrma.gov.np/en) · [NEOC](https://neoc.gov.np/) · [DoR Navigate](https://navigate.dor.gov.np/)
- [GDACS](https://www.gdacs.org/) · [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api) · [Overpass API](https://overpass-api.de/)
- [HOT Tasking Manager — 2026 Nepal Floods](https://tasks.hotosm.org/explore?campaign=2026%20Nepal%20Floods) · [OSM activation record](https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Nepal_Floods_2026) · [HOT flood export on HDX](https://data.humdata.org/dataset/hot_flood_npl) · [LearnOSM](https://learnosm.org/) · [MapSwipe](https://mapswipe.org/en/)
- [IFRC Nepal Flash Floods 2026 appeal](https://www.ifrc.org/emergency/nepal-flash-floods-2026) · [IFRC donate](https://donate.redcrossredcrescent.org/ifrc/nepal-flash-floods/) · [Nepal Red Cross donate](https://donation.nrcs.org/) · [PM Disaster Relief Fund appeal](https://opmcm.gov.np/content/586/heartfelt-appeal/) · [GlobalGiving Nepal Flood Relief](https://www.globalgiving.org/projects/nepal-flood-relief-fund/) · [UNICEF appeal](https://www.unicef.org.au/donate/nepal-flash-flood-appeal-2026)
- [OASIS CAP v1.2](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html)
