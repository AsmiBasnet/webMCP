# Deployment & Architecture

What changes now that this is a real deployed site rather than a local `index.html`. Three things will break if you don't plan for them: **CORS**, **mixed content**, and **tile attribution**. All three are solvable in about an hour.

Verified 30 August 2026.

---

## 1. The architecture decision: you need a proxy

`index.html` opened from disk can call anything. A site served from `https://yourapp.pages.dev` cannot — the browser enforces CORS, and the target server must explicitly opt in with an `Access-Control-Allow-Origin` header.

**Status of each API:**

| API | CORS from a browser | Action |
|---|---|---|
| Open-Meteo | ✅ CORS-friendly by design | call direct |
| GDACS | ⚠️ public feeds, usually permissive — verify per endpoint | try direct, fall back to proxy |
| **BIPAD** (`bipadportal.gov.np`) | ⚠️ **unverified — assume no** | **proxy** |
| Overpass (OSM) | ✅ sends `Access-Control-Allow-Origin: *` | call direct |
| Tile providers | ✅ `<img>` tags don't need CORS | direct |

I could not conclusively test BIPAD's CORS headers from a browser context during this research. Nepali government infrastructure generally does not set permissive CORS headers, and BIPAD's own portal calls the API same-origin, so it has never needed to. **Design for the proxy.** It costs ten lines, works whether or not CORS is present, and removes the single biggest risk of your demo failing live.

The proxy also buys you three things you want anyway: **caching** (BIPAD has no SLA), **a snapshot fallback** for demo night, and **a place to fix the mixed-content image problem**.

### Cloudflare Worker proxy — recommended

Free tier, deploys in minutes, sits next to Cloudflare Pages.

```js
// worker.js
const ALLOWED = [
  "bipadportal.gov.np",
  "www.gdacs.org",
  "flood-api.open-meteo.com",
  "overpass-api.de",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    const target = url.searchParams.get("url");
    if (!target) return new Response("Missing ?url=", { status: 400 });

    let t;
    try { t = new URL(target); } catch { return new Response("Bad url", { status: 400 }); }

    // Allowlist — never build an open proxy.
    if (!ALLOWED.includes(t.hostname)) {
      return new Response("Host not allowed", { status: 403, headers: cors() });
    }

    const upstream = await fetch(t.toString(), {
      headers: {
        "User-Agent": "NepalDisasterWatch/1.0 (+https://nepal-disaster-watch.pages.dev; contact: you@example.com)",
        "Accept": "application/json",
      },
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors(),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "public, max-age=120",
      },
    });
  },
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
```

Deploy: `npx wrangler deploy worker.js --name nepal-disaster-watch-proxy`

**The allowlist is not optional.** An open `?url=` proxy will be found and abused within days — it becomes someone else's free anonymiser and gets your account suspended.

Vercel Edge Function equivalent is the same body with `export const config = { runtime: "edge" }` in `api/proxy.js`.

**Avoid public proxies** (`corsproxy.io`, `allorigins.win`) for anything you'll demo. No SLA, shared rate limits pooled across every user of the service, and you're routing your users' traffic through a third party. They fail at exactly the wrong moment.

### Client-side pattern

```js
const PROXY = "https://nepal-disaster-watch-proxy.<you>.workers.dev/?url=";
const DIRECT = new Set(["flood-api.open-meteo.com", "overpass-api.de"]);

async function api(url) {
  const host = new URL(url).hostname;
  const target = DIRECT.has(host) ? url : PROXY + encodeURIComponent(url);
  const r = await fetch(target);
  if (!r.ok) throw new Error(`${host} → ${r.status}`);
  return r.json();
}
```

---

## 2. Mixed content — a real, hard block

BIPAD station photos are served over plain HTTP:

```
http://daq.hydrology.gov.np/images/6fa9a072bfff128f8078b0a570643094
```

Your deployed site is HTTPS. Browsers block or flag HTTP subresources on HTTPS pages, and this fails outright under `upgrade-insecure-requests`, a strict CSP, or Chrome's "Always use secure connections" (increasingly the default).

Three options, in order of preference for a hackathon:

1. **Skip the images.** Show a placeholder. Zero risk, five minutes. The photos add little — station readings are the value.
2. **Proxy them** through the same Worker (add `daq.hydrology.gov.np` to the allowlist and stream the body through with the upstream `Content-Type`). ~15 minutes.
3. **`images.weserv.nl`** as an image CDN that fetches HTTP origins over HTTPS. Fastest, but a third-party dependency in your demo path.

Same problem applies to DoR photos on `navigate.dor.gov.np` — check the scheme before rendering.

---

## 3. The map

