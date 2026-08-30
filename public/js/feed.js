// One feed out of five sources.
//
// Every source publishes a different shape, on a different cadence, with a
// different idea of what "severity" means. This file is the only place that
// knows about those differences: it normalises each into a single record so the
// UI can filter, sort and render one thing rather than five.
//
// Nothing is aggregated or interpreted here beyond what is needed to compare
// records — the raw payload rides along on every record so drill-down can show
// exactly what the source said.

import { bipad, gdacsEvents, floodForecast, latlng, daysAgo, isoDate, health } from "./api.js";
import { incidentDistrict, incidentMunicipality, hazardName, nearestDistrict } from "./refdata.js";
import { distanceKm } from "./api.js";

/** The five sources, in the order they appear in the filter bar. */
export const SOURCES = [
  { id: "incident", label: "Incidents",  origin: "BIPAD / NDRRMA",              cadence: "as district officers file" },
  { id: "river",    label: "Gauges",     origin: "DHM via BIPAD",               cadence: "every 10 min" },
  { id: "road",     label: "Roads",      origin: "Dept. of Roads via BIPAD",    cadence: "as divisions report" },
  { id: "alert",    label: "Alerts",     origin: "GDACS / EC JRC",              cadence: "per episode" },
  { id: "forecast", label: "Forecast",   origin: "GloFAS / Open-Meteo",         cadence: "daily" },
];

/** Ordered worst-first; the UI sorts and colours on this. */
export const SEVERITIES = ["critical", "serious", "warning", "normal", "info"];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
export const severityRank = (s) => RANK[s] ?? 99;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------
// Normalisers — one per source, each returning the common record shape:
//
//   { id, source, kind, title, titleNe, at, severity, severityLabel,
//     district, municipality, point, line, metrics, raw }
//
// `line` is the one-sentence summary shown in the list. `metrics` is what the
// drill-down tabulates. `raw` is the untouched source payload.
// ---------------------------------------------------------------------------

function fromIncident(r) {
  const L = r.loss ?? {};
  const d = incidentDistrict(r);
  const m = incidentMunicipality(r);
  const deaths = num(L.peopleDeathCount);
  const missing = num(L.peopleMissingCount);
  const injured = num(L.peopleInjuredCount);

  // Severity follows harm, not hazard type. A flood with no casualties ranks
  // below a snake bite that killed someone, because the list is read by people
  // deciding where to look next.
  const severity =
    deaths > 0 ? "critical"
    : missing > 0 ? "serious"
    : injured > 0 ? "warning"
    : "info";

  const bits = [];
  if (deaths) bits.push(`${deaths} dead`);
  if (missing) bits.push(`${missing} missing`);
  if (injured) bits.push(`${injured} injured`);
  if (num(L.familyEvacuatedCount)) bits.push(`${num(L.familyEvacuatedCount)} families evacuated`);
  if (num(L.infrastructureDestroyedHouseCount)) bits.push(`${num(L.infrastructureDestroyedHouseCount)} houses lost`);

  return {
    id: `incident:${r.id}`,
    source: "incident",
    kind: hazardName(r.hazard),
    title: r.title ?? "Incident",
    titleNe: r.titleNe ?? null,
    at: r.incidentOn ?? r.createdOn ?? null,
    severity,
    severityLabel: deaths ? "fatal" : missing ? "missing" : injured ? "injuries" : "no casualties recorded",
    district: d?.en ?? null,
    districtNe: d?.ne ?? null,
    municipality: m?.en ?? null,
    point: latlng(r.point),
    line: bits.join(" · ") || "No casualties recorded",
    metrics: {
      Deaths: deaths, Missing: missing, Injured: injured,
      "People affected": num(L.peopleAffectedCount),
      "Families affected": num(L.familyAffectedCount),
      "Families evacuated": num(L.familyEvacuatedCount),
      "Houses destroyed": num(L.infrastructureDestroyedHouseCount),
      "Bridges destroyed": num(L.infrastructureDestroyedBridgeCount),
      "Livestock lost": num(L.livestockDestroyedCount),
      "Estimated loss": L.estimatedLoss ?? null,
      Verified: r.verified ? "yes" : "no",
      Approved: r.approved ? "yes" : "no",
      "Reported by": r.dataSource ?? null,
    },
    raw: r,
  };
}

const APPROACHING_M = 0.5;

