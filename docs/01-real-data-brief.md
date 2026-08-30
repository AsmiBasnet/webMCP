# SankatSathi — Real Data & Doctrine Brief

**Purpose:** replace SankatSathi's simulated SOS/resource/water-level data with real, live, citable sources, and align the six WebMCP tool schemas with the standards real emergency responders actually use.

**Verified:** 30 August 2026. Every endpoint marked ✅ below was fetched live during this research and returned real data. Endpoints marked ⚠️ are documented but could not be confirmed from the research sandbox (likely WAF/bot filtering, not an outage).

---

## 0. The headline: there is a real flood happening right now

A major flash flood hit **Rasuwa / Bhote Koshi on 26 August 2026**. NDRRMA reports 675+ dead, 1,473 injured, 2,498 missing, 18,700+ rescuers mobilised. The Nepal Army deployed ~2,000 personnel plus helicopters for SAR and airlift.

GDACS has it live as **Orange Flood alert, event ID 1104124, GLIDE `FL-2026-000167-NPL`**, centroid 27.2953 N / 85.3649 E.

This is the single strongest thing you can do for your submission: **demo against the actual event that is unfolding in Nepal this week**, not invented districts. Judges scoring "Potential Impact" will notice.

---

## Part 1 — What real responders use

### 1.1 The two standards your tools should mirror (highest-value change)

Your `broadcast_safety_message` and `dispatch_relief` tools currently have ad-hoc schemas. There are OASIS-ratified, globally deployed standards for exactly these two operations. Adopting their field names costs you an afternoon and makes the project look like infrastructure instead of a demo.

**CAP v1.2 (Common Alerting Protocol)** — powers US IPAWS/WEA, EU-Alert, and Nepal's own alerting pipeline. This is what `broadcast_safety_message` should emit:

| Field | Values |
|---|---|
| `identifier`, `sender`, `sent` | dedup / provenance triple |
| `status` | Actual / Exercise / System / Test / Draft |
| `msgType` | Alert / Update / Cancel / Ack / Error |
| `scope` | Public / Restricted / Private |
| `category` | Geo, Met, Safety, Rescue, Health, Infra, Transport… |
| `responseType` | **Shelter / Evacuate / Prepare / Execute / Monitor** |
| `urgency` | Immediate / Expected / Future / Past / Unknown |
| `severity` | Extreme / Severe / Moderate / Minor / Unknown |
| `certainty` | Observed / Likely / Possible / Unlikely / Unknown |
| `effective`, `onset`, `expires` | timing |
| `headline`, `description`, `instruction` | human text |
| `areaDesc`, `polygon`, `circle`, `geocode` | geofence |

The `urgency × severity × certainty` matrix is the classic warning-decision triad — an agent reasoning over those three fields is far more compelling than one passing a free-text `urgency: "high"`.

Spec: https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html

**EDXL-RM v1.0 (Resource Messaging)** — this is `dispatch_relief`:

| Field | Notes |
|---|---|
| `MessageID`, `SentDateTime` | |
| `MessageContentType` | **"Request Resource" / "Commit Resource" / "Release Resource"** — your dispatch is a *Commit* |
| `IncidentInformation.IncidentID` | ← your `alert_id` |
| `Resource.ResourceID`, `Resource.Name` | |
| `Resource.TypeStructure.Value` | typed vocabulary, not a free string (e.g. "Rescue Boat", "Medical Team") |
| `Resource.ResourceStatus` | |
| `OwnershipInformation.OwningJurisdiction` | ← your `center_id` |
| `AssignmentInformation.Quantity` | ← your `resources` object |
| `AssignmentInformation.AssignmentInstructions` | ← your route + ETA |
| `ScheduleInformation` | ETA belongs here structurally |

Spec: https://docs.oasis-open.org/emergency/edxl-rm/v1.0/cd01/EDXL-RM-SPEC-V1.0.html

Related, if you want to go further: **EDXL-HAVE v2.0** (hospital bed/ED availability — a natural 7th tool), **EDXL-SitRep** (situation reports), **EDXL-DE** (the routing envelope that wraps all of the above).

### 1.2 TAK / ATAK — what the military actually carries

**Team Awareness Kit**, originally Air Force Research Lab, now used by US DoD, National Guard, FEMA, Coast Guard, and civil SAR — credited with 2,000+ rescues in Harvey/Irma/Maria. Open-sourced in 2022 at https://tak.gov and https://github.com/TAK-Product-Center.

