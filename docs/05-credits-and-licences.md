# Credits & Licences

Every source Nepal Disaster Watch uses, with its licence and the exact attribution wording to display. Paste these verbatim — several are legally required, and two of them require care because **no licence is stated at all**.

Verified 30 August 2026.

---

## 1. The short version — on-page credit block

This is the minimum that must be visible on the deployed site. It is not optional; ODbL and CC BY both require it.

```html
<footer class="credits">
  <p><strong>Data sources</strong></p>
  <ul>
    <li>Disaster incidents, river gauges, road closures and facilities:
      <a href="https://bipadportal.gov.np/">BIPAD Portal</a>,
      National Disaster Risk Reduction and Management Authority (NDRRMA),
      Government of Nepal. <em>No licence stated — shown for informational
      purposes only, not redistributed.</em></li>
    <li>River and rainfall observations originate from the
      <a href="https://www.dhm.gov.np/">Department of Hydrology and
      Meteorology (DHM)</a>, Government of Nepal. <em>No licence stated.</em></li>
    <li>Road closure reports originate from the
      <a href="https://navigate.dor.gov.np/">Department of Roads (DoR)</a>,
      Government of Nepal. <em>No licence stated.</em></li>
    <li>Global disaster alerts:
      <a href="https://www.gdacs.org/">GDACS</a> — a cooperation framework of
      the European Commission, UN OCHA and UNOSAT. Indicative only.</li>
    <li>River discharge forecasts:
      <a href="https://open-meteo.com/">Open-Meteo.com</a>
      (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>).
      Contains modified Copernicus Emergency Management Service information 2026.</li>
    <li>Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
      contributors, ODbL 1.0.</li>
    <li>Basemap tiles: &copy; <a href="https://carto.com/attributions">CARTO</a>.
      Satellite imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community.</li>
    <li>Mapping campaign coordinated by the
      <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team (HOT)</a>
      with NAXA and NDRRMA.</li>
    <li>Built with <a href="https://leafletjs.com/">Leaflet</a> (BSD-2-Clause).</li>
  </ul>
  <p class="disclaimer">Nepal Disaster Watch is an independent project. It is not
  affiliated with, endorsed by, or operated by NDRRMA, DHM, DoR or the
  Government of Nepal. It is not an official warning service. For emergencies
  in Nepal call <strong>100</strong> (Police), <strong>102</strong> (Ambulance)
  or <strong>1149</strong> (National Emergency Operation Centre).</p>
</footer>
```

The disclaimer paragraph matters as much as the credits. You are displaying government casualty data on an unofficial site — say plainly what you are and are not.

---

## 2. Source-by-source detail

### BIPAD Portal — NDRRMA, Government of Nepal
**Used for:** incidents, casualty/loss records, river gauges, rainfall, road closures, resources, admin boundaries, hazard taxonomy.
**Licence: NO STATED LICENCE.** I checked `bipadportal.gov.np`, its `/pages/terms-of-use` route, and NDRRMA's site — the portal is a client-side SPA serving no crawlable terms, and no data policy, licence or copyright statement is discoverable. Nepal's Data Act 2079 (2022) governs government data handling but is a governance statute, not a reuse licence.

**How to behave when there is no licence** — this is the responsible reading, not legal advice:
- Attribute clearly and prominently. ✅
- Display the data. ✅
- Do **not** bulk-republish the dataset as your own downloadable product. ❌
- Do **not** imply an open licence, endorsement, or official status. ❌
- Cache for performance and demo resilience — reasonable. ✅
- State that accuracy and currency are not guaranteed by you. ✅

```
Source: BIPAD Portal, National Disaster Risk Reduction and Management
Authority (NDRRMA), Government of Nepal — bipadportal.gov.np
(no licence stated; displayed for informational purposes only)
```

### Department of Hydrology and Meteorology (DHM)
**Used for:** the upstream origin of every river and rainfall reading (BIPAD records carry `"dataSource": "hydrology.gov.np"`). Credit DHM even though you fetch via BIPAD — they generated the observation.
**Licence: NO STATED LICENCE.** DHM operates a *request-based* access model (an application form asking occupation, institution and purpose), plus a Right to Information page. Neither is a reuse licence for the already-public river-watch outputs.

```
Source: Department of Hydrology and Meteorology (DHM), Government of Nepal
— dhm.gov.np / hydrology.gov.np (no stated data licence)
```

### Department of Roads (DoR)
**Used for:** the `/highway/` roadblock feed, including photos hosted on `navigate.dor.gov.np`.
**Licence: NO STATED LICENCE.**

