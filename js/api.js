// Network layer. Every call records where it came from and how fresh it is,
// because every figure this app shows must carry its provenance.

import { PROXY, DIRECT_HOSTS, BIPAD, GDACS, OPENMETEO, COPERNICUS, NEPAL } from "./config.js";

const memo = new Map();          // url -> { at, data }
const MEMO_TTL = 120_000;        // BIPAD has no SLA; don't hammer it.

/** Sources that answered from the network this session, for the "as of" line. */
export const health = { live: new Set(), failed: new Map(), snapshot: new Set() };

export const snapshotMode =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("mode") === "snapshot";

function route(url) {
  const host = new URL(url).hostname;
  if (!PROXY || DIRECT_HOSTS.has(host)) return url;
  return PROXY + encodeURIComponent(url);
}

/** Local snapshot fallback, so a demo survives BIPAD going down. */
async function fromSnapshot(key) {
  try {
    const r = await fetch(`./data/snapshot/${key}.json`);
    if (!r.ok) return null;
    health.snapshot.add(key);
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Fetch JSON with memoisation and a snapshot fallback.
 * @param {string} url
 * @param {{snapshotKey?: string, timeout?: number}} opts
 */
export async function getJSON(url, opts = {}) {
  const { snapshotKey, timeout = 20_000, force = false } = opts;
  const host = new URL(url).hostname;

  // `force` is for a deliberate refresh — a poll tick, or a person pressing
  // the refresh button. Without it the memo would hand a two-minute-old body
  // back to a caller that explicitly asked for a new reading, and the page
  // would claim to have updated when nothing moved.
  const hit = memo.get(url);
  if (!force && hit && Date.now() - hit.at < MEMO_TTL) return hit.data;

  if (snapshotMode && snapshotKey) {
    const snap = await fromSnapshot(snapshotKey);
    if (snap) return snap;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(route(url), { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${host} → HTTP ${r.status}`);
    const data = await r.json();
    memo.set(url, { at: Date.now(), data });
    health.live.add(host);
    health.failed.delete(host);
    return data;
  } catch (err) {
    health.failed.set(host, String(err.message || err));
    if (snapshotKey) {
      const snap = await fromSnapshot(snapshotKey);
      // Fail visibly, never silently: the caller sees snapshot provenance.
      if (snap) return snap;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/**
 * BIPAD paginates but its `count` is always int64 max — useless. Walk pages
 * until a short page comes back or the cap is hit.
 */
export async function bipad(path, params = {}, { pages = 1, snapshotKey, force = false } = {}) {
  const limit = Number(params.limit ?? 200);
  const out = [];
  let offset = Number(params.offset ?? 0);
  let partial = false;

  for (let i = 0; i < pages; i++) {
    const url = `${BIPAD}/${path}/?${qs({ ...params, limit, offset })}`;
    let page;
    try {
      // Only the first page has a snapshot behind it — the cache is one page
      // deep by design, since it exists for resilience, not republication.
      page = await getJSON(url, { snapshotKey: i === 0 ? snapshotKey : undefined, force });
    } catch (err) {
      // Losing page 1 is fatal; losing page 4 is not. Return what we have and
      // mark it, so no total is ever quietly computed over half the record.
      if (i === 0) throw err;
      partial = true;
      break;
    }
    const rows = page.results ?? (Array.isArray(page) ? page : []);
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }

  if (partial) Object.defineProperty(out, "partial", { value: true, enumerable: false });
  return out;
}

export async function gdacsEvents({ from, to, types = "FL,EQ,TC,DR", country = "Nepal" }) {
  const url = `${GDACS}/events/geteventlist/SEARCH?${qs({
    eventlist: types, country, fromDate: from, toDate: to,
  })}`;
  return getJSON(url, { snapshotKey: "gdacs" });
}

export async function floodForecast(lat, lon, days = 14) {
  const url = `${OPENMETEO}?${qs({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    daily: "river_discharge,river_discharge_mean", forecast_days: days, past_days: 7,
  })}`;
  return getJSON(url, { snapshotKey: "forecast" });
}

/**
 * Copernicus EMS Rapid Mapping activations for one country, then the full
 * detail for a given activation code.
 *
 * Two calls, because the list endpoint carries summary fields only — the areas
 * of interest, their polygons and the building-damage statistics all live
 * behind the per-activation endpoint.
 *
 * Neither returns an Access-Control-Allow-Origin header, so both are unusable
 * from a browser unless PROXY is configured. Without one they fail and fall
 * back to the build-time snapshot, which the status bar reports as stale
 * rather than passing off as live.
 */
export async function copernicusActivations(country = "Nepal") {
  const url = `${COPERNICUS}/public-activations-info/?country=${encodeURIComponent(country)}`;
  return getJSON(url, { snapshotKey: "copernicus" });
}

export async function copernicusActivation(code) {
  const url = `${COPERNICUS}/public-activations/?code=${encodeURIComponent(code)}`;
  return getJSON(url, { snapshotKey: `copernicus-${code}` });
}

const [[S, W], [N, E]] = NEPAL.maxBounds;
const inNepal = (lat, lon) => lat >= S && lat <= N && lon >= W && lon <= E;

/**
 * BIPAD/GDACS return GeoJSON [lon, lat]. Leaflet wants [lat, lon]. Flip once, here.
 *
 * At least one record in the gauge register — "Roshi Khola at Kavre" — is
 * published the other way round, as [lat, lon]. Flipped again it lands at
 * 85.7 N, in the Arctic Ocean, which is a valid latitude and so survives every
 * range check; on a map it drags the viewport off the country entirely.
 *
 * So the flip is verified rather than assumed: if the result falls outside
 * Nepal and the un-flipped pair falls inside it, the source transposed that
 * record and the un-flipped pair is returned. Points legitimately outside
 * Nepal (a GDACS event centred over Tibet, say) are untouched, because
 * swapping them would not put them inside either.
 */
export function latlng(point) {
  const c = point?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lon, lat] = c;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!inNepal(lat, lon) && inNepal(lon, lat)) return [lon, lat];
  return [lat, lon];
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function daysAgo(n) {
  return isoDate(Date.now() - n * 86_400_000);
}
