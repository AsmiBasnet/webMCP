// The tool surface. Every tool is a plain async function returning
//   { summary, data, provenance, actions }
// so one implementation serves the WebMCP registration, the in-page Ask box,
// and the rendered views. Nothing here writes, commands, or dispatches.

import { bipad, getJSON, partialCaveat, gdacsEvents, gdacsGeometry, floodForecast, latlng, distanceKm, isoDate, daysAgo } from "./api.js";
import {
  ref, findDistrict, findMunicipality, findHazard, hazardName,
  incidentDistrict, incidentMunicipality,
} from "./refdata.js";
import { LIVE_EVENT, HAZARD } from "./config.js";

const src = (endpoint, note) => ({
  endpoint,
  source: "BIPAD Portal, NDRRMA, Government of Nepal",
  retrievedAt: new Date().toISOString(),
  ...(note ? { note } : {}),
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const total = (rows, field) => rows.reduce((s, r) => s + num(r.loss?.[field]), 0);

// ---------------------------------------------------------------------------
// 1. query_incidents
// ---------------------------------------------------------------------------

/**
 * Search Nepal's incident record (Apr 2015 → today, 60k+ records).
 * The `verified`, `approved`, `source` and `hazard__in` filters are accepted
 * but ignored server-side, so anything on those is applied after the fetch.
 */
export async function query_incidents({
  hazard, district, municipality, since, until, search,
  near, radiusKm = 25, verifiedOnly = false, limit = 500,
} = {}) {
  const h = hazard != null ? findHazard(hazard) : null;
  const d = district != null ? findDistrict(district) : null;
  const m = municipality != null ? findMunicipality(municipality) : null;

  const params = {
    expand: "loss",
    ordering: "-incident_on",
    hazard: h?.id,
    district: d?.id,
    municipality: m?.id,
    incident_on__gt: since ? isoDate(since) : undefined,
    incident_on__lt: until ? isoDate(until) : undefined,
    search: search || undefined,
    limit: 500,
  };

  const pages = Math.max(1, Math.ceil(limit / 500));
  let rows = await bipad("incident", params, { pages, snapshotKey: "incidents" });

  if (verifiedOnly) rows = rows.filter((r) => r.verified && r.approved);
  if (near) {
    const centre = await resolvePlace(near);
    if (centre) {
      rows = rows.filter((r) => {
        const p = latlng(r.point);
        return p && distanceKm(centre.latlon, p) <= radiusKm;
      });
    }
  }

  const kept = rows.slice(0, limit);
  const data = kept.map(shapeIncident);
  const deaths = total(kept, "peopleDeathCount");
  const affected = total(kept, "peopleAffectedCount");

  return {
    summary:
      `${data.length} incident${data.length === 1 ? "" : "s"}` +
      (h ? ` of type ${h.en}` : "") +
      (d ? ` in ${d.en}` : m ? ` in ${m.en}` : "") +
      (since ? ` since ${isoDate(since)}` : "") +
      ` — ${deaths} death${deaths === 1 ? "" : "s"}, ${affected} people recorded affected.`,
    data,
    totals: { incidents: data.length, deaths, affected },
    caveat: partialCaveat(rows),
    provenance: [src("/api/v1/incident/?expand=loss", "count field is unusable (int64 max); totals computed client-side")],
    actions: followUpActions(data),
  };
}

function shapeIncident(r) {
  const d = incidentDistrict(r), m = incidentMunicipality(r);
  return {
    id: r.id,
    title: r.title,
    titleNe: r.titleNe,
    hazard: hazardName(r.hazard),
    hazardId: r.hazard,
    incidentOn: r.incidentOn,
    district: d?.en ?? null,
    districtNe: d?.ne ?? null,
    municipality: m?.en ?? null,
    municipalityId: m?.id ?? null,
    point: latlng(r.point),
    verified: !!r.verified,
    approved: !!r.approved,
    dataSource: r.dataSource,
    loss: r.loss
      ? {
          deaths: num(r.loss.peopleDeathCount),
          missing: num(r.loss.peopleMissingCount),
          injured: num(r.loss.peopleInjuredCount),
          affected: num(r.loss.peopleAffectedCount),
          familiesAffected: num(r.loss.familyAffectedCount),
          familiesEvacuated: num(r.loss.familyEvacuatedCount),
          housesDestroyed: num(r.loss.infrastructureDestroyedHouseCount),
          bridgesDestroyed: num(r.loss.infrastructureDestroyedBridgeCount),
          livestockDestroyed: num(r.loss.livestockDestroyedCount),
          estimatedLoss: r.loss.estimatedLoss,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// 2. get_casualty_breakdown — the question that has never had an interface
// ---------------------------------------------------------------------------

/**
 * Aggregate casualties by year, month, district, municipality or hazard,
 * including the sex and disability breakdowns BIPAD records but never surfaces.
 * BIPAD has no aggregation endpoint at all; every total here is computed here.
 */
export async function get_casualty_breakdown({
  hazard, district, since = "2015-04-01", until, groupBy = "year", limit = 4000,
} = {}) {
  const h = hazard != null ? findHazard(hazard) : null;
  const d = district != null ? findDistrict(district) : null;

  const rows = await bipad(
    "incident",
    {
      expand: "loss", ordering: "-incident_on",
      hazard: h?.id, district: d?.id,
      incident_on__gt: isoDate(since),
      incident_on__lt: until ? isoDate(until) : undefined,
      limit: 500,
    },
    { pages: Math.ceil(limit / 500), snapshotKey: "incidents" }
  );

  const key = (r) => {
    if (groupBy === "year") return String(new Date(r.incidentOn).getFullYear());
    if (groupBy === "month") return String(r.incidentOn ?? "").slice(0, 7);
    if (groupBy === "district") return incidentDistrict(r)?.en ?? "Unknown";
    if (groupBy === "municipality") return incidentMunicipality(r)?.en ?? "Unknown";
    if (groupBy === "hazard") return hazardName(r.hazard);
    return "All";
  };

  const buckets = new Map();
  for (const r of rows) {
    const k = key(r);
    const b = buckets.get(k) ?? {
      group: k, incidents: 0,
      deaths: 0, deathsMale: 0, deathsFemale: 0, deathsOther: 0, deathsUnknown: 0, deathsDisabled: 0,
      missing: 0, injured: 0, injuredDisabled: 0, affected: 0,
      familiesEvacuated: 0, housesDestroyed: 0, bridgesDestroyed: 0,
    };
    const L = r.loss ?? {};
    b.incidents++;
    b.deaths += num(L.peopleDeathCount);
    b.deathsMale += num(L.peopleDeathMaleCount);
    b.deathsFemale += num(L.peopleDeathFemaleCount);
    b.deathsOther += num(L.peopleDeathOtherCount);
    b.deathsUnknown += num(L.peopleDeathUnknownCount);
    b.deathsDisabled += num(L.peopleDeathDisabledCount);
    b.missing += num(L.peopleMissingCount);
    b.injured += num(L.peopleInjuredCount);
    b.injuredDisabled += num(L.peopleInjuredDisabledCount);
    b.affected += num(L.peopleAffectedCount);
    b.familiesEvacuated += num(L.familyEvacuatedCount);
    b.housesDestroyed += num(L.infrastructureDestroyedHouseCount);
    b.bridgesDestroyed += num(L.infrastructureDestroyedBridgeCount);
    buckets.set(k, b);
  }

  const data = [...buckets.values()].sort((a, b) =>
    groupBy === "year" || groupBy === "month"
      ? a.group.localeCompare(b.group)
      : b.deaths - a.deaths || b.incidents - a.incidents
  );

  const totals = data.reduce(
    (s, b) => ({
      incidents: s.incidents + b.incidents,
      deaths: s.deaths + b.deaths,
      deathsMale: s.deathsMale + b.deathsMale,
      deathsFemale: s.deathsFemale + b.deathsFemale,
      deathsDisabled: s.deathsDisabled + b.deathsDisabled,
      affected: s.affected + b.affected,
    }),
    { incidents: 0, deaths: 0, deathsMale: 0, deathsFemale: 0, deathsDisabled: 0, affected: 0 }
  );

  return {
    summary:
      `${totals.incidents} incidents${h ? ` (${h.en})` : ""}${d ? ` in ${d.en}` : ""} ` +
      `from ${isoDate(since)}: ${totals.deaths} deaths ` +
      `(${totals.deathsMale} male, ${totals.deathsFemale} female, ${totals.deathsDisabled} recorded disabled), ` +
      `${totals.affected} affected — grouped by ${groupBy}.`,
    data, totals, groupBy,
    caveat: partialCaveat(rows),
    provenance: [
      src("/api/v1/incident/?expand=loss",
        "no aggregation endpoint exists — every total here is computed in the browser"),
    ],
    actions: [
      { verb: "Check rivers there now", tool: "get_river_status", args: d ? { district: d.en } : {} },
      { verb: "Find what is missing", tool: "find_coverage_gaps", args: d ? { district: d.en } : {} },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. get_river_status
// ---------------------------------------------------------------------------

/**
 * Live river gauges against their own warning and danger levels.
 * `water_level_on__gt` is mandatory — without it BIPAD serves 2025 readings.
 */
export async function get_river_status({ basin, district, near, radiusKm = 50, onlyElevated = false } = {}) {
  const d = district != null ? findDistrict(district) : null;
  const rows = await bipad(
    "river",
    { water_level_on__gt: daysAgo(2), district: d?.id, limit: 500 },
    { pages: 6, snapshotKey: "rivers" }
  );

  // Gauges report every 10 minutes — keep only each station's latest reading.
  const latest = new Map();
  for (const r of rows) {
    const k = r.station ?? r.title;
    const prev = latest.get(k);
    if (!prev || new Date(r.waterLevelOn) > new Date(prev.waterLevelOn)) latest.set(k, r);
  }

  let stations = [...latest.values()].map(shapeStation);
  if (basin) stations = stations.filter((s) => (s.basin ?? "").toLowerCase().includes(String(basin).toLowerCase()));
  if (near) {
    const centre = await resolvePlace(near);
    if (centre) stations = stations.filter((s) => s.point && distanceKm(centre.latlon, s.point) <= radiusKm);
  }
  if (onlyElevated) stations = stations.filter((s) => s.severity !== "normal");

  // Least headroom first — the gauge closest to its own warning mark leads.
  const rank = { danger: 0, warning: 1, approaching: 2, normal: 3, unknown: 4 };
  stations.sort((a, b) =>
    rank[a.severity] - rank[b.severity] ||
    (a.metresBelowWarning ?? Infinity) - (b.metresBelowWarning ?? Infinity)
  );

  const above = stations.filter((s) => s.severity === "danger" || s.severity === "warning");
  const closing = stations.filter((s) => s.severity === "approaching");

  return {
    summary:
      `${stations.length} gauge${stations.length === 1 ? "" : "s"} reporting` +
      (basin ? ` in the ${basin} basin` : "") + (d ? ` in ${d.en}` : "") +
      `. ${above.length} at or above warning level` +
      (above.length ? `: ${above.slice(0, 5).map((s) => s.title).join(", ")}.` : "") +
      (closing.length
        ? `${above.length ? " " : ", and "}${closing.length} within half a metre of it` +
          `: ${closing.slice(0, 3).map((s) => `${s.title} (${s.metresBelowWarning} m to go)`).join(", ")}.`
        : above.length ? "" : "."),
    data: stations,
    totals: { stations: stations.length, aboveWarning: above.length, approaching: closing.length },
    caveat: partialCaveat(rows),
    provenance: [
      src("/api/v1/river/?water_level_on__gt=…",
        "observations originate from the Department of Hydrology and Meteorology (hydrology.gov.np)"),
    ],
    actions: [
      ...(above[0] ? [{ verb: `Watch ${above[0].title}`, tool: "watch_gauge", args: { station: above[0].title } }] : []),
      { verb: "See tomorrow's forecast", tool: "get_flood_forecast",
        args: above[0]?.point ? { lat: above[0].point[0], lon: above[0].point[1], place: above[0].title } : {} },
    ],
  };
}

// Half a metre below the warning mark is close enough to say so.
const APPROACHING_M = 0.5;

function shapeStation(r) {
  const level = num(r.waterLevel);
  const danger = typeof r.dangerLevel === "number" ? r.dangerLevel : null;
  const warning = typeof r.warningLevel === "number" ? r.warningLevel : null;

  // Many gauges report metres above sea level, not metres above bed, so a
  // level/threshold ratio is meaningless — 1344 m against a 1345.8 m warning
  // reads as 0.999 while actually sitting 1.8 m clear. Headroom in metres is
  // the only comparison that holds across stations.
  const headroom = warning != null ? Number((warning - level).toFixed(3)) : null;

  let severity = "unknown";
  if (danger != null && level >= danger) severity = "danger";
  else if (warning != null && level >= warning) severity = "warning";
  else if (headroom != null && headroom <= APPROACHING_M) severity = "approaching";
  else if (warning != null || danger != null) severity = "normal";

  return {
    metresBelowWarning: headroom,
    metresBelowDanger: danger != null ? Number((danger - level).toFixed(3)) : null,
    id: r.id,
    station: r.station,
    title: r.title,
    basin: r.basin,
    waterLevel: level,
    warningLevel: warning,
    dangerLevel: danger,
    severity,
    trend: r.steady, // RISING / STEADY / FALLING
    status: r.status,
    observedAt: r.waterLevelOn,
    point: latlng(r.point),
    elevation: r.elevation,
    district: r.district,
    dataSource: r.dataSource,
    // Station photos are served over plain http:// — mixed content on https://.
    image: typeof r.image === "string" && r.image.startsWith("https://") ? r.image : null,
  };
}

// ---------------------------------------------------------------------------
// 4. get_flood_forecast — the thing BIPAD cannot tell you: tomorrow
// ---------------------------------------------------------------------------

export async function get_flood_forecast({ lat, lon, place, days = 14 } = {}) {
  let point = lat != null && lon != null ? [Number(lat), Number(lon)] : null;
  let label = place ?? null;

  if (!point && place) {
    const resolved = await resolvePlace(place);
    if (resolved) { point = resolved.latlon; label = resolved.name; }
  }
  if (!point) { point = LIVE_EVENT.center; label = LIVE_EVENT.name; }

  const f = await floodForecast(point[0], point[1], days);
  const series = (f.daily?.time ?? []).map((t, i) => ({
    date: t,
    discharge: f.daily.river_discharge?.[i] ?? null,
    normal: f.daily.river_discharge_mean?.[i] ?? null,
  }));

  const today = isoDate(Date.now());
  const future = series.filter((p) => p.date >= today && p.discharge != null);
  const peak = future.reduce((m, p) => (m == null || p.discharge > m.discharge ? p : m), null);
  const now = series.find((p) => p.date === today)?.discharge ?? null;
  const change = now && peak ? Number((((peak.discharge - now) / now) * 100).toFixed(0)) : null;

  return {
    summary: peak
      ? `GloFAS forecast for ${label ?? `${point[0].toFixed(2)}, ${point[1].toFixed(2)}`}: ` +
        `discharge peaks at ${peak.discharge} m³/s on ${peak.date}` +
        (change != null ? ` — ${change >= 0 ? "+" : ""}${change}% against today's ${now} m³/s.` : ".")
      : `No forecast returned for ${label ?? "that point"}.`,
    data: { point, label, series, peak, today: now, changePercent: change },
    provenance: [
      {
        endpoint: "flood-api.open-meteo.com/v1/flood",
        source: "Open-Meteo (CC BY 4.0) — contains modified Copernicus Emergency Management Service information 2026",
        retrievedAt: new Date().toISOString(),
        note: "Modelled forecast. Not an observation, and not an official warning.",
      },
    ],
    actions: [{ verb: "Compare with the live gauge", tool: "get_river_status", args: { near: label } }],
  };
}

// ---------------------------------------------------------------------------
// 5. get_road_closures
// ---------------------------------------------------------------------------

export async function get_road_closures({ district, status, near, radiusKm = 50, sortBy = "households" } = {}) {
  const d = district != null ? findDistrict(district) : null;
  const rows = await bipad("highway", { district: d?.id, limit: 500 }, { pages: 3, snapshotKey: "highways" });

  let data = rows.map(shapeRoad);
  if (status) data = data.filter((r) => r.status === String(status).toUpperCase().replace(/\s|-/g, "_"));
  if (near) {
    const centre = await resolvePlace(near);
    if (centre) data = data.filter((r) => r.point && distanceKm(centre.latlon, r.point) <= radiusKm);
  }

  data.sort((a, b) =>
    sortBy === "households" ? b.householdsCutOff - a.householdsCutOff
    : sortBy === "delay" ? (b.delayHours ?? -Infinity) - (a.delayHours ?? -Infinity)
    : new Date(b.blockedSince ?? 0) - new Date(a.blockedSince ?? 0)
  );

  const closed = data.filter((r) => r.status === "CLOSED");
  const cutOff = closed.reduce((s, r) => s + r.householdsCutOff, 0);
  const overruns = data.filter((r) => r.delayHours != null && r.delayHours > 0);

  return {
    summary:
      `${data.length} roadblock record${data.length === 1 ? "" : "s"}${d ? ` in ${d.en}` : ""} — ` +
      `${closed.length} fully closed, cutting off ${cutOff.toLocaleString()} households. ` +
      `${overruns.length} took longer to clear than the Department of Roads estimated.`,
    data,
    totals: { records: data.length, closed: closed.length, householdsCutOff: cutOff, overruns: overruns.length },
    caveat: partialCaveat(rows),
    provenance: [src("/api/v1/highway/", "originates from the Department of Roads (navigate.dor.gov.np)")],
    actions: [],
  };
}

function shapeRoad(r) {
  const est = hoursBetween(r.dateRoadblockStart, r.dateRoadblockEndEstimated);
  const actual = hoursBetween(r.dateRoadblockStart, r.dateRoadblockEnd);
  return {
    id: r.id,
    title: r.title,
    road: r.roadRefno,
    location: r.location,
    division: r.division,
    status: r.status, // OPEN / PARTIAL_OPEN / CLOSED
    closureReason: r.closureReason,
    efforts: r.effortsBeingMade,
    remarks: r.remarks,
    repairEta: r.repairEta,
    actualRepairTime: r.actualRepairTime,
    // Estimated vs actual clearance — an accountability metric sitting in plain sight.
    delayHours: est != null && actual != null ? Number((actual - est).toFixed(1)) : null,
    contactPerson: r.contactPerson,
    householdsCutOff: num(r.affectedDemography?.householdCount),
    peopleAffected: num(r.affectedDemography?.maleCount) + num(r.affectedDemography?.femaleCount),
    blockedSince: r.dateRoadblockStart,
    reopenedOn: r.dateRoadblockEnd,
    point: latlng(r.point),
    images: (r.images ?? []).filter((u) => typeof u === "string" && u.startsWith("https://")),
  };
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / 3_600_000;
}

// ---------------------------------------------------------------------------
// 6. find_nearby_resources
// ---------------------------------------------------------------------------

// The register holds ~58,650 facilities, so it can never be pulled wholesale in
// a browser. The documented `resourceType` filter is indeed ignored — but the
// snake_case `resource_type` works, and so does `district`. Values in the data
// are the enum names with spaces removed.
export const RESOURCE_TYPES = [
  { slug: "evacuationcentre", label: "evacuation centre" },
  { slug: "openspace", label: "open space" },
  { slug: "health", label: "health facility" },
  { slug: "education", label: "school" },
  { slug: "helipad", label: "helipad" },
  { slug: "communityspace", label: "community space" },
  { slug: "fireengine", label: "fire engine" },
  { slug: "firefightingapparatus", label: "fire fighting apparatus" },
  { slug: "bridge", label: "bridge" },
  { slug: "roadway", label: "roadway" },
  { slug: "waterway", label: "waterway" },
  { slug: "watersupply", label: "water supply" },
  { slug: "sanitation", label: "sanitation" },
  { slug: "electricity", label: "electricity" },
  { slug: "communication", label: "communication" },
  { slug: "finance", label: "bank or finance" },
  { slug: "governance", label: "government office" },
  { slug: "industry", label: "industry" },
  { slug: "energy", label: "energy" },
  { slug: "cultural", label: "cultural site" },
  { slug: "hotelandrestaurant", label: "hotel or restaurant" },
  { slug: "warehouse", label: "warehouse" },
];

/** "evacuation centre", "Evacuation Centre", "evacuationcentre" → "evacuationcentre" */
export function resourceSlug(type) {
  if (!type) return null;
  const q = String(type).toLowerCase().replace(/[^a-z]/g, "");
  const exact = RESOURCE_TYPES.find((t) => t.slug === q);
  if (exact) return exact.slug;
  const byLabel = RESOURCE_TYPES.find(
    (t) => t.label.replace(/[^a-z]/g, "") === q || t.slug.includes(q) || q.includes(t.slug)
  );
  return byLabel?.slug ?? q;
}

export const resourceLabel = (slug) =>
  RESOURCE_TYPES.find((t) => t.slug === slug)?.label ?? slug;

/**
 * Facilities near a point — where a person can actually go.
 * Scoped to the containing district so this stays one or two small requests.
 */
export async function find_nearby_resources({ near, lat, lon, type, radiusKm = 15, limit = 20 } = {}) {
  let centre = lat != null && lon != null
    ? { latlon: [Number(lat), Number(lon)], name: "your location" }
    : null;
  if (!centre && near) centre = await resolvePlace(near);
  if (!centre) {
    return {
      summary: `Could not find a place called "${near}". Try a district or municipality name, or drop a pin.`,
      data: [], provenance: [], actions: [],
    };
  }

  const slug = type ? resourceSlug(type) : null;
  const districtId = centre.districtId ?? null;
  const rows = await bipad(
    "resource",
    { resource_type: slug ?? undefined, district: districtId ?? undefined, limit: 500 },
    { pages: districtId ? 4 : 2, snapshotKey: "resources" }
  );

  const data = rows
    .map((r) => {
      const p = latlng(r.point);
      return {
        id: r.id, title: r.title, titleNe: r.titleNe,
        type: r.resourceType, label: resourceLabel(r.resourceType), point: p,
        km: p ? Number(distanceKm(centre.latlon, p).toFixed(1)) : null,
      };
    })
    .filter((r) => r.point && r.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);

  const byType = {};
  for (const r of data) byType[r.type] = (byType[r.type] ?? 0) + 1;

  return {
    summary: data.length
      ? `${data.length} ${slug ? resourceLabel(slug) : "facilit"}${slug ? (data.length === 1 ? "" : "s") : data.length === 1 ? "y" : "ies"} ` +
        `within ${radiusKm} km of ${centre.name} — nearest is ${data[0].title} (${data[0].label}, ${data[0].km} km).`
      : `No registered ${slug ? resourceLabel(slug) : "facility"} within ${radiusKm} km of ${centre.name}. ` +
        `That absence is itself a finding — the register may simply be incomplete there.`,
    data, byType, centre,
    provenance: [
      src("/api/v1/resource/?resource_type=…&district=…",
        "the documented resourceType filter is ignored; resource_type (snake_case) works"),
    ],
    actions: data.length
      ? []
      : [{ verb: `Map ${centre.name} on OpenStreetMap`, tool: "find_mapping_task", args: { place: centre.name } }],
  };
}

// ---------------------------------------------------------------------------
// 7. find_coverage_gaps — the question no dashboard asks
// ---------------------------------------------------------------------------

/**
 * Municipalities with recorded incidents but no registered facility of a given
 * type. Dashboards show what exists; this asks what is missing.
 */
export async function find_coverage_gaps({
  hazard = "flood", resourceType = "evacuation centre", district,
  since = "2020-01-01", minIncidents = 1,
} = {}) {
  const h = findHazard(hazard);
  const d = district != null ? findDistrict(district) : null;
  const slug = resourceSlug(resourceType);

  const [incidents, resources] = await Promise.all([
    bipad(
      "incident",
      {
        expand: "loss", hazard: h?.id, district: d?.id,
        incident_on__gt: isoDate(since), ordering: "-incident_on", limit: 500,
      },
      { pages: 8, snapshotKey: "incidents" }
    ),
    // Nationwide, but one type only — 390 evacuation centres, not 58,650 rows.
    bipad("resource", { resource_type: slug, limit: 500 }, { pages: 4, snapshotKey: "resources" }),
  ]);

  const { municipalities, districts } = ref();

  // Which municipalities hold a facility of the wanted type?
  const covered = new Set();
  for (const r of resources) {
    const p = latlng(r.point);
    if (!p) continue;
    const m = nearestMunicipality(p, municipalities);
    if (m) covered.add(m.id);
  }

  // Which municipalities recorded the hazard?
  const affected = new Map();
  for (const inc of incidents) {
    const m = incidentMunicipality(inc);
    if (!m) continue;
    const b = affected.get(m.id) ?? { municipality: m, incidents: 0, deaths: 0, affected: 0, lastIncident: null };
    b.incidents++;
    b.deaths += num(inc.loss?.peopleDeathCount);
    b.affected += num(inc.loss?.peopleAffectedCount);
    if (!b.lastIncident || inc.incidentOn > b.lastIncident) b.lastIncident = inc.incidentOn;
    affected.set(m.id, b);
  }

  const gaps = [...affected.values()]
    .filter((b) => b.incidents >= minIncidents && !covered.has(b.municipality.id))
    .map((b) => ({
      municipality: b.municipality.en,
      municipalityNe: b.municipality.ne,
      district: districts.get(b.municipality.district)?.en ?? null,
      point: b.municipality.centroid,
      incidents: b.incidents,
      deaths: b.deaths,
      peopleAffected: b.affected,
      lastIncident: b.lastIncident,
    }))
    .sort((a, b) => b.deaths - a.deaths || b.incidents - a.incidents);

  return {
    summary:
      `${gaps.length} of ${affected.size} municipalities with recorded ${h?.en ?? hazard} incidents since ` +
      `${isoDate(since)} have no registered ${resourceLabel(slug)} in the national record ` +
      `(${resources.length} exist nationwide, covering ${covered.size} municipalities)` +
      (gaps[0] ? `. Worst: ${gaps[0].municipality} — ${gaps[0].incidents} incidents, ${gaps[0].deaths} deaths.` : "."),
    data: gaps,
    totals: {
      municipalitiesWithIncidents: affected.size,
      municipalitiesWithoutFacility: gaps.length,
      facilitiesNationwide: resources.length,
      municipalitiesCovered: covered.size,
    },
    caveat:
      "Absence from BIPAD's resource register is not proof the facility does not exist — " +
      "it may simply be unregistered. That gap in the record is itself worth knowing." +
      (partialCaveat(incidents, resources) ? " " + partialCaveat(incidents, resources) : ""),
    provenance: [
      src("/api/v1/incident/ + /api/v1/resource/",
        "two endpoints joined client-side; no API supports this question"),
    ],
    actions: gaps[0]
      ? [
          { verb: `Map ${gaps[0].municipality} on OpenStreetMap`, tool: "find_mapping_task", args: { place: gaps[0].district } },
          { verb: "See who is affected there", tool: "get_casualty_breakdown", args: { hazard, district: gaps[0].district, groupBy: "municipality" } },
        ]
      : [],
  };
}

function nearestMunicipality(latlon, municipalities) {
  let best = null, bestD = Infinity;
  for (const m of municipalities.values()) {
    if (!m.centroid) continue;
    const dist = distanceKm(latlon, m.centroid);
    if (dist < bestD) { bestD = dist; best = m; }
  }
  // Beyond ~25 km from any centroid the assignment is not trustworthy.
  return bestD <= 25 ? best : null;
}

// ---------------------------------------------------------------------------
// 8. get_global_alert_status
// ---------------------------------------------------------------------------

export async function get_global_alert_status({ from = "2015-01-01", to, types = "FL,EQ,TC,DR" } = {}) {
  const fc = await gdacsEvents({ from: isoDate(from), to: isoDate(to ?? Date.now()), types });

  const events = (fc.features ?? [])
    .map((f) => {
      const p = f.properties ?? {};
      return {
        eventId: p.eventid,
        type: p.eventtype,
        name: p.eventname || p.name || p.description,
        alertLevel: p.alertlevel,
        glide: p.glide,
        from: p.fromdate,
        to: p.todate,
        severity: p.severitydata?.severitytext ?? null,
        point: latlng(f.geometry),
        url: `https://www.gdacs.org/report.aspx?eventid=${p.eventid}&eventtype=${p.eventtype}`,
        cap: `https://www.gdacs.org/contentdata/resources/${p.eventtype}/${p.eventid}/cap_${p.eventid}.xml`,
      };
    })
    .sort((a, b) => new Date(b.from) - new Date(a.from));

  const current = events.filter((e) => new Date(e.to) >= new Date(Date.now() - 7 * 86_400_000));

  return {
    summary:
      `${events.length} GDACS event${events.length === 1 ? "" : "s"} for Nepal since ${isoDate(from)}` +
      (current.length
        ? `. Currently active: ${current.map((e) => `${e.name || e.type} — ${e.alertLevel}`).join(", ")}.`
        : "."),
    data: events,
    current,
    provenance: [
      {
        endpoint: "gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
        source: "GDACS — European Commission, UN OCHA and UNOSAT (CC BY 4.0)",
        retrievedAt: new Date().toISOString(),
        note: "Indicative global alert levels, not a national warning",
      },
    ],
    actions: [{ verb: "See the incidents on the ground", tool: "query_incidents", args: { hazard: "flood", since: daysAgo(14) } }],
  };
}

export async function get_event_geometry(eventId = LIVE_EVENT.gdacsEventId) {
  return gdacsGeometry(eventId);
}

// ---------------------------------------------------------------------------
// 9. find_mapping_task — the flywheel
// ---------------------------------------------------------------------------

// tasks.hotosm.org/api/v2/* returns 403 to browser requests (bot protection),
// so this is curated from the official activation record. Deep links work.
const HOT_CAMPAIGN = {
  name: "2026 Nepal Floods",
  hashtag: "#nepal-flood-2026-trisuli-bhotekoshi",
  explore: "https://tasks.hotosm.org/explore?campaign=2026%20Nepal%20Floods",
  activationRecord: "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Nepal_Floods_2026",
  learn: "https://learnosm.org/",
  swipe: "https://mapswipe.org/en/",
  dataExport: "https://data.humdata.org/dataset/hot_flood_npl",
  coordinatedBy: "Humanitarian OpenStreetMap Team (HOT), with NAXA and NDRRMA",
  openedOn: "2026-08-27",
  projects: [
    { id: 62970, title: "Nepal Floods 2026 — Rasuwa / Bhote Koshi corridor", districts: ["Rasuwa", "Nuwakot", "Dhading", "Gorkha"] },
  ],
};

export async function find_mapping_task({ place, district } = {}) {
  const target = place ?? district ?? null;
  const match = target
    ? HOT_CAMPAIGN.projects.find((p) =>
        p.districts.some((d) => d.toLowerCase() === String(target).toLowerCase()))
    : null;
  const project = match ?? HOT_CAMPAIGN.projects[0];

  return {
    summary:
      `HOT, NAXA and NDRRMA opened the "${HOT_CAMPAIGN.name}" mapping campaign on 27 Aug 2026 for this flood` +
      (match ? `, and it covers ${target}` : "") +
      `. Project #${project.id} — ${project.title}. Fifteen minutes of tracing buildings improves the same ` +
      `OpenStreetMap data this app queries, so the next answer is better than this one.`,
    data: { ...HOT_CAMPAIGN, suggested: { ...project, url: `https://tasks.hotosm.org/projects/${project.id}` } },
    provenance: [
      {
        endpoint: HOT_CAMPAIGN.activationRecord,
        source: "OpenStreetMap organised-editing activation record; campaign coordinated by HOT with NAXA and NDRRMA",
        retrievedAt: new Date().toISOString(),
        note: "HOT's REST API blocks browser requests, so this project list is curated — re-check before a demo",
      },
    ],
    actions: [
      { verb: `Open mapping task #${project.id}`, href: `https://tasks.hotosm.org/projects/${project.id}` },
      { verb: "Browse the whole campaign", href: HOT_CAMPAIGN.explore },
      { verb: "Learn to map first (15 min)", href: HOT_CAMPAIGN.learn },
    ],
  };
}

// ---------------------------------------------------------------------------
// 10. get_verified_donation_channels
// ---------------------------------------------------------------------------

const CHANNELS = [
  { name: "IFRC Emergency Appeal MDRNP022", url: "https://donate.redcrossredcrescent.org/ifrc/nepal-flash-floods/", note: "CHF 25M appeal; funds route to Nepal Red Cross", scope: "international" },
  { name: "Nepal Red Cross Society", url: "https://donation.nrcs.org/", note: "Direct; accepts NPR and USD via Khalti, eSewa and ConnectIPS", scope: "nepal" },
  { name: "PM Disaster Relief Fund", url: "https://opmcm.gov.np/content/586/heartfelt-appeal/", note: "Official government appeal; international portal at pmdrf.nchl.com.np", scope: "government" },
  { name: "GlobalGiving Nepal Flood Relief", url: "https://www.globalgiving.org/projects/nepal-flood-relief-fund/", note: "Charity Navigator four-star", scope: "international" },
  { name: "UNICEF Nepal Flash Flood Appeal", url: "https://www.unicef.org.au/donate/nepal-flash-flood-appeal-2026", note: "Child-focused response", scope: "international" },
];

const FRAUD_SIGNS = [
  "A personal eSewa or Khalti wallet number posted on social media, with no registered organisation behind it.",
  "Urgency plus a payment link, and no account of where earlier money went.",
  "A domain registered in the last few days, or one that looks almost like a real charity's.",
  "Requests to pay in cryptocurrency or gift cards.",
  "Photographs reused from an earlier disaster — reverse-image search them.",
];

export async function get_verified_donation_channels({ scope } = {}) {
  const data = scope ? CHANNELS.filter((c) => c.scope === scope) : CHANNELS;
  return {
    summary:
      `${data.length} verified channels, each URL checked live on 30 Aug 2026. ` +
      "The Kathmandu Post reported fundraising fraud within 72 hours of this flood, so the warning signs are listed alongside.",
    data,
    fraudWarning: FRAUD_SIGNS,
    provenance: [{ endpoint: "curated", source: "Each URL verified live 30 Aug 2026", retrievedAt: new Date().toISOString() }],
    actions: data.map((c) => ({ verb: `Donate — ${c.name}`, href: c.url })),
  };
}

// ---------------------------------------------------------------------------
// 11. compose_cap_alert
// ---------------------------------------------------------------------------

/**
 * Build a CAP v1.2 document from a live gauge reading. This produces a
 * shareable, standards-compliant artifact. It sends nothing to anyone.
 */
export async function compose_cap_alert({ station, urgency, severity, certainty } = {}) {
  const { data: stations } = await get_river_status({});
  const s = station
    ? stations.find((x) => (x.title ?? "").toLowerCase().includes(String(station).toLowerCase()))
    : stations.find((x) => x.severity === "danger")
      ?? stations.find((x) => x.severity === "warning")
      ?? stations[0];

  if (!s) return { summary: "No gauge reading available to compose an alert from.", data: null, provenance: [], actions: [] };

  const auto = s.severity === "danger" ? "Severe" : s.severity === "warning" ? "Moderate" : "Minor";
  const sent = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
  const identifier = `sankatsathi-${s.station ?? s.id}-${Date.now()}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>sankatsathi.unofficial</sender>
  <sent>${sent}</sent>
  <status>Exercise</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>Unofficial. Generated from public DHM gauge data republished by BIPAD (NDRRMA). Not a warning issued by any authority.</note>
  <info>
    <language>en-US</language>
    <category>Met</category>
    <event>River level ${s.severity === "danger" ? "above danger level" : "above warning level"}</event>
    <urgency>${urgency ?? (s.trend === "RISING" ? "Expected" : "Future")}</urgency>
    <severity>${severity ?? auto}</severity>
    <certainty>${certainty ?? "Observed"}</certainty>
    <senderName>SankatSathi (unofficial)</senderName>
    <headline>${xmlEscape(s.title)} at ${s.waterLevel} m${s.dangerLevel ? ` (danger level ${s.dangerLevel} m)` : ""}</headline>
    <description>Observed water level ${s.waterLevel} m at ${xmlEscape(s.title)}${s.basin ? `, ${xmlEscape(s.basin)} basin` : ""}, recorded ${s.observedAt}. Trend: ${s.trend ?? "unknown"}. Warning level ${s.warningLevel ?? "not published"} m; danger level ${s.dangerLevel ?? "not published"} m.</description>
    <instruction>This is not an official warning. For official information contact the Department of Hydrology and Meteorology, or call 1149 (National Emergency Operation Centre) or 1155 (flood alert).</instruction>
    <web>https://bipadportal.gov.np/</web>
    <area>
      <areaDesc>${xmlEscape(s.title)}${s.basin ? `, ${xmlEscape(s.basin)} basin` : ""}, Nepal</areaDesc>${
        s.point ? `\n      <circle>${s.point[0].toFixed(4)},${s.point[1].toFixed(4)} 10</circle>` : ""
      }
    </area>
  </info>
</alert>`;

  return {
    summary:
      `CAP v1.2 alert drafted for ${s.title} — ${s.waterLevel} m, ${s.severity}. ` +
      `Status is "Exercise": this is a document you can share, not a broadcast.`,
    data: { station: s, xml, identifier },
    provenance: [src("/api/v1/river/", "CAP v1.2 per OASIS; cross-check against GDACS's own CAP XML for the same event")],
    actions: [{ verb: "Copy the CAP XML", tool: null }],
  };
}

function xmlEscape(s) {
  return String(s ?? "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Turn a place name into a point. Tries the official admin hierarchy first,
 * then OSM Nominatim — people name settlements ("Dhunche") that are not
 * municipalities, and those are exactly the places that matter in a flood.
 */
export async function resolvePlace(name) {
  if (!name) return null;
  if (Array.isArray(name) && name.length === 2) {
    return { latlon: name, name: "that point", ...containingAdmin(name) };
  }

  const m = findMunicipality(name);
  if (m?.centroid) {
    return { latlon: m.centroid, name: m.en, nameNe: m.ne, kind: "municipality", id: m.id, districtId: m.district };
  }
  const d = findDistrict(name);
  if (d?.centroid) {
    return { latlon: d.centroid, name: d.en, nameNe: d.ne, kind: "district", id: d.id, districtId: d.id };
  }
  return geocode(name);
}

const geocodeCache = new Map();

/**
 * Resolve a settlement name that is not an admin unit — "Dhunche", "Panauti".
 *
 * BIPAD's own facility register is tried first: its 58,650 entries are named
 * after the places they sit in ("Dhunche Pharmacy"), which makes it an accurate
 * in-country gazetteer and keeps the demo on APIs we already depend on.
 * Nominatim is the fallback, and it is allowed to fail.
 */
async function geocode(name) {
  const key = String(name).toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  let result = null;
  try {
    const rows = await bipad("resource", { search: name, limit: 5 });
    const hit = rows.find((r) => latlng(r.point));
    if (hit) {
      const latlon = latlng(hit.point);
      result = { latlon, name: titleCase(name), kind: "settlement", via: hit.title, ...containingAdmin(latlon) };
    }
  } catch {
    // fall through to Nominatim
  }

  if (!result) {
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=np&q=" +
        encodeURIComponent(name);
      const rows = await getJSON(url, { timeout: 10_000 });
      const hit = rows?.[0];
      if (hit) {
        const latlon = [Number(hit.lat), Number(hit.lon)];
        result = { latlon, name: String(hit.display_name).split(",")[0], kind: "osm", ...containingAdmin(latlon) };
      }
    } catch {
      result = null; // geocoding is a convenience; never fail the whole query on it
    }
  }

  geocodeCache.set(key, result);
  return result;
}

const titleCase = (s) =>
  String(s).replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Nearest district/municipality centroid to a point, for scoping API filters. */
function containingAdmin(latlon) {
  const { municipalities, districts } = ref();
  const m = nearestMunicipality(latlon, municipalities);
  const d = m ? districts.get(m.district) : null;
  return m ? { municipalityId: m.id, districtId: m.district, district: d?.en ?? null } : {};
}

function followUpActions(incidents) {
  const first = incidents[0];
  if (!first) return [];
  return [
    { verb: "Check the rivers nearby", tool: "get_river_status", args: { district: first.district } },
    { verb: "Find where to shelter", tool: "find_nearby_resources", args: { near: first.municipality ?? first.district, type: "evacuation centre" } },
    { verb: "Help map this area", tool: "find_mapping_task", args: { place: first.district } },
  ];
}

export const TOOLS = {
  query_incidents, get_casualty_breakdown, get_river_status, get_flood_forecast,
  get_road_closures, find_nearby_resources, find_coverage_gaps,
  get_global_alert_status, find_mapping_task, get_verified_donation_channels,
  compose_cap_alert,
};

export { HAZARD };