```
Source: Department of Roads (DoR), Government of Nepal
— navigate.dor.gov.np (no stated data licence)
```

⚠️ The `contactPerson` field contains named engineers and personal mobile numbers. It is published by DoR, but think before amplifying it. Recommendation: show the name and division, and put the phone number behind an explicit "show contact" click rather than rendering it in a public list. Republishing personal phone numbers at scale is a different act from a government publishing them on an operational portal.

### GDACS
**Used for:** global alert level, GLIDE number, event geometry, CAP XML.
**Licence: NO FORMAL LICENCE PUBLISHED.** Their terms of use are a disclaimer, not a grant: information is "purely indicative," provided as-is, and should not be used for decision-making without alternate sources. Public reuse is implicitly permitted (open, unregistered, public-awareness service) but there is no explicit redistribution grant.

```
Data: Global Disaster Alert and Coordination System (GDACS) — a cooperation
framework of the European Commission, UN OCHA and UNOSAT. gdacs.org
Indicative only; not for operational decision-making.
```

Carry that "indicative only" wording through to your UI. It's their own framing and it protects you.

### Open-Meteo
**Used for:** GloFAS-derived river discharge forecast.
**Licence: CC BY 4.0** on the free tier. Free tier is **non-commercial only** — a hackathon demo with no ads and no paywall qualifies. Limits: <10,000 calls/day, 5,000/hour, 600/minute. No API key.

```
Flood forecast data by Open-Meteo.com (CC BY 4.0)
```

### Copernicus / GloFAS
**Used for:** the underlying model behind Open-Meteo's flood API. CC BY 4.0. Copernicus specifies the wording exactly, and which variant depends on whether you modified the data:

```
Contains modified Copernicus Emergency Management Service information 2026
```

Use "Contains modified…" if you transform, resample or derive anything (you will — you're joining it to gauges). Use `Generated using Copernicus Emergency Management Service information 2026` only if redistributing untouched.

### OpenStreetMap
**Used for:** roads, hospitals, bridges, shelters via Overpass; and indirectly through CARTO basemaps.
**Licence: ODbL 1.0.** Attribution required, and you must make clear the data is ODbL — a link to the copyright page satisfies this. Share-alike applies if you distribute a *derived database*; displaying it does not trigger it.

```html
&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
```

### CARTO basemaps
**Used for:** light (Positron) and dark (Dark Matter) basemap tiles. No API key for the free CDN raster styles.

```html
&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>,
&copy; <a href="https://carto.com/attributions">CARTO</a>
```

### Esri World Imagery
**Used for:** optional satellite layer. No API key needed for the public ArcGIS Online service at normal volume. Note the tile URL uses **`{z}/{y}/{x}`** — y before x, unlike every other provider.

```
Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community
```

### Humanitarian OpenStreetMap Team (HOT)
**Used for:** the mapping call-to-action. Data produced through Tasking Manager is OSM data under ODbL. The Tasking Manager software itself is BSD.

```
Mapping coordinated by the Humanitarian OpenStreetMap Team (HOT),
NAXA and NDRRMA — hotosm.org
```

### Leaflet
**Licence: BSD-2-Clause.** No UI attribution legally required for the library. Keep the default Leaflet credit anyway — it's convention, and the attribution control is how you display the provider credits that *are* required.

### Nepal Red Cross / IFRC / GlobalGiving / UNICEF
Linked as donation destinations, not data sources. **Do not reproduce their logos or marks** — use plain text links. Using a charity's branding can imply partnership you don't have.

---

## 3. What NOT to do

- Don't put a Government of Nepal emblem, NDRRMA logo, or Nepali flag on the site. It implies official status you don't have. This is the single easiest way to turn a good project into a problem.
- Don't use "official", "authoritative", or "verified by" language about your own output.
- Don't republish the BIPAD dataset as a downloadable dump or a public API of your own.
- Don't reproduce charity logos on the donation panel.
- Don't render DoR engineers' personal phone numbers in a bulk list.

---

## 4. Repo-level files

**`LICENSE`** — the Devpost rules require an open-source licence detectable at the top of the repo. **MIT** is the simplest and is what most hackathon entries use. Note this licenses *your code*, not the data — say so in the README.

**`README.md`** must carry a data-attribution section repeating §1, plus a line clarifying the split:

> The MIT licence covers this repository's source code only. Data displayed by
> this application belongs to its respective sources and is subject to their own
> terms — see [docs/05-credits-and-licences.md](docs/05-credits-and-licences.md).
> Several sources publish no licence at all; that data is displayed with
> attribution and is not redistributed.

**`NOTICE`** — optional, but a good signal of care. Copy §2 into it.