function fromRiver(r) {
  const level = num(r.waterLevel);
  const warning = typeof r.warningLevel === "number" ? r.warningLevel : null;
  const danger = typeof r.dangerLevel === "number" ? r.dangerLevel : null;

  // Headroom in metres, never a ratio: many gauges report metres above sea
  // level, so level/threshold reads 0.999 for a station sitting 1.8 m clear.
  const toWarning = warning != null ? Number((warning - level).toFixed(3)) : null;
  const toDanger = danger != null ? Number((danger - level).toFixed(3)) : null;

  let severity = "info", severityLabel = "no thresholds set";
  if (danger != null && level >= danger) { severity = "critical"; severityLabel = "above danger"; }
  else if (warning != null && level >= warning) { severity = "serious"; severityLabel = "above warning"; }
  else if (toWarning != null && toWarning <= APPROACHING_M) { severity = "warning"; severityLabel = "nearing warning"; }
  else if (warning != null || danger != null) { severity = "normal"; severityLabel = "below warning"; }

  const d = r.point ? nearestDistrict(latlng(r.point), distanceKm)?.district : null;

  return {
    id: `river:${r.station ?? r.title}`,
    source: "river",
    kind: `${r.basin ?? "—"} basin`,
    title: r.title ?? "Gauge",
    titleNe: null,
    at: r.waterLevelOn ?? null,
    severity,
    severityLabel,
    district: d?.en ?? null,
    districtNe: d?.ne ?? null,
    municipality: null,
    point: latlng(r.point),
    line:
      `${level} m` +
      (toWarning != null ? ` · ${toWarning > 0 ? `${toWarning} m below warning` : `${Math.abs(toWarning)} m OVER warning`}` : "") +
      (r.steady ? ` · ${String(r.steady).toLowerCase()}` : ""),
    metrics: {
      "Water level": `${level} m`,
      "Warning level": warning != null ? `${warning} m` : null,
      "Danger level": danger != null ? `${danger} m` : null,
      "Metres below warning": toWarning,
      "Metres below danger": toDanger,
      Trend: r.steady ?? null,
      Basin: r.basin ?? null,
      Status: r.status ?? null,
      Elevation: r.elevation ?? null,
    },
    raw: r,
  };
}

function fromRoad(r) {
  const households = num(r.affectedDemography?.householdCount);
  const people = num(r.affectedDemography?.maleCount) + num(r.affectedDemography?.femaleCount);
  const days = r.dateRoadblockStart
    ? Math.floor((Date.now() - new Date(r.dateRoadblockStart)) / 86_400_000)
    : null;

  // A record logged weeks ago with no reopening time is far more likely to be
  // one nobody closed than a road shut for a month. It stays in the feed —
  // dropping it would hide a real closure — but it is not ranked as current.
  const stale = days != null && days > 7 && r.status !== "OPEN";

  let severity = "normal", severityLabel = "open";
  if (stale) { severity = "warning"; severityLabel = "unverified — record may be stale"; }
  else if (r.status === "CLOSED") { severity = households > 20_000 ? "critical" : "serious"; severityLabel = "closed"; }
  else if (r.status === "PARTIAL_OPEN") { severity = "warning"; severityLabel = "partly open"; }

  return {
    id: `road:${r.id}`,
    source: "road",
    kind: r.closureReason ?? "roadblock",
    title: r.title ?? "Road",
    titleNe: null,
    at: r.dateRoadblockStart ?? r.modifiedOn ?? null,
    severity,
    severityLabel,
    district: null,          // resolved by the caller, which has refdata loaded
    districtNe: null,
    municipality: r.location ?? null,
    point: latlng(r.point),
    line:
      `${r.status === "CLOSED" ? "Closed" : r.status === "PARTIAL_OPEN" ? "Partly open" : "Open"}` +
      (households ? ` · ${households.toLocaleString()} households behind it` : "") +
      (r.repairEta ? ` · ETA ${r.repairEta}` : "") +
      (stale ? ` · logged ${days} days ago, never marked reopened` : ""),
    metrics: {
      Status: r.status ?? null,
      Cause: r.closureReason ?? null,
      "Households cut off": households || null,
      "People behind it": people || null,
      "Blocked since": r.dateRoadblockStart ?? null,
      "Estimated reopening": r.dateRoadblockEndEstimated ?? null,
      "Actually reopened": r.dateRoadblockEnd ?? null,
      "Repair ETA": r.repairEta ?? null,
      "Efforts under way": r.effortsBeingMade ?? null,
      Road: r.roadRefno ?? null,
      Division: r.division ?? null,
      Contact: r.contactPerson ?? null,
    },
    raw: r,
  };
}

