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

import {
  bipad, gdacsEvents, floodForecast, copernicusActivations, copernicusActivation,
  latlng, daysAgo, isoDate, health,
} from "./api.js";
import { incidentDistrict, incidentMunicipality, hazardName, nearestDistrict } from "./refdata.js";
import { distanceKm } from "./api.js";

/** The five sources, in the order they appear in the filter bar. */
export const SOURCES = [
  { id: "incident", label: "Incidents",  origin: "BIPAD / NDRRMA",              cadence: "as district officers file" },
  { id: "river",    label: "Gauges",     origin: "DHM via BIPAD",               cadence: "every 10 min" },
  { id: "road",     label: "Roads",      origin: "Dept. of Roads via BIPAD",    cadence: "as divisions report" },
  { id: "alert",    label: "Alerts",     origin: "GDACS / EC JRC",              cadence: "per episode" },
  { id: "forecast", label: "Forecast",   origin: "GloFAS / Open-Meteo",         cadence: "daily" },
  { id: "damage",   label: "Damage",     origin: "Copernicus EMS Rapid Mapping", cadence: "per satellite pass" },
];

/** Ordered worst-first; the UI sorts and colours on this. */
export const SEVERITIES = ["critical", "serious", "warning", "normal", "info"];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
export const severityRank = (s) => RANK[s] ?? 99;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Records carry `current: true` when they describe the present rather than a
// moment in the past. The window filter lets those through whatever their start
// date, because a road blocked since July is cutting people off right now and
// hiding it from a "recent" view would be the most dangerous kind of tidy.

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

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
    current: false,           // a dated event, not a description of now
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

  // A gauge with no thresholds published cannot be assessed, so it cannot be
  // urgent — it sits in the bottom tier with the gauges that are simply fine.
  // The label never says "fine", though: it says it cannot be assessed, so the
  // absence of a threshold is not read as the presence of safety.
  let severity = "normal", severityLabel = "no thresholds published — cannot be assessed";
  if (danger != null && level >= danger) { severity = "critical"; severityLabel = "above danger"; }
  else if (warning != null && level >= warning) { severity = "serious"; severityLabel = "above warning"; }
  else if (toWarning != null && toWarning <= APPROACHING_M) { severity = "warning"; severityLabel = "nearing warning"; }
  else if (warning != null || danger != null) { severity = "normal"; severityLabel = "below warning"; }

  const d = r.point ? nearestDistrict(latlng(r.point), distanceKm)?.district : null;

  return {
    id: `river:${r.station ?? r.title}`,
    source: "river",
    current: true,            // the latest reading is by definition now
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
    current: true,            // already filtered to blockages still in force
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

  // GDACS closes an episode with a `todate`. An alert whose window has passed
  // is history and filters like one; an open episode is current.
  const ends = p.todate ? new Date(p.todate).getTime() : null;
  const ongoing = ends == null || ends >= Date.now();

  return {
    id: `alert:${p.eventid}`,
    source: "alert",
    current: ongoing,
    kind: p.eventtype === "FL" ? "flood" : p.eventtype === "EQ" ? "earthquake" : p.eventtype ?? "event",
    title: p.name ?? p.htmldescription ?? "GDACS event",
    titleNe: null,
    at: p.fromdate ?? null,
    severity,
    severityLabel: `${p.alertlevel ?? "unknown"} alert${ongoing ? "" : ", episode closed"}`,
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
    current: true,            // a forecast is about the days ahead
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
// Copernicus EMS Rapid Mapping
//
// The only source here that counts buildings from orbit rather than from a
// district officer's form — which matters precisely when the reporting chain
// is underwater. One record per area of interest, because an activation covers
// several valleys and a single row for the whole thing would hide which one is
// worst.
// ---------------------------------------------------------------------------

/** Centre of a WKT POLYGON/POINT, by bounding box. Good enough to place a pin. */
function wktCentre(wkt) {
  const nums = String(wkt ?? "").match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lons = [], lats = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    lons.push(Number(nums[i]));
    lats.push(Number(nums[i + 1]));
  }
  const mid = (a) => (Math.min(...a) + Math.max(...a)) / 2;
  const lat = mid(lats), lon = mid(lons);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/** Sum every {total, affected} leaf under a product's stats tree. */
function damageTotals(stats) {
  const out = {};
  let total = 0, affected = 0;
  for (const [group, entries] of Object.entries(stats ?? {})) {
    if (!entries || typeof entries !== "object") continue;
    for (const [label, v] of Object.entries(entries)) {
      if (!v || typeof v !== "object" || typeof v.total !== "number") continue;
      out[`${group} — ${label}`] = `${num(v.affected)} of ${v.total}${v.unit ? ` ${v.unit}` : ""}`;
      if (group === "Built-up") { total += v.total; affected += num(v.affected); }
    }
  }
  return { rows: out, buildingsTotal: total, buildingsAffected: affected };
}

function fromDamage(activation, aoi) {
  // An AOI can carry several products — an initial grading and later monitoring
  // passes. The newest image is the one that describes the ground now.
  const products = aoi.products ?? [];
  const images = products.flatMap((p) => (p.images ?? []).map((im) => ({ ...im, product: p })));
  images.sort((a, b) => String(b.acquisitionTime ?? "").localeCompare(String(a.acquisitionTime ?? "")));
  const newest = images[0] ?? null;
  const product = newest?.product ?? products[products.length - 1] ?? null;

  const { rows, buildingsTotal, buildingsAffected } = damageTotals(product?.stats);
  const share = buildingsTotal ? buildingsAffected / buildingsTotal : null;

  // Severity is the share of surveyed buildings damaged. A settlement where
  // nine in ten are gone is not the same finding as one where three in a
  // hundred are, and the raw count alone conflates them with size.
  const severity =
    share == null ? "info"
    : share >= 0.5 ? "critical"
    : share >= 0.2 ? "serious"
    : share > 0 ? "warning"
    : "normal";

  return {
    id: `damage:${activation.code}:AOI${String(aoi.number).padStart(2, "0")}`,
    source: "damage",
    current: !activation.closed,   // the activation is still open
    kind: activation.subCategory ?? activation.category ?? "damage assessment",
    title: aoi.name ?? `Area of interest ${aoi.number}`,
    titleNe: null,
    at: newest?.acquisitionTime ?? activation.activationTime ?? null,
    severity,
    severityLabel:
      share == null ? "no damage statistics published"
      : `${Math.round(share * 100)}% of surveyed buildings affected`,
    district: null,                // resolved by the caller, which has refdata
    districtNe: null,
    municipality: null,            // the activation name is an event, not a place
    point: wktCentre(aoi.extent),
    line:
      (buildingsTotal
        ? `${buildingsAffected.toLocaleString()} of ${buildingsTotal.toLocaleString()} buildings affected`
        : "Mapped, no building statistics published") +
      (newest ? ` · ${newest.sensorName ?? newest.sensorType ?? "satellite"}, ` +
        `${String(newest.acquisitionTime ?? "").slice(0, 16).replace("T", " ")}` : ""),
    metrics: {
      "Activation": `${activation.code ?? "?"} — ${activation.name ?? ""}`.trim(),
      "Area of interest": `${aoi.number} — ${aoi.name ?? "unnamed"}`,
      "Buildings affected": buildingsTotal ? `${buildingsAffected} of ${buildingsTotal}` : null,
      ...rows,
      "Product type": product?.type ?? null,
      "Monitoring pass": product?.monitoring ? product.monitoringNumber : null,
      "Sensor": newest?.sensorName ?? null,
      "Resolution class": newest?.resolutionClass ?? null,
      "Image acquired": newest?.acquisitionTime ?? null,
      "Activated": activation.activationTime ?? null,
      "Activation open": activation.closed ? "no" : "yes",
      "Requested by": activation.activator ?? null,
      "Reason": activation.reason ?? null,
      "GDACS event": activation.gdacsId ?? null,
      "Report": activation.reportLink ?? null,
      "Disasters Charter": activation.charterUrl ?? null,
    },
    raw: { activation: { ...activation, aois: undefined }, aoi },
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

  if (want("damage")) {
    // Two hops: list the country's activations, then pull detail for the open
    // ones. Closed activations are history and would otherwise pin an eleven-
    // year-old assessment to the top of a two-day view.
    jobs.push(
      copernicusActivations("Nepal")
        .then(async (list) => {
          const open = (list.results ?? []).filter((a) => !a.closed).slice(0, 3);
          const details = await Promise.all(
            open.map((a) => copernicusActivation(a.code).catch(() => null))
          );
          for (const d of details) {
            const act = d?.results?.[0];
            if (!act) continue;
            for (const aoi of act.aois ?? []) records.push(fromDamage(act, aoi));
          }
        })
        .catch((e) => errors.push({ source: "damage", message: e.message }))
    );
  }

  await Promise.all(jobs);

  // Damage AOIs arrive with a polygon but no admin unit; resolve it the same
  // way road records are.
  for (const r of records) {
    if (r.source === "damage" && r.point && !r.district) {
      const d = nearestDistrict(r.point, distanceKm)?.district;
      r.district = d?.en ?? null;
      r.districtNe = d?.ne ?? null;
    }
  }

  // Which sources served stored data rather than a live response. A snapshot
  // fallback "succeeds", so without this the status line would show a healthy
  // feed while displaying hours-old canned rows.
  const SNAP_TO_SOURCE = {
    incidents: "incident", rivers: "river", highways: "road",
    gdacs: "alert", forecast: "forecast", copernicus: "damage",
  };
  // Per-activation snapshots are keyed copernicus-EMSR927 and so on.
  for (const k of health.snapshot) if (k.startsWith("copernicus-")) SNAP_TO_SOURCE[k] = "damage";
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

  // The window filters by when something happened — but only for records that
  // are over. Anything still in force stays, whatever its start date.
  // Otherwise a snapshot fallback, which carries GDACS events back to 2015,
  // fills a two-day view with eleven-year-old alerts, while a highway blocked
  // since July silently vanishes from it.
  if (f.days) {
    const cutoff = startOfDay(Date.now()) - (f.days - 1) * 86_400_000;
    out = out.filter((r) => r.current || (r.at && new Date(r.at).getTime() >= cutoff));
  }
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

  // Default: today first, then yesterday, then everything older — and within
  // each day, worst first. Sorting by severity alone would float a fatal
  // incident from nine days ago above a road that closed this morning, which
  // is the wrong answer for a screen whose job is "what is happening now".
  const byRecency = (a, b) =>
    bucketRank(a.at) - bucketRank(b.at) || bySeverity(a, b);

  return [...out].sort(
    f.sort === "time" ? byTime : f.sort === "severity" ? bySeverity : byRecency
  );
}

// ---------------------------------------------------------------------------
// Day buckets
//
// Computed against the reader's local midnight, not against a 24-hour rolling
// window: "yesterday" has to mean the calendar day before this one, or a
// record timestamped 23:00 last night would sit under "Today" all morning.
// ---------------------------------------------------------------------------

export const BUCKETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "earlier", label: "Earlier" },
  { id: "undated", label: "No timestamp published" },
];

/** 'today' | 'yesterday' | 'earlier' | 'undated' */
export function bucketOf(iso) {
  if (!iso) return "undated";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "undated";
  const today = startOfDay(Date.now());
  if (t >= today) return "today";
  if (t >= today - 86_400_000) return "yesterday";
  return "earlier";
}

const BUCKET_ORDER = Object.fromEntries(BUCKETS.map((b, i) => [b.id, i]));
const bucketRank = (iso) => BUCKET_ORDER[bucketOf(iso)] ?? 99;

/** Split an already-sorted list into day groups, preserving order. */
export function groupByDay(rows) {
  const groups = new Map(BUCKETS.map((b) => [b.id, []]));
  for (const r of rows) groups.get(bucketOf(r.at)).push(r);
  return BUCKETS
    .map((b) => ({ ...b, rows: groups.get(b.id) }))
    .filter((g) => g.rows.length);
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
