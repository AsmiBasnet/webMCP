# Nepal Disaster Watch — Product Brief

> **BIPAD collects it. Nepal Disaster Watch makes it answerable.**

---

## 1. The problem is not missing data

This is the thing to lead with, because it inverts the assumption everyone brings to a disaster-tech project.

Nepal has **already solved data collection**. NDRRMA's BIPAD platform holds 60,000+ verified incident records going back to April 2015, each with casualty breakdowns by sex and disability. Live river gauges reporting every 10 minutes against per-station warning and danger thresholds. A live Department of Roads feed with closure reasons, repair ETAs, and how many households are cut off. Evacuation centres, helipads, health posts. Census-linked vulnerability layers. All of it public, all of it free, all of it available right now over an open API.

**And essentially nobody can use it.**

It sits behind a dashboard with fixed views, an undocumented API with no published licence, a `count` field that returns int64 max, filters that silently fail, and no aggregation endpoint at all — meaning Nepal's own national disaster record cannot be summarised without writing a scraper.

The gap is not collection. The gap is **interrogation**.

That's the product.

---

## 2. Who this is for

Three users who are normally three separate products:

**The person in the path of it.** Lives in Rasuwa or Saptari. Needs to know: is my river rising, is my road open, where do I go, what happened here last time. Today they get a dashboard designed for officials, in English, on a phone, during a flood.

**The person trying to understand it.** Journalist, researcher, ward planner, DRR officer. Needs: has this happened here before, who is disproportionately affected, where are the coverage gaps. Today they get a CSV export if they're lucky and a scraper if they're not.

**The person who wants to help.** Diaspora, donor, remote volunteer. Needs: what is actually happening, what's real, what can I do that isn't useless. Today they get a news article and a donation link they can't verify.

**The insight:** these are one product the moment an agent sits in front of the data. The corpus is identical for all three — only the question differs. You don't build three interfaces; you build one tool surface and let the agent compose the answer. That collapse is the whole reason WebMCP is the right substrate here rather than an implementation detail.

---

## 3. The core loop: Ask → See → Act

One product discipline, strictly enforced:

**Every query terminates in something the user can actually do.**

If a question can't end in an action, it's a dashboard — and dashboards are where concern goes to die. The user asks in one sentence, the agent composes the API calls, the page renders map + chart + provenance, and the response ends with a real verb: map this area, watch this gauge, call this engineer, donate here, share this alert.

That constraint is what makes it a product instead of a data viewer.

---

## 4. Why WebMCP is genuinely the right fit

Three arguments, in order of strength:

**The query space is too large to enumerate as UI.** 47 hazard types × 77 districts × 753 municipalities × 11 years × ~20 loss metrics, joinable against gauges, roads and facilities. A conventional interface can expose maybe four of those dimensions before it collapses into an unusable filter panel. An agent handles all of them. This is the textbook case for tools-over-UI: not "the UI is clunky" but "the UI is mathematically incapable of covering the question space."

**DOM scraping fails here specifically, and dangerously.** BIPAD's own portal is a JavaScript SPA that renders nothing meaningful to a scraper. And the payload is *numbers* — casualty counts, water levels against danger thresholds. An agent inferring a death toll from a chart image isn't merely less accurate; it's harmful. Structured tools with typed returns aren't a nicety here, they're a safety requirement.

**Crisis compresses attention.** Someone frightened, on a phone, on bad signal, does not learn a filter UI. They type one sentence. The agent-native path isn't a power-user shortcut in this domain — it's the only path that works under the conditions the product exists for.

**What becomes possible that wasn't:** queries that find *absences*. *"Which municipalities have recorded flood incidents but no registered evacuation centre?"* joins two endpoints, aggregates client-side because no summary endpoint exists, and returns a gap list. No dashboard asks that question, because dashboards show you what's there. That class of query — auditing the record for what's missing — is new capability, not a nicer skin on old capability.

---

## 5. The flywheel

The elegant part, and worth calling out explicitly in the submission:

The app **consumes** OpenStreetMap data for roads and facilities. It can therefore **detect where OSM coverage is thin inside flood-affected municipalities**. It hands that gap to the user as a deep-linked HOT Tasking Manager task — from the campaign NDRRMA, NAXA and HOT launched for this exact flood on 27 August 2026. The user traces buildings for fifteen minutes. OSM improves. **The next query returns a better answer.**

Agent finds the gap → human fills it → app gets better. A compounding data loop powered by its own users, where the human does the part humans are better at (visual interpretation of imagery) and the agent does the part agents are better at (noticing the hole across 753 municipalities).

That is a far better answer to *"what can people and agents do together that was difficult or impossible before"* than any simulated dispatch button.

---

## 6. What it deliberately is not

Scope discipline, stated up front — this is a credibility asset, not a limitation:

- **Not an official warning system.** Gauge watches are a convenience layer over public data. DHM issues warnings; we don't.
- **Not a dispatch system.** We have no authority to move a boat or a helicopter, and pretending otherwise is the thing that makes disaster demos ring false.
- **Not a replacement for BIPAD.** It's a lens on it. Ideally it's a proof of what NDRRMA could ship themselves.
- **Not a volunteer recruitment pipeline for on-the-ground work.** Standard humanitarian guidance is blunt that unskilled international volunteers are counterproductive. We say so, and redirect that goodwill to mapping and cash.