function fromAlert(f) {
  const p = f.properties ?? f;
  const level = String(p.alertlevel ?? "").toLowerCase();
  const severity = level === "red" ? "critical" : level === "orange" ? "serious" : "warning";

  return {
    id: `alert:${p.eventid}`,
    source: "alert",
    kind: p.eventtype === "FL" ? "flood" : p.eventtype === "EQ" ? "earthquake" : p.eventtype ?? "event",
    title: p.name ?? p.htmldescription ?? "GDACS event",
    titleNe: null,
    at: p.fromdate ?? null,
    severity,
    severityLabel: `${p.alertlevel ?? "unknown"} alert`,
    district: null,
    districtNe: null,
    municipality: p.country ?? null,
    point: latlng(f.geometry) ?? null,
    line: `${p.alertlevel} alert · ${p.fromdate?.slice(0, 10) ?? "?"} → ${p.todate?.slice(0, 10) ?? "ongoing"}`,
    metrics: {
      "Alert level": p.alertlevel ?? null,
      "Event id": p.eventid ?? null,
      "GLIDE number": p.glide ?? null,
      "Episode": p.episodeid ?? null,
      From: p.fromdate ?? null,
      To: p.todate ?? null,
      Severity: p.severitydata?.severitytext ?? null,
      Country: p.country ?? null,
      Report: p.url?.report ?? null,
    },
    raw: f,
  };
}

