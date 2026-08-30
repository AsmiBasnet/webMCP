// SankatSathi — runtime configuration.
//
// Verified 30 Aug 2026: BIPAD, GDACS and Open-Meteo all return
// `Access-Control-Allow-Origin: *`, so no proxy is required for JSON.
// PROXY stays configurable because BIPAD has no SLA and gauge photos are
// served over plain http:// (mixed content on an https:// deployment).

export const BIPAD = "https://bipadportal.gov.np/api/v1";
export const GDACS = "https://www.gdacs.org/gdacsapi/api";
export const OPENMETEO = "https://flood-api.open-meteo.com/v1/flood";

// Set to a deployed Worker (see worker.js) to route JSON through a cache.
// Empty string = call the upstream APIs directly.
export const PROXY = "";

// Hosts we always call directly, even when PROXY is set.
export const DIRECT_HOSTS = new Set(["flood-api.open-meteo.com", "overpass-api.de"]);

// The live event this build was made during.
export const LIVE_EVENT = {
  gdacsEventId: 1104124,
  glide: "FL-2026-000167-NPL",
  name: "Rasuwa / Bhote Koshi flash flood",
  startedOn: "2026-08-26",
  center: [28.11, 85.3],
};

export const NEPAL = {
  center: [28.2, 84.5],
  zoom: 7,
  maxBounds: [[26.0, 79.8], [31.0, 88.5]],
};

// BIPAD hazard ids used often enough to name. Full list loads from /hazard/.
export const HAZARD = { FLOOD: 11, LANDSLIDE: 17, FIRE: 9, EARTHQUAKE: 7 };

// Emergency numbers — rendered as tel: links.
export const EMERGENCY = [
  { number: "100", label: "Police", labelNe: "प्रहरी" },
  { number: "112", label: "Police (mobile)", labelNe: "प्रहरी (मोबाइल)" },
  { number: "102", label: "Ambulance", labelNe: "एम्बुलेन्स" },
  { number: "1149", label: "National Emergency Operation Centre", labelNe: "राष्ट्रिय आपतकालीन कार्य सञ्चालन केन्द्र" },
  { number: "1155", label: "DHM flood alert", labelNe: "बाढी सूचना" },
];