---

## 7. Trust as a product feature

In this domain, being wrong is worse than being absent. Three commitments built into the interface, not the README:

**Provenance on every number.** Each figure shows its endpoint, its timestamp, and its source (`nepal_police`, `drr_api`, `hydrology.gov.np`, GLOFAS). Nothing floats free.

**Respect the record's own uncertainty.** BIPAD marks incidents `verified` and `approved`. Those flags surface in the UI. `/citizen-report/` holds unverified public reports and is displayed as a visibly separate, lower-confidence layer.

**Name the gaps out loud.** No public self-service flood-alert subscription exists in Nepal. No confirmed public incident-reporting form. No aggregation endpoint. No published licence on a national disaster API. Listing what's missing is more persuasive than fabricating it — and it's the honest output of the research.

Same discipline on the donation panel: five verified channels *and* a fraud warning, because the Kathmandu Post flagged fundraising scams within 72 hours of this event.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| BIPAD is undocumented, unlicensed, no SLA — could break or disappear mid-demo | Cache a local snapshot; ship read-only; frame as demonstration of what the state could operate |
| Displaying casualty data incorrectly causes real harm | Provenance on every figure; never interpolate or estimate; surface `verified` flags |
| Unofficial alerts create false confidence | Explicit framing as convenience, not authority; always link to the official channel |
| Judges read "Nepal flood app" as disaster-porn | Lead with the data-access argument, not the tragedy; the product is about a public record, not a spectacle |
| Live-data demo fails on the night | Cached snapshot mode with a visible "as of" timestamp |

---

## 9. Success metrics

If this were real, the number that matters is the one that tests the thesis:

- **Share of queries that terminate in an action** — the entire product bet in one metric
- **Questions answered that BIPAD's own dashboard cannot answer** — the differentiation metric
- HOT tasks opened from the app; gauge watches set; verified-donation click-throughs
- Share of sessions in Nepali — tests whether it reached the people it's for, or only the people who study them

---

## 10. MVP cut for the remaining days

**Build:** the Ask box over `/incident/?expand=loss`; live basin watch on `/river/` + `/river-trimed/`; roads view on `/highway/`; two actions — HOT mapping deep-link and verified donations. Bilingual labels throughout (every record already ships `titleNe`; this is nearly free and it's the difference between a tool for Nepal and a tool about Nepal).

**Cut:** earthquake catalogue, air quality, vulnerability/census layers, relief inventory, multi-hazard comparison, CAP composer. All interesting, none load-bearing.

**The demo:** query the live Rasuwa/Bhote Koshi event — GDACS event `1104124`, GLIDE `FL-2026-000167-NPL`, Orange, still current. Ask one question no dashboard can answer. Show the answer. Click through to a real HOT task and make one real edit on camera.

---

## 11. Draft submission text

*For the Devpost "why this fits WebMCP / how it improves UX / what's newly possible" fields.*

> Nepal's NDRRMA already publishes an extraordinary public record: 60,000+ verified disaster incidents since 2015 with casualty breakdowns by sex and disability, live river gauges reporting every ten minutes against danger thresholds, and a live national roadblock feed. It is open, free, and effectively unusable — an undocumented API behind a fixed dashboard, with no aggregation endpoint, so the country's own disaster record cannot be summarised without writing a scraper.
>
> Nepal Disaster Watch makes that record answerable in one sentence. It registers WebMCP tools over the live BIPAD, GDACS and GloFAS APIs, so an agent can query eleven years of incidents across 47 hazard types, 753 municipalities and twenty loss metrics — a question space far too large to express as a filter UI, and one where DOM-scraping a JavaScript dashboard for casualty figures would be not just inaccurate but unsafe.
>
> Every answer ends in something real. Ask which municipalities have flood incidents but no registered evacuation centre — a question no dashboard asks, because dashboards show what exists rather than what's missing — and the agent joins two endpoints and returns the gap list. Ask where the map is too thin for responders to route through, and it deep-links you into the HOT Tasking Manager campaign that NDRRMA, NAXA and HOT launched for this flood on 27 August, where fifteen minutes of tracing improves the same OpenStreetMap data the app queries. The agent finds the gap; the human fills it; the next query is better.
>
> It issues no orders and sends no alerts — it has no authority to, and simulating that authority is what makes most disaster demos ring hollow. It does one thing: it turns a public record that no member of the public can read into one that answers questions, and it ends every answer with a verb.

---

## Sources

- [BIPAD API root](https://bipadportal.gov.np/api/v1/) · [BIPAD Portal](https://bipadportal.gov.np/) · [NDRRMA](https://ndrrma.gov.np/en)
- [GDACS](https://www.gdacs.org/) · [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api)
- [HOT Tasking Manager — 2026 Nepal Floods](https://tasks.hotosm.org/explore?campaign=2026%20Nepal%20Floods) · [OSM activation record](https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Nepal_Floods_2026)
- [IFRC Nepal Flash Floods 2026 appeal](https://www.ifrc.org/emergency/nepal-flash-floods-2026) · [Nepal Red Cross donate](https://donation.nrcs.org/)
