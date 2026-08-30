// Network layer. Every call records where it came from and how fresh it is,
// because every figure this app shows must carry its provenance.

import { PROXY, DIRECT_HOSTS, BIPAD, GDACS, OPENMETEO } from "./config.js";

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

/** A caveat to attach when a result was computed over an incomplete fetch. */
export function partialCaveat(...rowsets) {
  return rowsets.some((r) => r?.partial)
    ? "The data source became unreachable partway through this query, so these totals are computed over " +
      "an incomplete fetch and are floors, not final figures. Re-run when the source is back."
    : null;
}

export async function gdacsEvents({ from, to, types = "FL,EQ,TC,DR", country = "Nepal" }) {
  const url = `${GDACS}/events/geteventlist/SEARCH?${qs({
    eventlist: types, country, fromDate: from, toDate: to,
  })}`;
  return getJSON(url, { snapshotKey: "gdacs" });
}

export async function gdacsGeometry(eventId, episodeId = 1) {
  const url = `${GDACS}/polygons/getgeometry?eventtype=FL&eventid=${eventId}&episodeid=${episodeId}`;
  return getJSON(url);
}

export async function floodForecast(lat, lon, days = 14) {
  const url = `${OPENMETEO}?${qs({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    daily: "river_discharge,river_discharge_mean", forecast_days: days, past_days: 7,
  })}`;
  return getJSON(url, { snapshotKey: "forecast" });
}

/** BIPAD/GDACS return GeoJSON [lon, lat]. Leaflet wants [lat, lon]. Flip once, here. */
export function latlng(point) {
  const c = point?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lon, lat] = c;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
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
