# Nepal Disaster Watch · नेपाल विपद् वाच

> 🚨 **WebMCP Hackathon Submission**: The primary live project is in [`public/`](public/).
> - **Live Deployed App**: [https://asmibasnet.github.io/webMCP/](https://asmibasnet.github.io/webMCP/)
> - **Video Demo (YouTube)**: [https://youtu.be/_hlxLnZ7Lgs](https://youtu.be/_hlxLnZ7Lgs)
> - **Local Run**: `npm run serve` (Serves `public/` at `http://127.0.0.1:8787/`)
> - **Deploy Command**: `npm run deploy` (`npx wrangler pages deploy ./public`)
> - **Automated Test Suites**: `npm run test:webmcp` (55 tests) · `npm run test:dash` · `npm run test:offline`

---

## Overview

**Nepal Disaster Watch** helps Nepal disaster responders investigate what is happening in a district when critical evidence is scattered across incident reports, river gauges, road closures, forecasts, alerts, and satellite assessments. 

WebMCP lets an agent query and cross-reference that evidence through declared tools, then update the same map, filters, and drill-downs a human is viewing—making uncertainty and source freshness visible rather than hidden.

People and agents can investigate a district together without agents guessing through UI controls or silently misreading stale data.

---

## The Standout Story: Finding What Dashboards Hide

In an active disaster, **an absence of incident reports does not mean an absence of catastrophe**—it usually means communication lines and roads are cut. A static dashboard displays "0 incidents" and looks deceptively calm.

### The Decisive Investigation Workflow (Rasuwa District):
1. **The Problem**: Disaster evidence in Nepal is fragmented across six distinct institutional silos (NDRRMA, DHM Hydrology, Department of Roads, UN GDACS, GloFAS Forecasts, and Copernicus EMS Satellite Mapping).
2. **The Agent Query**: The responder asks the agent to investigate Rasuwa district via `cross_reference_district(district: "Rasuwa")`.
3. **The Conflict Uncovered**:
   - **Copernicus Orbital Satellite Grading**: **864 of 1,000 surveyed buildings** graded as damaged or destroyed across Timure (98%) and Syapru Besi (77%).
   - **BIPAD Ground Incidents**: Only **1 official incident** filed for the same period.
   - **Department of Roads**: Pasang Lhamu Highway **blocked by debris**, cutting off 7,025 households.
   - **DHM River Gauges**: High discharge warning on Bhote Koshi.
4. **The Divergence**: The agent identifies that the district reporting pipeline was severed because road access and power grids collapsed, preventing ground officers from filing forms.
5. **Shared Synchronous Control**: The agent calls `filter_records` and `focus_map`, immediately panning the responder's Leaflet map to the damage cluster, opening the detail panel, and highlighting the blocked road segment on the user's screen.
6. **Honest Source Health**: Through `get_source_health`, the agent reports exact freshness and snapshot provenance, ensuring no responder mistakes an offline or lagging feed for safety.

---

## Six Public Data Sources

The platform normalises six public sources with live status and snapshot provenance into one unified record type:

| Source | Origin / Agency | Live Telemetry & Normalisation | Cadence | Status & Provenance |
|---|---|---|---|---|
| **Incidents** | NDRRMA / BIPAD | `/api/v1/incident/?expand=loss` | As filed | Live (CORS enabled) |
| **Gauges** | DHM via BIPAD | `/api/v1/river/?ordering=-water_level_on` | Every 10 min (~167 stations) | Live (CORS enabled) |
| **Roads** | Dept. of Roads / BIPAD | `/api/v1/highway/` | Realtime division updates | Live (CORS enabled) |
| **Alerts** | GDACS / EC JRC & BIPAD | `events/geteventlist/SEARCH` + `/api/v1/alert/` | Per episode / ongoing | Live (CORS enabled) |
| **Forecast** | Copernicus GloFAS / Open-Meteo | `v1/flood` (Bhote Koshi, Trishuli, Narayani) | Daily 7-day projection | Live (CORS enabled) |
| **Damage** | NDRRMA Ground Surveys & Copernicus EMS | BIPAD ground loss surveys + Copernicus EMSR927 | Per survey & satellite pass | Live ground loss + satellite snapshot provenance |

### Source Health & Degradation Honesty
- **No Silent Fallback**: The UI status bar and WebMCP `get_source_health` report whether each feed is `live`, `unreachable`, or `serving snapshot`.
- **Fault-Tolerant Fetching**: A temporary outage on one upstream never crashes the feed. Healthy feeds continue rendering in real time while degraded sources display explicit warning indicators.

---

## WebMCP Architecture & Tool Registry

Nepal Disaster Watch exposes **11 native client-side WebMCP tools** via `document.modelContext.registerTool()`. When loaded in a WebMCP-capable browser (Chrome 149+ or with `#enable-webmcp-testing`), tools are registered directly on the browser's model context. For other environments, a standards-compliant polyfill shim enables testing via DevTools and Playwright.

```
                  ┌────────────────────────────────────────┐
                  │    Agent (Claude / Gemini / GPT)       │
                  └───────────────────┬────────────────────┘
                                      │ WebMCP Protocol
                                      ▼
                  ┌────────────────────────────────────────┐
                  │     document.modelContext Registry     │
                  └─────────┬────────────────────┬─────────┘
                            │                    │
                 Read Tools │                    │ Write Tools
                            ▼                    ▼
             ┌──────────────────────┐    ┌──────────────────────┐
             │ cross_reference_...  │    │ filter_records()     │
             │ get_situation_...    │    │ select_record()      │
             │ get_source_health()  │    │ focus_map()          │
             │ get_record_details() │    │ reset_view()         │
             │ list_records()       │    │ refresh_data()       │
             │ list_filter_options()│    └──────────┬───────────┘
             └──────────┬───────────┘               │
                        │                           │ Mutates state.filters &
                        │ Queries in-memory state   │ re-renders DOM synchronously
                        ▼                           ▼
             ┌──────────────────────────────────────────────────┐
             │       Shared Dashboard State & Leaflet Map       │
             └──────────────────────────────────────────────────┘
```

### Registered WebMCP Tools:

| Tool | Mode | Description |
|---|---|---|
| `cross_reference_district` | **Read** | **The Standout Tool**: Side-by-side evidence synthesis for any of Nepal's 77 districts, detecting discrepancies between satellite damage, ground reports, gauges, and road closures. |
| `get_situation_summary` | Read | High-level national disaster summary: casualties, severe events, damaged buildings, and source status. |
| `get_source_health` | Read | Detailed health, freshness, and snapshot status for all six data feeds. |
| `list_records` | Read | Ranked list of disaster records in the active window matching filters. |
| `get_record_details` | Read | Complete attributes, metrics, provenance, and verbatim raw payload for a specific record ID. |
| `list_filter_options` | Read | Valid district names, hazard types, and severities available in the loaded dataset. |
| `filter_records` | **Write** | Updates the dashboard filters (sources, severities, window, district, type, search, sort) and re-renders the screen. |
| `select_record` | **Write** | Opens the drill-down panel for a record and centers the Leaflet map on its coordinates. |
| `focus_map` | **Write** | Controls map navigation (pan to district, coordinates, set zoom, or show entire country). |
| `reset_view` | **Write** | Restores all filters, window, and map view to default state. |
| `refresh_data` | **Write** | Triggers an immediate refetch across all data sources and updates the interface. |

---

## Repository Structure

```
public/               <-- THE SUBMITTED LIVELY-DEPLOYED WEBMCP APPLICATION
  index.html          Modern Devpost-styled responsive dashboard
  dash.css            Clean design system with light/dark high-contrast tokens
  data/
    refdata.json      Administrative hierarchy (77 districts, 753 municipalities)
    snapshot/         Offline snapshots for zero-network resilience
  js/
    config.js         API endpoints, telemetry configuration, and metadata
    api.js            Network resilience layer, memoization, and snapshot fallback
    feed.js           Multi-source normalizer, severity derivation, and filtering
    dash.js           Reactive UI controller, Leaflet map binding, and refresh cycle
    webmcp.js         The 11 WebMCP tool definitions and execution bridges
scripts/
  dash-test.mjs       Playwright test suite for dashboard UI, filters, and mobile
  webmcp-test.mjs     Playwright test suite executing all 11 WebMCP tools (55 passed)
  offline-test.mjs    Zero-network degradation and offline snapshot verification
  build-refdata.mjs   Builds administrative reference hierarchy
  build-snapshot.mjs  Fetches and serializes upstream snapshots
worker.js             Optional Cloudflare Worker CORS proxy
```

> **Note on root files**: Root files (`app.js`, `agent.js`, root `index.html`) contain the early standalone command-center prototype preserved for historical reference (documented in [`docs/07-command-center-prototype.md`](docs/07-command-center-prototype.md)). The active, submitted WebMCP production application is housed in [`public/`](public/).

---

## Local Setup & Testing

### 1. Run Locally
```bash
# Install dependencies (Playwright for testing)
npm install

# Start local server on port 8787
npm run serve
```
Open **`http://127.0.0.1:8787/`** in your browser.

### 2. Run Test Suites
```bash
# Run WebMCP tool verification suite (55 assertions)
npm run test:webmcp

# Run Dashboard interaction & degradation suite
npm run test:dash

# Run Complete offline / zero-upstream fallback suite
npm run test:offline
```

### 3. Deploy
```bash
# Deploy public/ directory to Cloudflare Pages
npm run deploy
```

---

## Attribution & Data Disclaimers

- **Government of Nepal**: Disaster incidents, ground loss surveys, river hydrology, and road status are attributed to the National Disaster Risk Reduction and Management Authority (NDRRMA / BIPAD), Department of Hydrology and Meteorology (DHM), and Department of Roads (DoR).
- **International Systems**: GDACS multi-hazard alerts (UN OCHA / EC JRC), GloFAS discharge forecasts (Copernicus Emergency Management Service via Open-Meteo under CC BY 4.0), and Rapid Mapping activation EMSR927 (Copernicus Open Access Policy).
- **Independent Initiative**: Nepal Disaster Watch is an independent open-source project created for the WebMCP developer ecosystem. It normalises and cross-references public domain records. It is not an official warning service and dispatches no emergency services.

**Emergency Hotlines in Nepal**:
- **100** — Nepal Police
- **102** — Emergency Ambulance
- **1234** — District Disaster Hotline
- **1149** — National Emergency Operation Centre (NEOC)