**Leaflet 1.9.4**, not MapLibre. ~42 KB gzipped, works with any raster tile source, no WebGL concerns, and the plugin you need for clustering incidents exists and is stable. MapLibre is only the right call if you're doing vector tiles or 3D, which you aren't.

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
```

### Tiles — no API key, works on a deployed site

```js
const light = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  { subdomains: "abcd", maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>' });

const dark = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { subdomains: "abcd", maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>' });

// Satellite — note {z}/{y}/{x}, y before x. Esri is the exception.
const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19,
    attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" });

const map = L.map("map", { layers: [light] }).setView([28.2, 84.5], 7);
L.control.layers({ Light: light, Dark: dark, Satellite: sat }).addTo(map);
```

**CARTO** for light and dark — no key, free CDN, and it's the clean basemap style data viz wants. **Esri World Imagery** for satellite — no key, genuinely useful for showing flood extent. Skip Stadia and MapTiler: both need an API key plus domain registration, and MapTiler stamps its logo on your map.

You *can* use `tile.openstreetmap.org` directly, but read the [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) first — it's donation-funded, best-effort, no SLA, and they will block you without notice if traffic spikes. CARTO is the safer default.

### Nepal bounds

```js
map.setMaxBounds([[26.0, 79.8], [31.0, 88.5]]);
map.setView([28.2, 84.5], 7);   // whole country
// Rasuwa / Bhote Koshi focus for the demo:
map.setView([28.11, 85.30], 10);
```

### Rendering the layers

- **Gauges** → `L.circleMarker`, radius by how close `waterLevel` is to `dangerLevel`, colour by band, and a small arrow or caret for `steady: RISING`. Never plain dots — the threshold relationship is the whole point.
- **Incidents** → `L.markerClusterGroup()`. With 2,500–5,000 flood records you must cluster or the map dies.
- **Roads** → `L.circleMarker` at the closure point, colour by `OPEN` / `PARTIAL_OPEN` / `CLOSED`.
- **GDACS polygons** → `L.geoJSON` from `/gdacsapi/api/polygons/getgeometry`, low opacity, underneath everything.

**Coordinate order gotcha:** BIPAD and GDACS both return GeoJSON `[lon, lat]`. Leaflet wants `[lat, lon]`. Flip on ingest, once, in one place — this bug will cost you an hour if you let it spread. Your points landing in China means you got it wrong.

---

## 4. Every outbound link, verified

These are the CTA destinations. All confirmed live on 30 Aug 2026 — but **re-check the HOT project ID before you record the demo**, since projects get archived as they complete.

### Mapping
| Link | URL |
|---|---|
| HOT campaign — 2026 Nepal Floods | `https://tasks.hotosm.org/explore?campaign=2026%20Nepal%20Floods` |
| Example live project | `https://tasks.hotosm.org/projects/62970` |
| OSM activation record | `https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Nepal_Floods_2026` |
| Daily OSM export for the disaster area | `https://data.humdata.org/dataset/hot_flood_npl` |
| Learn to map | `https://learnosm.org/` |
| MapSwipe | `https://mapswipe.org/en/` |

⚠️ `tasks.hotosm.org/api/v2/*` returned empty from the research sandbox — probably bot protection on the `/api/` path, since the site root loads fine. **Test it from your own browser console before building on the REST API.** Deep-linking to `/projects/{id}` works regardless, so worst case you hardcode a curated project list.

### Donations
| Channel | URL |
|---|---|
| IFRC Emergency Appeal MDRNP022 | `https://donate.redcrossredcrescent.org/ifrc/nepal-flash-floods/` |
| IFRC appeal page | `https://www.ifrc.org/emergency/nepal-flash-floods-2026` |
| Nepal Red Cross Society | `https://donation.nrcs.org/` |
| PM Disaster Relief Fund | `https://opmcm.gov.np/content/586/heartfelt-appeal/` |
| PM fund, international | `https://pmdrf.nchl.com.np/` |
| GlobalGiving Nepal Flood Relief | `https://www.globalgiving.org/projects/nepal-flood-relief-fund/` |
| UNICEF Nepal Flash Flood Appeal | `https://www.unicef.org.au/donate/nepal-flash-flood-appeal-2026` |

Put the fraud warning next to these. The Kathmandu Post flagged fundraising scams within 72 hours of this event, and "here are five verified channels and here's how to spot a fake" is genuinely useful.

### Emergency numbers — Nepal
`100` Police · `112` Police from mobile · `102` Ambulance · `1149` National Emergency Operation Centre · `1155` DHM/Ncell flood alert short code

Render as `tel:` links so they're one tap on a phone. This is the highest-value UI element on the whole site for anyone actually in danger, and it costs nothing.

---

## 5. Demo-night resilience

BIPAD is undocumented, unlicensed and has no SLA. Assume it will be down at the worst moment.

1. **Snapshot everything.** Commit a `data/snapshot/*.json` capture. Ship a `?mode=snapshot` flag.
2. **Fail visibly, not silently.** If a source is unreachable, say so in the UI with the timestamp of the cached data. An app that admits staleness reads as trustworthy; one that shows stale numbers as live is the thing you must never do with casualty data.
3. **Always render an "as of" timestamp** next to every figure, taken from `waterLevelOn` / `incidentOn` / `datemodified` — not from when you fetched it.
4. **Cache aggressively in the Worker** (120s is plenty) so your demo doesn't hammer a government server on live TV.

---

## 6. Deploy

Cloudflare Pages is the natural fit given the Worker.

```bash
# static site
npx wrangler pages deploy ./public --project-name nepal-disaster-watch

# proxy
npx wrangler deploy worker.js --name nepal-disaster-watch-proxy
```

Vercel or Netlify work equally well — drop the Worker for `api/proxy.js` (Vercel Edge) or `netlify/functions/proxy.js`.

**Pre-flight checklist:**
- [ ] Site loads over HTTPS with no mixed-content warnings in the console
- [ ] Every API call succeeds from the deployed origin, not just localhost
- [ ] Attribution control visible on the map (required by ODbL and CARTO)
- [ ] Credits + disclaimer in the footer (see `05-credits-and-licences.md`)
- [ ] `LICENSE` file present and detectable at repo root — **Devpost requires this**
- [ ] Snapshot fallback tested with the network throttled to offline
- [ ] Tested in ChatGPT's in-app browser, and in Chrome with `chrome://flags/#enable-webmcp-testing`
- [ ] HOT project ID still active
- [ ] `tel:` links work on a real phone
