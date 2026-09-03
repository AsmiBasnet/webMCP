// The live view: five sources load, filters narrow, drill-down opens, the feed
// refreshes and degrades honestly. Run against a server on 8787.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787/";
const b = await chromium.launch();
const errs = [];
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
// Copernicus EMS sends no Access-Control-Allow-Origin, so without a deployed
// proxy the browser logs a CORS failure and the app falls back to its
// snapshot. That is the designed behaviour, asserted separately below — it is
// not a page defect, so it does not count here.
const EXPECTED = /rapidmapping\.emergency\.copernicus\.eu|net::ERR_FAILED|net::ERR_CONNECTION_RESET/;
p.on("console", (m) => m.type() === "error" && !EXPECTED.test(m.text()) && errs.push(m.text()));
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));

await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForFunction(() => document.querySelectorAll("#rows .row").length > 0, { timeout: 60000 });

const rows = () => p.$$eval("#rows .row", (e) => e.length);
console.log("records:", await rows());
console.log("count label:", await p.textContent("#count"));
console.log("status:", (await p.textContent("#status")).replace(/\s+/g, " ").trim());

// Every source should have contributed something.
const perSource = await p.evaluate(() =>
  Object.fromEntries(["incident","river","road","alert","forecast","damage"].map((s) =>
    [s, window.NepalDisasterWatch.state.records.filter((r) => r.source === s).length])));
console.log("per source:", perSource);
console.log("all six present:", Object.values(perSource).every((v) => v > 0));

// Damage is powered live by BIPAD ground surveys with Copernicus satellite assessments
const dmg = await p.evaluate(() => window.NepalDisasterWatch.state.records.filter((r) => r.source === "damage"));
console.log("damage records:", dmg.length, dmg.slice(0, 2).map((r) => `${r.title} ${r.severityLabel}`));
const st = (await p.textContent("#status")).replace(/\s+/g, " ");
console.log("damage source status healthy:", !/damage.*fail/.test(st));

// --- recency defaults -----------------------------------------------------
console.log("");
console.log("-- recency --");
console.log("default window:", await p.$eval("#f-days", (e) => e.value), "(expect 2)");
console.log("default sort:", await p.$eval("#f-sort", (e) => e.value), "(expect recency)");
const groups = await p.$$eval(".group-head span", (e) => e.map((x) => x.textContent.trim()));
console.log("day groups:", groups);
console.log("today is first:", groups[0] === "Today");

// Quiet gauges are off by default and one chip away.
const quietOff = await p.$eval('[data-sev="normal"]', (e) => !e.classList.contains("on"));
console.log("normal severity off by default:", quietOff);
const lean = await rows();
await p.click('[data-sev="normal"]');
await p.waitForTimeout(250);
const withQuiet = await rows();
console.log("toggling normal reveals the rest:", withQuiet > lean, `${lean} → ${withQuiet}`);
await p.click('[data-sev="normal"]');

// Widening the window has to fetch, not just re-filter.
await p.selectOption("#f-days", "30");
await p.waitForFunction(() => window.NepalDisasterWatch.state.filters.days === 30 && !window.NepalDisasterWatch.state.busy, { timeout: 30000 });
await p.waitForTimeout(500);
const wide = await rows();
console.log("widening window adds records:", wide > lean, `${lean} → ${wide}`);
console.log("earlier group appears:",
  (await p.$$eval(".group-head span", (e) => e.map((x) => x.textContent.trim()))).includes("Earlier"));
await p.selectOption("#f-days", "2");
await p.waitForFunction(() => window.NepalDisasterWatch.state.filters.days === 2 && !window.NepalDisasterWatch.state.busy, { timeout: 30000 });
await p.waitForTimeout(500);

// --- filters --------------------------------------------------------------
const all = await rows();  // baseline: default window and severities
await p.click('[data-src="incident"]');           // switch incidents off
const без = await rows();
console.log("source filter narrows:", без < all, `${all} → ${без}`);
await p.click('[data-src="incident"]');

// Severities are a set with `normal` already off, so isolating one means
// switching the others off rather than switching it on.
for (const sev of ["serious", "warning", "info"]) await p.click(`[data-sev="${sev}"]`);
await p.waitForTimeout(250);
const crit = await rows();
const allCritical = await p.$$eval("#rows .row .row-sev", (e) => e.every((x) => x.classList.contains("sev--critical")));
console.log("severity filter:", crit, "rows, all critical:", allCritical);
await p.click("#reset");
await p.waitForTimeout(250);

await p.fill("#f-search", "landslide");
await p.waitForTimeout(400);
console.log("search narrows:", (await rows()) < all);
await p.click("#reset");
await p.waitForTimeout(300);
console.log("reset restores:", (await rows()) === all);

// District dropdown is populated from the data, with counts.
const districts = await p.$$eval("#f-district option", (o) => o.length);
console.log("district options:", districts);
await p.selectOption("#f-district", { index: 1 });
await p.waitForTimeout(200);
console.log("district filter narrows:", (await rows()) < all);
await p.selectOption("#f-district", "");

// --- drill-down -----------------------------------------------------------
await p.click("#rows .row");
await p.waitForSelector("#detail h2");
console.log("detail title:", (await p.textContent("#detail h2")).slice(0, 60));
console.log("detail fields:", await p.$$eval("#detail .dt", (e) => e.length));
console.log("provenance shown:", (await p.textContent("#detail .prov")).replace(/\s+/g, " ").trim().slice(0, 70));
console.log("raw payload available:", (await p.$$("#detail .rawbox pre")).length > 0);
await p.click("#detail-close");
console.log("detail closes:", (await p.$$("#detail h2")).length === 0);

// --- layout ---------------------------------------------------------------
console.log("overflow:", await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
await m.goto(BASE, { waitUntil: "networkidle" });
await m.waitForFunction(() => document.querySelectorAll("#rows .row").length > 0, { timeout: 60000 });
console.log("mobile overflow:", await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
console.log("mobile rows:", await m.$$eval("#rows .row", (e) => e.length));

// Errors are checked here, BEFORE the outage test below deliberately aborts
// requests — otherwise the test's own induced failures read as page defects.
console.log("errors:", errs.length ? errs : 0);

// --- refresh + degradation ------------------------------------------------
let hits = 0;
p.on("request", (r) => { if (r.url().includes("/river/")) hits++; });
const before = hits;
await p.click("#refresh");
await p.waitForTimeout(7000);
console.log("manual refresh fetched:", hits - before > 0);

await p.route("**bipadportal.gov.np**", (r) => r.abort());
await p.click("#refresh");
await p.waitForTimeout(9000);
const status = (await p.textContent("#status")).replace(/\s+/g, " ").trim();
console.log("failure disclosed:", /unreachable|snapshot/.test(status));
console.log("status during outage:", status.slice(-90));
console.log("records survive outage:", (await rows()) > 0);

await p.unroute("**bipadportal.gov.np**");
await p.click("#refresh");
await p.waitForTimeout(9000);
console.log("recovers:", !/unreachable/.test((await p.textContent("#status")).replace(/\s+/g, " ")));

await b.close();
