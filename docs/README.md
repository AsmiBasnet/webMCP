# SankatSathi — Documentation

Research and design docs for **SankatSathi** (संकट साथी), a WebMCP-enabled interface to Nepal's public disaster record.

> **BIPAD collects it. SankatSathi makes it answerable.**

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

---

## The one-paragraph version

Nepal has already solved disaster data *collection*. NDRRMA's BIPAD platform holds 60,000+ verified incident records going back to April 2015 — each with casualty breakdowns by sex and disability — alongside river gauges reporting every ten minutes against warning and danger thresholds, and a live national roadblock feed with repair ETAs and households cut off. It is open, free, and effectively unusable: a fixed dashboard over an undocumented API with no aggregation endpoint, meaning the country's own disaster record cannot be summarised without writing a scraper. SankatSathi registers WebMCP tools over that data so an agent can interrogate eleven years of it in one sentence — including the questions that find *absences*, like which municipalities have flood incidents but no registered evacuation centre. Every answer ends in something the person can actually do: map the gap through the HOT campaign NDRRMA and HOT launched for this flood, watch a gauge, call the road engineer, donate to a verified channel.

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

Research and design complete. Docs 04 and 05 are the ones to read before writing deployment code.

**Open items:**
- Verify BIPAD CORS headers from a browser console — the proxy in doc 04 assumes they're absent
- Verify `tasks.hotosm.org/api/v2/*` is reachable from a browser
- Confirm the HOT project ID is still active before recording the demo

---

## Attribution

This project displays data from Nepal government sources that publish **no stated licence** — BIPAD/NDRRMA, DHM, and the Department of Roads. That data is shown with attribution for informational purposes and is not redistributed. See [05-credits-and-licences.md](05-credits-and-licences.md) for the full breakdown and the required credit block.

SankatSathi is an independent project. It is not affiliated with, endorsed by, or operated by NDRRMA, DHM, DoR or the Government of Nepal, and it is not an official warning service.

**Emergencies in Nepal:** 100 Police · 102 Ambulance · 1149 National Emergency Operation Centre
