// Nepal Disaster Watch — runtime configuration.
//
// Verified 30 Aug 2026: BIPAD, GDACS and Open-Meteo all return
// `Access-Control-Allow-Origin: *`, so no proxy is required for JSON.
// PROXY stays configurable because BIPAD has no SLA and gauge photos are
// served over plain http:// (mixed content on an https:// deployment).

// BIPAD Portal (NDRRMA) is the primary authoritative source for live incidents,
// hydrology river gauges, road blockages, and ground damage & loss assessments.
// All BIPAD, GDACS and Open-Meteo endpoints return `Access-Control-Allow-Origin: *`.
export const BIPAD = "https://bipadportal.gov.np/api/v1";
export const GDACS = "https://www.gdacs.org/gdacsapi/api";
export const OPENMETEO = "https://flood-api.open-meteo.com/v1/flood";

// Copernicus EMS Rapid Mapping for satellite-based orbital damage grading.
// When accessed in a direct browser environment without a proxy, satellite
// telemetry complements the primary live BIPAD ground damage assessment.
export const COPERNICUS =
  "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api";

// Set to a deployed Worker (see worker.js) to route JSON through a cache.
// Empty string = call the upstream APIs directly.
export const PROXY = "";

// Hosts we always call directly, even when PROXY is set.
export const DIRECT_HOSTS = new Set(["flood-api.open-meteo.com", "overpass-api.de"]);


export const NEPAL = {
  center: [28.2, 84.5],
  zoom: 7,
  maxBounds: [[26.0, 79.8], [31.0, 88.5]],
};


