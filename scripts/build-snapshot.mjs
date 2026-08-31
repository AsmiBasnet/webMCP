// Capture a local snapshot so a demo survives BIPAD going down.
//
//   node scripts/build-snapshot.mjs
//
// Then open the site with ?mode=snapshot, or just let it fall back: api.js uses
// these files automatically whenever a live fetch fails, and the status bar
// says so rather than passing stale casualty figures off as current.
//
// This is a cache for resilience, not a republication of the dataset. Keys must
// match the `snapshotKey` values used in tools.js.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const BIPAD = "https://bipadportal.gov.np/api/v1";
const OUT = "public/data/snapshot";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n) => iso(Date.now() - n * 86_400_000);

const CAPTURES = [
  ["incidents", `${BIPAD}/incident/?expand=loss&ordering=-incident_on&limit=500&incident_on__gt=${daysAgo(365)}`],
  ["rivers", `${BIPAD}/river/?water_level_on__gt=${daysAgo(2)}&ordering=-water_level_on&limit=500`],
  ["highways", `${BIPAD}/highway/?limit=500`],
  ["resources", `${BIPAD}/resource/?resource_type=evacuationcentre&limit=500`],
  ["gdacs", "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH" +
    `?eventlist=FL,EQ,TC,DR&country=Nepal&fromDate=2015-01-01&toDate=${iso(Date.now())}`],
  // Copernicus EMS sends no CORS header, so the browser cannot reach it
  // directly. Captured here — Node has no such restriction — so the source
  // still has data before anyone deploys the proxy.
  ["copernicus", "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api" +
    "/public-activations-info/?country=Nepal"],
  ["forecast", "https://flood-api.open-meteo.com/v1/flood" +
    "?latitude=28.1100&longitude=85.3000&daily=river_discharge,river_discharge_mean&forecast_days=14&past_days=7"],
];

await mkdir(OUT, { recursive: true });

let failed = 0;

async function capture(key, url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const rows = data.results?.length ?? data.features?.length ?? 1;
    await writeFile(`${OUT}/${key}.json`, JSON.stringify(data));
    console.log(`✓ ${key.padEnd(20)} ${String(rows).padStart(5)} rows`);
    return data;
  } catch (err) {
    failed++;
    console.log(`✗ ${key.padEnd(20)} ${err.message}`);
    return null;
  }
}

for (const [key, url] of CAPTURES) await capture(key, url);

// Copernicus needs a second hop: the list carries no areas of interest and no
// damage statistics, so each open activation's detail is captured under its own
// key. Codes are not known ahead of time, which is why this cannot be a static
// entry in CAPTURES.
const activations = [];
try {
  const list = JSON.parse(await readFile(`${OUT}/copernicus.json`, "utf8"));
  for (const a of (list.results ?? []).filter((x) => !x.closed).slice(0, 3)) {
    activations.push(a.code);
    await capture(
      `copernicus-${a.code}`,
      "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api" +
        `/public-activations/?code=${encodeURIComponent(a.code)}`
    );
  }
} catch {
  // The list capture failed; nothing to follow up on, and it is already counted.
}

await writeFile(
  `${OUT}/manifest.json`,
  JSON.stringify({
    capturedOn: new Date().toISOString(),
    note: "Local cache for demo resilience. Live data is always preferred; the UI states when it is showing this instead.",
    sources: CAPTURES.map(([key, url]) => ({ key, url })),
    copernicusActivations: activations,
  }, null, 2)
);

const attempted = CAPTURES.length + activations.length;
console.log(`\n${attempted - failed}/${attempted} captured into ${OUT}/`);
process.exit(failed === attempted ? 1 : 0);