Its wire format is **Cursor on Target (CoT)** — terse XML built for tactical radios, three elements:

```xml
<event uid="..." type="a-f-G-U-C" how="m-g" time="..." start="..." stale="...">
  <point lat="27.2953" lon="85.3649" hae="..." ce="..." le="..."/>
  <detail><contact callsign="RESCUE-1"/><remarks>...</remarks></detail>
</event>
```

`type` is hierarchical dot-notation (`a-f-G-U-C` = friendly ground unit), and `stale` is a hard expiry time — a position that isn't refreshed *disappears*. That staleness concept is worth stealing for your dispatch markers.

Web apps can and do speak CoT: **CloudTAK** (Node/TS) exposes a REST API for CoT injection plus a browser map client; **FreeTAKServer** (Python) and **OpenTAKServer** are open-source servers. A credible line in your submission: *"dispatch markers are emitted as Cursor-on-Target events, so SankatSathi can federate into an ATAK/WinTAK common operating picture."*

### 1.3 WebEOC (Juvare)

The proprietary incident-management platform most US state EOCs run. Organised around configurable **boards** — Incidents, Significant Events, Situation Reports, and critically the **Requests/Tasks** board and the **RID module** (Requests, Inventory, Deployment). Requests move through submitted → assigned → in progress → closed, routed to a *position/role*, not a person. Your SOS status field should follow that lifecycle rather than a binary pending/resolved.

Docs: https://confluence.juvare.com/spaces/PKC/pages/13448020/Standard+WebEOC+Boards

### 1.4 The coordination doctrine (cite this, it's cheap credibility)

- **Oslo Guidelines** — when/how foreign military assets deploy for disaster relief; principle of last resort, host-nation consent. https://www.unocha.org/publications/report/world/oslo-guidelines-guidelines-use-foreign-military-and-civil-defence-assets-disaster-relief-revision-11-november-2007
- **UN-CMCoord Handbook v2.1 (2025)** — civil-military coordination. https://www.unocha.org/civil-military-coordination
- **LEMA** (Local Emergency Management Authority) — the host nation retains command; international teams work *under* it. In Nepal that is NDRRMA.
- **INSARAG Guidelines** — USAR coordination, OSOCC/RDC, and the Annex B26 team-marking/victim-triage system. https://insarag.org/guidance-notes/guidelines-annex/

### 1.5 Nepal's actual command chain

- **NDRRMA** — national apex authority under the DRRM Act 2017. Coordinates and *authorises*. https://ndrrma.gov.np/en
- **NEOC** + 7 provincial EOCs + 70 district EOCs — the 24/7 operations layer.
- **Nepal Army** — the execution arm: SAR, helicopter airlift, logistics. In Rasuwa it moved 100+ relief packages into Dhunche and handed them to NDRRMA/PMO for distribution.
- **Nepal Police** — primary incident reporting; police reports flow into BIPAD (you can see `"source": "nepal_police"` on incident records).

**The two live government systems you should know about:**
- **BIPAD Portal** — NDRRMA's multi-hazard information and early-warning platform. https://bipadportal.gov.np — *and it has an open API (see Part 2).*
- **Setu Rapid** — NDRRMA's rescue/duty coordination command centre linking responders, fleet and command. https://setu.ndrrma.gov.np — this is, essentially, the government's version of what you built. Worth naming in your submission as the system you're proposing to make agent-operable.

### 1.6 Open-source prior art

