# Nepal Disaster Watch — Documentation

Research and design docs for **Nepal Disaster Watch** (नेपाल विपद् वाच), a WebMCP-enabled interface to Nepal's public disaster record.

> **BIPAD collects it. Nepal Disaster Watch makes it answerable.**

Submission for the [WebMCP Challenge](https://webmcp.devpost.com/) (OpenAI / Devpost, 2026).

---

## Contents

| # | Doc | What's in it |
|---|---|---|
| 01 | [Real Data Brief](01-real-data-brief.md) | What real responders use — TAK/CoT, WebEOC, OASIS CAP & EDXL-RM, INSARAG, Nepal's NDRRMA/NEOC command chain. Plus the first pass at live data sources. |
| 02 | [Data · Views · Actions](02-data-views-actions.md) | Full inventory of the ~150-route BIPAD API, the four views to build, and the real call-to-action set. |
| 03 | [Product Brief](03-product-brief.md) | Positioning, users, the Ask→See→Act loop, why WebMCP fits, the OSM flywheel, risks, MVP cut, and draft Devpost submission text. |
| 04 | [Deployment & Architecture](04-deployment-and-architecture.md) | CORS and the proxy you need, mixed-content blocks, Leaflet + tile setup, every verified outbound link, demo-night resilience. |
| 05 | [Credits & Licences](05-credits-and-licences.md) | Every source, its licence, and the exact attribution wording. Read before deploying. |
| 06 | [WebMCP](06-webmcp.md) | What WebMCP is, the full imperative API, its security model, and the eleven tools this page registers over the live view. |

---

## The one-paragraph version

Nepal has already solved disaster data *collection*. NDRRMA's BIPAD platform holds 60,000+ verified incident records going back to April 2015 — each with casualty breakdowns by sex and disability — alongside river gauges reporting every ten minutes against warning and danger thresholds, and a live national roadblock feed with repair ETAs and households cut off. It is open, free, and effectively unusable: a fixed dashboard over an undocumented API with no aggregation endpoint, meaning the country's own disaster record cannot be summarised without writing a scraper. Nepal Disaster Watch registers WebMCP tools over that data so an agent can interrogate eleven years of it in one sentence — including the questions that find *absences*, like which municipalities have flood incidents but no registered evacuation centre. Every answer ends in something the person can actually do: map the gap through the HOT campaign NDRRMA and HOT launched for this flood, watch a gauge, call the road engineer, donate to a verified channel.

It issues no orders and sends no alerts. It has no authority to.

---

## Primary data sources

All verified live 30 August 2026.

- **[BIPAD Portal](https://bipadportal.gov.np/api/v1/)** — NDRRMA. Incidents, casualties, gauges, roads, resources. No auth.
- **[GDACS](https://www.gdacs.org/)** — global alert level, GLIDE ID, event geometry, CAP XML.
- **[Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api)** — GloFAS river discharge forecast. No key.
- **[OpenStreetMap / Overpass](https://overpass-api.de/)** — roads, hospitals, bridges, shelters.

Live event during development: **Rasuwa / Bhote Koshi flash flood, 26 August 2026** — GDACS event `1104124`, GLIDE `FL-2026-000167-NPL`.

---

## Status

Research and design complete, and **built** — see [`../README.md`](../README.md) and [`../public/`](../public/).

Implementation settled every open item below, and corrected four assumptions in these
docs. The docs are left as written; the corrections live in the README's
*Findings from building against these APIs*, and are summarised here:

| Open item | Resolved |
|---|---|
| Verify BIPAD CORS headers from a browser | ✅ **Sends `Access-Control-Allow-Origin: *`.** So do GDACS and Open-Meteo. No proxy needed; `worker.js` is now optional, for caching and http-only photos. |
| Verify `tasks.hotosm.org/api/v2/*` from a browser | ❌ **403 to browser requests.** Project deep links work; the campaign list is curated. |
| Confirm the HOT project ID is still active | ⚠️ Re-check `62970` immediately before recording — projects archive as they complete. |

Two further corrections to doc 02 and doc 04:

- **The broken resource filter is `resourceType`, not `resource_type`.** The snake_case
  `resource_type=` works, and so does `district=`. This matters more than it sounds: the
  register holds **58,650** facilities, so "pull all and bucket client-side" is not viable
  in a browser. Only **390** evacuation centres exist nationwide.
- **CARTO now requires an API key** — its keyless endpoint stamps "API KEY REQUIRED"
  across every tile. Doc 04's tile setup is superseded; the build uses Esri Canvas.

And one from the data itself: many gauges report metres **above sea level**, so a
level/threshold ratio is meaningless. Compare headroom in metres.

---

## Attribution

This project displays data from Nepal government sources that publish **no stated licence** — BIPAD/NDRRMA, DHM, and the Department of Roads. That data is shown with attribution for informational purposes and is not redistributed. See [05-credits-and-licences.md](05-credits-and-licences.md) for the full breakdown and the required credit block.

Nepal Disaster Watch is an independent project. It is not affiliated with, endorsed by, or operated by NDRRMA, DHM, DoR or the Government of Nepal, and it is not an official warning service.

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1149 National Emergency Operation Centre