function fromForecast(json, place) {
  const d = json?.daily;
  if (!d?.time?.length) return null;
  const today = isoDate(Date.now());
  const points = d.time.map((t, i) => ({ date: t, discharge: d.river_discharge?.[i] ?? null }));
  const future = points.filter((x) => x.date >= today && x.discharge != null);
  const now = points.find((x) => x.date === today)?.discharge ?? null;
  const peak = future.reduce((a, b) => (b.discharge > (a?.discharge ?? -1) ? b : a), null);
  const change = now && peak ? ((peak.discharge - now) / now) * 100 : null;

  const severity =
    change == null ? "info" : change > 50 ? "serious" : change > 15 ? "warning" : "normal";

  return {
    id: `forecast:${place.name}`,
    source: "forecast",
    kind: "river discharge",
    title: `Discharge forecast — ${place.name}`,
    titleNe: null,
    at: new Date().toISOString(),
    severity,
    severityLabel: change == null ? "no signal" : `${change >= 0 ? "+" : ""}${change.toFixed(0)}% to peak`,
    district: place.district ?? null,
    districtNe: null,
    municipality: null,
    point: place.point,
    line:
      peak
        ? `Peaks at ${peak.discharge.toFixed(2)} m³/s on ${peak.date}` +
          (now ? ` — ${change >= 0 ? "+" : ""}${change.toFixed(0)}% against today's ${now.toFixed(2)}` : "")
        : "No forecast returned",
    metrics: {
      "Today's discharge": now != null ? `${now.toFixed(2)} m³/s` : null,
      "Forecast peak": peak ? `${peak.discharge.toFixed(2)} m³/s` : null,
      "Peak date": peak?.date ?? null,
      "Change to peak": change != null ? `${change >= 0 ? "+" : ""}${change.toFixed(0)}%` : null,
      "Window": `${points[0]?.date} → ${points[points.length - 1]?.date}`,
    },
    series: points,
    raw: json,
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Points the forecast is pulled for. GloFAS is per-coordinate, not per-country. */
const FORECAST_POINTS = [
  { name: "Rasuwa — Bhote Koshi", district: "Rasuwa", point: [28.11, 85.3] },
  { name: "Nuwakot — Trishuli", district: "Nuwakot", point: [27.93, 85.14] },
  { name: "Chitwan — Narayani", district: "Chitwan", point: [27.69, 84.43] },
];

/**
 * Load every enabled source in parallel and return one normalised list.
 *
 * A source that fails does NOT fail the load — it is reported in `errors` and
 * the rest of the feed still renders, because an unreachable gauge network is
 * no reason to hide the road closures.
 *
 * @param {{days?: number, sources?: Set<string>, force?: boolean}} opts
 */
export async function loadFeed({ days = 7, sources = null, force = false } = {}) {
  const want = (id) => !sources || sources.has(id);
  const errors = [];
  const records = [];

  // `health.snapshot` is sticky across a session, so it cannot answer "did THIS
  // load fall back?". Clear it first and read it after: a source that recovers
  // must stop being reported as stale.
  health.snapshot.clear();

  const jobs = [];

  if (want("incident")) {
    jobs.push(
      bipad("incident",
        { expand: "loss", ordering: "-incident_on", incident_on__gt: daysAgo(days), limit: 500 },
        { pages: 2, snapshotKey: "incidents", force })
        .then((rows) => records.push(...rows.map(fromIncident)))
        .catch((e) => errors.push({ source: "incident", message: e.message }))
    );
  }

  if (want("river")) {
    jobs.push(
      bipad("river",
        { water_level_on__gt: daysAgo(2), ordering: "-water_level_on", limit: 500 },
        { pages: 2, snapshotKey: "rivers", force })
        .then((rows) => {
          // Gauges report every ten minutes — keep each station's latest only.
          const latest = new Map();
          for (const r of rows) {
            const k = r.station ?? r.title;
            const prev = latest.get(k);
            if (!prev || new Date(r.waterLevelOn) > new Date(prev.waterLevelOn)) latest.set(k, r);
          }
          records.push(...[...latest.values()].map(fromRiver));
        })
        .catch((e) => errors.push({ source: "river", message: e.message }))
    );
  }

  if (want("road")) {
    jobs.push(
      bipad("highway", { limit: 500 }, { pages: 3, snapshotKey: "highways", force })
        .then((rows) => {
          const now = Date.now();
          // Only blockages still in force. The register goes back to June 2025
          // and most of it reopened long ago.
          const live = rows.filter(
            (r) => r.status !== "OPEN" && (!r.dateRoadblockEnd || new Date(r.dateRoadblockEnd) > now)
          );
          records.push(...live.map((r) => {
            const rec = fromRoad(r);
            const d = rec.point ? nearestDistrict(rec.point, distanceKm)?.district : null;
            rec.district = d?.en ?? null;
            rec.districtNe = d?.ne ?? null;
            return rec;
          }));
        })
        .catch((e) => errors.push({ source: "road", message: e.message }))
    );
  }

  if (want("alert")) {
    jobs.push(
      gdacsEvents({ from: daysAgo(Math.max(days, 30)), to: isoDate(Date.now()) })
        .then((j) => records.push(...(j.features ?? []).map(fromAlert)))
        .catch((e) => errors.push({ source: "alert", message: e.message }))
    );
  }

  if (want("forecast")) {
    for (const pt of FORECAST_POINTS) {
      jobs.push(
        floodForecast(pt.point[0], pt.point[1])
          .then((j) => { const rec = fromForecast(j, pt); if (rec) records.push(rec); })
          .catch((e) => errors.push({ source: "forecast", message: e.message }))
      );
    }
  }

  await Promise.all(jobs);

  // Which sources served stored data rather than a live response. A snapshot
  // fallback "succeeds", so without this the status line would show a healthy
  // feed while displaying hours-old canned rows.
  const SNAP_TO_SOURCE = {
    incidents: "incident", rivers: "river", highways: "road",
    gdacs: "alert", forecast: "forecast",
  };
  const stale = new Set([...health.snapshot].map((k) => SNAP_TO_SOURCE[k]).filter(Boolean));

  return {
    records, errors, stale,
    fetchedAt: Date.now(),
    failedHosts: [...health.failed.keys()],
  };
}

// ---------------------------------------------------------------------------
// Filtering — pure, synchronous, over the already-fetched list.
// ---------------------------------------------------------------------------

/**
 * @param {Array} records
 * @param {{sources?:Set, severities?:Set, district?:string, kind?:string,
 *          search?:string, sort?:string}} f
 */
export function applyFilters(records, f = {}) {
  let out = records;

  if (f.sources?.size) out = out.filter((r) => f.sources.has(r.source));
  if (f.severities?.size) out = out.filter((r) => f.severities.has(r.severity));
  if (f.district) out = out.filter((r) => r.district === f.district);
  if (f.kind) out = out.filter((r) => r.kind === f.kind);

  if (f.search) {
    const q = f.search.toLowerCase();
    out = out.filter((r) =>
      [r.title, r.titleNe, r.kind, r.district, r.municipality, r.line]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }

  const bySeverity = (a, b) =>
    severityRank(a.severity) - severityRank(b.severity) || (b.at ?? "").localeCompare(a.at ?? "");
  const byTime = (a, b) => (b.at ?? "").localeCompare(a.at ?? "");

  return [...out].sort(f.sort === "time" ? byTime : bySeverity);
}

/** Distinct values for the dropdowns, counted over the current record set. */
export function facets(records) {
  const count = (key) => {
    const m = new Map();
    for (const r of records) {
      const v = r[key];
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return { districts: count("district"), kinds: count("kind") };
}