- **Sahana Eden** (https://github.com/sahana/eden) — the reference data model. Tables worth copying: `event_incident`, `cr_shelter` (location + capacity + population breakdown), `hms_hospital`, `inv_*` / `req_req` (request → item → quantity → fulfilling org), `msg_*`. It even ships a native CAP module (`modules/s3db/cap.py`).
- **Ushahidi** (https://docs.ushahidi.com) — crowdsourced incident reporting; models a `Post` with dynamic form `values`. Good reference for citizen SOS intake, but it has no dispatch model.

---

## Part 2 — Real data you can plug in today

### 2.1 ⭐ BIPAD API — the big find. Live, no auth, exactly your schema. ✅

`https://bipadportal.gov.np/api/v1/` is an undocumented but fully open Django REST API. No key. JSON. This is NDRRMA republishing DHM's hydrology data — which means **`hydrology.gov.np` data without reverse-engineering hydrology.gov.np**.

**Gotcha that will cost you an hour if you miss it:** the default listing is *oldest-first* and the archive goes back years, so a naive `GET /river/` returns August **2025** data and looks dead. You must pass a date filter. Also `count` returns a bogus int64 max, and `ordering=` is ignored.

#### `/api/v1/river/` — river gauge stations ✅

```
https://bipadportal.gov.np/api/v1/river/?limit=500&water_level_on__gt=2026-08-29T00:00:00%2B05:45
```

Verified live response:

```json
{
  "id": 25005055,
  "title": "Imja River at Dingboche",
  "basin": "Koshi",
  "point": { "type": "Point", "coordinates": [86.838542, 27.895069] },
  "waterLevel": 0.459,
  "warningLevel": 3.5,
  "dangerLevel": null,
  "waterLevelOn": "2026-08-29T00:00:00+05:45",
  "status": "BELOW WARNING LEVEL",
  "steady": "STEADY",
  "elevation": 4375,
  "district": 11, "municipality": 11003, "ward": 1732, "province": 1,
  "dataSource": "hydrology.gov.np",
  "image": "http://daq.hydrology.gov.np/images/6fa9a072..."
}
```

This maps **directly** onto your invented fields:

| Your mock field | Real BIPAD field |
|---|---|
| `water_level_m` | `waterLevel` (metres) |
| `severity` | derive from `waterLevel` vs `warningLevel` / `dangerLevel` |
| — (new) | `steady`: `RISING` / `STEADY` / `FALLING` ← a trend an agent can reason about |
| `district` | `district` code → resolve via `/api/v1/district/` |
| — (new) | `status`: `"BELOW WARNING LEVEL"` etc., pre-computed by DHM |

Note: `basin=` as a query param is **ignored** — filter by basin client-side on the `basin` string (`"Koshi"`, `"Bagmati"`, `"Mahakali"`, `"West Rapti"`, `"Karnali"`, `"Mohana"`).

The `steady: "RISING"` field is a gift. `get_active_sos_alerts` becomes far more interesting when the agent can say *"Rangsing Khola is RISING and 3.7 m from warning — dispatch before the road floods."*

#### Other confirmed endpoints ✅

| Endpoint | Contents |
|---|---|
| `/api/v1/rain/` | rainfall stations, `averages` for 1/3/6/12/24h with warning/danger booleans |
| `/api/v1/incident/` | real disaster incidents — filter `?hazard=11` (Flood), `?hazard=17` (Landslide), `&incident_on__gt=2026-08-01` |
| `/api/v1/hazard/` | lookup of all 44 hazard types, bilingual EN/NE |
| `/api/v1/resource/` | preparedness inventory (health posts etc.) by `resourceType` + point + ward |
| `/api/v1/district/`, `/api/v1/municipality/` | admin boundaries, bbox, centroid, EN + NE names, parent linkage |

Verified incident response — note it comes with **Nepali titles already**:

```json
{
  "id": 92478,
  "title": "Flood at Chhalgard, Shey Phoksundo Rural Municipality-99",
  "titleNe": "कर्णाली, डोल्पा, शे फोक्सुण्डो-९९ मा बाढी",
  "point": { "type": "Point", "coordinates": [83.03833, 29.21277] },
  "incidentOn": "2026-08-02T00:00:00+05:45",
  "hazard": 11, "loss": 468379,
  "verified": true, "approved": true,
  "dataSource": "drr_api"
}
```

`titleNe` means your Nepali-language UI can be real rather than translated. And `verified`/`approved` give you an authentic triage state — an agent that respects "don't dispatch on unverified reports" is a genuinely good demo.

**Caveats to state honestly:** undocumented, no published licence, no SLA, built by Youth Innovation Lab, no public source repo. Cache a snapshot locally so your demo can't be broken by their downtime.

### 2.2 ⭐ GDACS — live global alerts, no key ✅

```
https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&fromDate=2026-08-01&toDate=2026-08-30
```

Returns GeoJSON. Verified live, right now, for the current Nepal event:

```json
{
  "eventtype": "FL", "eventid": 1104124, "episodeid": 1,
  "glide": "FL-2026-000167-NPL",
  "name": "Flood in Nepal",
  "alertlevel": "Orange", "alertscore": 2,
  "country": "Nepal", "iso3": "NPL",
  "source": "GLOFAS",
  "fromdate": "2026-08-26T01:00:00", "todate": "2026-08-28T01:00:00",
  "iscurrent": "true"
}
```

Companion endpoints:
- Flood extent polygon: `/gdacsapi/api/polygons/getgeometry?eventtype=FL&eventid=1104124&episodeid=1`
- Event detail: `/gdacsapi/api/events/geteventdata?eventtype=FL&eventid=1104124`
- **Ready-made CAP XML**: `https://www.gdacs.org/contentdata/resources/FL/1104124/cap_1104124.xml` — a real CAP v1.2 alert you can parse to sanity-check your own CAP output.
- RSS/GeoRSS: `https://www.gdacs.org/xml/rss.xml` (the RSS item for this event carries `<gdacs:population>527 deaths</gdacs:population>`)

Licence CC BY 4.0, attribution required. `source: "GLOFAS"` — GDACS flood alerts are pre-digested Copernicus GloFAS, so this is free GloFAS without the CDS pipeline.

### 2.3 Open-Meteo Flood API — forecast discharge, no key ⚠️

```
https://flood-api.open-meteo.com/v1/flood?latitude=26.8&longitude=87.15&daily=river_discharge&forecast_days=7
```

GloFAS v4 river discharge (m³/s), 5 km resolution, 30-day forecast + 7-month seasonal + 1984–2022 reanalysis. **No API key** for non-commercial use. CC BY 4.0. Response shape:

```json
{"daily_units":{"river_discharge":"m³/s"},
 "daily":{"time":["2026-08-30",...],"river_discharge":[1234.5,...]}}
```

Documented at https://open-meteo.com/en/docs/flood-api. Could not fetch a live body from the research sandbox (WAF), so **test it from your machine before you build on it** — but this is the single best zero-friction source for *forecast* (as opposed to current) conditions, which is what makes proactive dispatch defensible.

### 2.4 Geography, hospitals, roads

- **Admin boundaries:** BIPAD's own `/district/` + `/municipality/` (already in your stack, already carries Nepali names). Lightweight fallback: https://github.com/Acesmndr/nepal-geojson (MIT, ~600 KB, 77 districts + 7 provinces).
- **Hospitals / roads / bridges / shelters:** OpenStreetMap via Overpass API.

```
[out:json][timeout:25];
area["ISO3166-1"="NP"][admin_level=2]->.np;
(
  node["amenity"="hospital"](area.np);
  way["amenity"="hospital"](area.np);
);
out center;
```

Swap `amenity=hospital` for `highway=*` (roads), `bridge=yes`, `amenity=shelter`, `emergency=assembly_point`. Overpass query execution was blocked from the research sandbox but works normally from a browser/dev machine.

**This is the fix for `get_safest_route`.** Right now it returns invented routes. Real version: OSM road graph + BIPAD gauge points → flag any route segment crossing a bridge within N km downstream of a station reading above `warningLevel`. That's a defensible algorithm rather than a lookup table, and it directly answers the "genuine, non-trivial implementation" judging criterion.

### 2.5 Secondary / context sources

| Source | Access | Use |
|---|---|---|
| HDX CKAN — `data.humdata.org/api/3/action/package_search?q=nepal+floods` | no key ⚠️ | Nepal shapefiles, COD-AB boundaries |
| HDX HAPI — `hapi.humdata.org/api/v1/...?location_code=NPL` | self-serve instant `app_identifier`, no review ⚠️ | population, 3W operational presence |
| ReliefWeb — `api.reliefweb.int/v2/reports?appname=X` | **appname must be pre-approved since Nov 2025** — apply day 1 | live Rasuwa situation reports |
| NASA Worldview / GIBS tiles | no login | satellite basemap overlay |
| NASA GPM IMERG | free Earthdata login, instant | rainfall raster |
| Copernicus EMS Rapid Mapping | free browse/download | published flood-extent products |
| DRR Portal — `drrportal.gov.np` | HTML scrape only, no API | historical incident totals; 1 NEOC / 7 provincial / 70 district EOCs |
| EM-DAT — `public.emdat.be` | free w/ registration | historical loss baseline |
| Logistics Cluster / UNHRD | PDFs only | deprioritise |

---

## Part 3 — What to actually change, ranked

**1. Swap `get_active_sos_alerts` water levels for BIPAD `/river/`.** Highest impact per hour. Real gauge readings, real warning/danger thresholds, real `RISING`/`FALLING` trend, real district codes. One fetch call.

**2. Seed the SOS queue from BIPAD `/incident/?hazard=11`.** Real flood incidents with Nepali titles and `verified`/`approved` flags. Keep your synthetic *people/children/elderly* detail on top — that's operator-entered data that legitimately wouldn't be in a public feed — but anchor each SOS to a real incident ID and location.

**3. Reshape `broadcast_safety_message` to CAP v1.2 fields.** Cheap, and it turns a toy into an interoperable one. Emit real CAP XML in the telemetry console.

**4. Reshape `dispatch_relief` to EDXL-RM fields.** `MessageContentType: "Commit Resource"`, typed `TypeStructure.Value`, `Quantity`, `OwningJurisdiction`, `AssignmentInstructions`.

**5. Make `get_safest_route` compute rather than lookup.** OSM road graph + live gauge readings. This is your "non-trivial implementation" evidence.

**6. Demo against Rasuwa/Bhote Koshi, 26 Aug 2026.** Pull GDACS event 1104124 live in the video. Nothing beats a judge watching real data land.

**7. Optional but strong:** add a 7th tool `get_hospital_availability` shaped on EDXL-HAVE, backed by OSM `amenity=hospital` + BIPAD `/resource/` health posts.

### Honesty note

Keep Simulation Mode. Real feeds give you real water levels, real incidents, real alerts — they do **not** give you a live queue of stranded citizens or a real boat inventory, because no such public feed exists. Say that explicitly in your submission: *"hydrology, incidents and alerts are live government/EU feeds; citizen SOS payloads and depot inventories are simulated because they are operationally sensitive and not publicly exposed."* Judges reward that. Overclaiming is the thing that gets caught.

---

## Sources

- [BIPAD Portal (NDRRMA)](https://bipadportal.gov.np/) · [BIPAD public site](https://www.bipad.gov.np/) · [Setu Rapid (NDRRMA)](https://setu.ndrrma.gov.np/) · [NDRRMA](https://ndrrma.gov.np/en) · [Nepal DRR Portal](https://drrportal.gov.np/)
- [GDACS](https://www.gdacs.org/) · [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api) · [DHM Nepal Hydrology](https://hydrology.gov.np/)
- [OASIS CAP v1.2](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html) · [OASIS EDXL-RM v1.0](https://docs.oasis-open.org/emergency/edxl-rm/v1.0/cd01/EDXL-RM-SPEC-V1.0.html) · [EDXL-HAVE v2.0](https://docs.oasis-open.org/emergency/edxl-have/v2.0/edxl-have-v2.0.html) · [EDXL-DE v2.0](https://docs.oasis-open.org/emergency/edxl-de/v2.0/edxl-de-v2.0.html)
- [TAK Product Center](https://tak.gov) · [ATAK-CIV source](https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV) · [FreeTAKServer](https://github.com/FreeTAKTeam/FreeTakServer)
- [WebEOC standard boards](https://confluence.juvare.com/spaces/PKC/pages/13448020/Standard+WebEOC+Boards)
- [Oslo Guidelines](https://www.unocha.org/publications/report/world/oslo-guidelines-guidelines-use-foreign-military-and-civil-defence-assets-disaster-relief-revision-11-november-2007) · [UN-CMCoord](https://www.unocha.org/civil-military-coordination) · [INSARAG Guidelines](https://insarag.org/guidance-notes/guidelines-annex/)
- [Sahana Eden](https://github.com/sahana/eden) · [Ushahidi API docs](https://docs.ushahidi.com/) · [nepal-geojson](https://github.com/Acesmndr/nepal-geojson) · [Overpass API](https://overpass-api.de/)
- [HDX](https://data.humdata.org/) · [HDX HAPI docs](https://hdx-hapi.readthedocs.io/) · [ReliefWeb API changes](https://reliefweb.int/blogpost/upcoming-changes-reliefweb-api-what-you-need-know) · [Copernicus EMS Mapping](https://mapping.emergency.copernicus.eu/)
- [2026 Nepal floods](https://en.wikipedia.org/wiki/2026_Nepal_floods) · [UNDP Nepal floods 2026](https://www.undp.org/asia-pacific/nepal-floods-2026)
