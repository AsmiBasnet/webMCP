// Exercise every tool against the live APIs, outside a browser.
//
//   node scripts/smoke.mjs
//
// The tool modules are written for the browser, so relative fetches
// ("./data/refdata.json") are served from disk here.

import { readFile } from "node:fs/promises";

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === "string" && url.startsWith("./")) {
    const body = await readFile(new URL(url.replace("./", "../public/"), import.meta.url), "utf8");
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};

const { loadRefdata } = await import("../public/js/refdata.js");
const T = await import("../public/js/tools.js");

await loadRefdata();

const cases = [
  ["get_current_situation", { days: 7 }],
  ["get_damage_assessment", {}],
  ["query_incidents", { hazard: "flood", since: "2026-08-20", limit: 200 }],
  ["query_incidents", { district: "Rasuwa", since: "2026-07-01", limit: 100 }],
  ["get_casualty_breakdown", { hazard: "flood", district: "Sindhupalchok", since: "2015-04-01", groupBy: "year", limit: 1000 }],
  ["get_river_status", { onlyElevated: false }],
  ["get_flood_forecast", { place: "Rasuwa" }],
  ["get_road_closures", {}],
  ["find_nearby_resources", { near: "Dhunche", type: "evacuation centre", radiusKm: 40 }],
  ["find_nearby_resources", { near: "Dhunche", radiusKm: 15 }],
  ["find_coverage_gaps", { hazard: "flood", resourceType: "evacuation centre", since: "2023-01-01" }],
  ["get_global_alert_status", { from: "2015-01-01" }],
  ["find_mapping_task", { place: "Rasuwa" }],
  ["get_verified_donation_channels", {}],
  ["compose_cap_alert", {}],
];

let failures = 0;
for (const [name, args] of cases) {
  const started = Date.now();
  try {
    const out = await T[name](args);
    const rows = Array.isArray(out.data) ? out.data.length : out.data ? 1 : 0;
    console.log(`\n✓ ${name}(${JSON.stringify(args)})  ${Date.now() - started}ms  rows=${rows}`);
    console.log(`  ${out.summary}`);
    if (out.totals) console.log(`  totals: ${JSON.stringify(out.totals)}`);
    if (Array.isArray(out.data) && out.data[0]) {
      console.log(`  first: ${JSON.stringify(out.data[0]).slice(0, 240)}`);
    }
  } catch (err) {
    failures++;
    console.log(`\n✗ ${name}  ${Date.now() - started}ms  ${err.message}`);
  }
}

console.log(`\n${cases.length - failures}/${cases.length} tools returned.`);
process.exit(failures ? 1 : 0);
