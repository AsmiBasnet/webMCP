// Prove the view survives every upstream going down.
//
// dash-test covers a mid-session outage — this covers the harder case: the
// sources are unreachable before the first byte is fetched, so there is no
// "last good reading" to fall back on. Everything on screen has to come from
// the build-time snapshot, and the page has to say so.

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });

const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));

// Kill every upstream. Only local files and map tiles survive.
for (const host of [
  "**://bipadportal.gov.np/**",
  "**://www.gdacs.org/**",
  "**://flood-api.open-meteo.com/**",
  "**://rapidmapping.emergency.copernicus.eu/**",
]) await p.route(host, (r) => r.abort());

await p.goto(`${BASE}?mode=snapshot`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForFunction(
  () => document.querySelectorAll("#rows .row").length > 0,
  null,
  { timeout: 90000 }
);

const rows = await p.$$eval("#rows .row", (e) => e.length);
const perSource = await p.evaluate(() =>
  Object.fromEntries(["incident", "river", "road", "alert", "forecast", "damage"].map((s) =>
    [s, window.SankatSathi.state.records.filter((r) => r.source === s).length])));

console.log("records from snapshot:", rows);
console.log("per source:", perSource);
console.log("sources with data:", Object.values(perSource).filter((v) => v > 0).length, "of 6");

const status = (await p.textContent("#status")).replace(/\s+/g, " ").trim();
console.log("status:", status);
console.log("declares itself stale:", /snapshot|stale|not live/.test(status));

// The one thing that must never happen offline: a screen that looks live.
console.log("does NOT claim to be live:", !/Fetched live/.test(status));

// Filters must still work over snapshot data — they are pure and local.
await p.click('[data-sev="normal"]');
await p.waitForTimeout(300);
console.log("filters still work offline:", (await p.$$eval("#rows .row", (e) => e.length)) > rows);

console.log("overflow:", await p.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth));
console.log("errors:", errs.length ? errs : 0);

await b.close();
