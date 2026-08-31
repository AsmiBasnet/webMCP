// WebMCP: drive the page through document.modelContext and assert the screen
// actually moved. Every call below goes through executeTool with a JSON string,
// exactly as Chrome's agent would — nothing here reaches into app internals.
//
//   npm run serve            # in one terminal
//   npm run test:webmcp
//
// In a Chrome with chrome://flags/#enable-webmcp-testing enabled these same
// calls run against the native API; here they run against the page's shim,
// which is reported in the header line below.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });

// Copernicus EMS sends no Access-Control-Allow-Origin, so without a deployed
// proxy the browser logs a CORS failure and the app falls back to its snapshot.
// Designed behaviour, asserted by dash-test — not a defect here.
const EXPECTED = /rapidmapping\.emergency\.copernicus\.eu|net::ERR_FAILED/;
const errs = [];
p.on("console", (m) => m.type() === "error" && !EXPECTED.test(m.text()) && errs.push(m.text()));
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));

await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForFunction(() => document.querySelectorAll("#rows .row").length > 0, { timeout: 60000 });
await p.waitForFunction(() => window.SankatSathi?.webmcp, { timeout: 30000 });

const call = (name, args = {}) =>
  p.evaluate(
    ([n, a]) => document.modelContext.executeTool(n, a),
    [name, JSON.stringify(args)]
  );

const rows = () => p.$$eval("#rows .row", (e) => e.length);
const view = () =>
  p.evaluate(() => {
    const f = window.SankatSathi.state.filters;
    return {
      days: f.days,
      sources: [...f.sources],
      severities: [...f.severities],
      district: f.district,
      kind: f.kind,
      search: f.search,
      sort: f.sort,
      selected: window.SankatSathi.state.selected,
      daysControl: document.querySelector("#f-days").value,
      sortControl: document.querySelector("#f-sort").value,
      searchControl: document.querySelector("#f-search").value,
      detailOpen: !!document.querySelector("#detail h2"),
      chipsOn: [...document.querySelectorAll("#f-sources .chip.on")].map((c) => c.dataset.src),
    };
  });

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// --- discovery -------------------------------------------------------------
const impl = await p.evaluate(() => ({
  native: !document.modelContext.shim,
  registered: window.SankatSathi.webmcp.registered,
}));
console.log(`\nmodelContext: ${impl.native ? "native" : "page shim (no WebMCP in this browser)"}`);

const tools = await p.evaluate(async () =>
  (await document.modelContext.getTools()).map((t) => ({
    name: t.name,
    readOnly: t.annotations?.readOnlyHint ?? false,
    props: Object.keys(t.inputSchema?.properties ?? {}),
  }))
);
console.log("\n-- registered tools --");
for (const t of tools) console.log(`  ${t.readOnly ? "read " : "WRITE"}  ${t.name}(${t.props.join(", ")})`);
check("eleven tools registered", tools.length === 11, `${tools.length}`);
check("every tool has a description", await p.evaluate(async () =>
  (await document.modelContext.getTools()).every((t) => (t.description ?? "").length > 80)));
check("no tool surface leaked into the UI", await p.evaluate(() =>
  !/webmcp|modelContext|tool/i.test(document.querySelector("header").textContent)));

// --- read tools ------------------------------------------------------------
console.log("\n-- read tools --");
const summary = await call("get_situation_summary");
console.log(summary.split("\n")[0]);
check("get_situation_summary counts records", /\d+ records in the last/.test(summary));
check("summary names its sources", /"bySource"/.test(summary));

const health = await call("get_source_health");
check("get_source_health reports all six", (health.match(/"status"/g) ?? []).length === 6);
check("snapshot fallback disclosed, not hidden", /"snapshot"|"unreachable"|All 6 sources answered live/.test(health));

const options = await call("list_filter_options");
const districts = JSON.parse(options.slice(options.indexOf("{"), options.lastIndexOf("}") + 1)).districts;
check("list_filter_options returns districts", districts.length > 0, `${districts.length}`);

const listing = await call("list_records", { limit: 3 });
const ids = [...listing.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
check("list_records returns ids", ids.length === 3, ids.join(", "));

const detail = await call("get_record_details", { id: ids[0] });
check("get_record_details resolves an id", !/No record with id/.test(detail));
const missing = await call("get_record_details", { id: "incident:does-not-exist" });
check("unknown id fails honestly", /No record with id/.test(missing));

// The cross-source tool: one district, every source that has anything to say
// about it, and the divergences between them stated rather than smoothed over.
const xdistrict = districts[0].name;
const xref = await call("cross_reference_district", { district: xdistrict });
console.log("  " + xref.split(String.fromCharCode(10))[0]);
check(`cross_reference_district answers for ${xdistrict}`, new RegExp(`^${xdistrict}: [0-9]+ records across`).test(xref));
check("...naming how many of the six sources spoke", /records across \d+ of 6 sources/.test(xref));
check("...and separating national alerts from district records",
  /"nationalAlerts"/.test(xref) && (!/"scope"/.test(xref) || /national — GDACS scopes to the country/.test(xref)));
check("...and carrying a divergence list", /"divergence"/.test(xref));
const empty = await call("cross_reference_district", { district: "Nowhere" });
check("a district with no records is not reported as calm",
  /not the same as nothing having happened/.test(empty));

const before = await view();
check("read tools changed nothing on screen", JSON.stringify(before) === JSON.stringify(await view()));

// --- write tools: the page must actually move ------------------------------
console.log("\n-- write tools: does the page change? --");

const rows0 = await rows();
await call("filter_records", { sources: ["road"] });
const rows1 = await rows();
const v1 = await view();
check("filter_records narrows the list", rows1 < rows0, `${rows0} → ${rows1} rows`);
check("...and only the road chip is lit", v1.chipsOn.join() === "road", v1.chipsOn.join());
check("...and every visible row is a road", await p.$$eval("#rows .row .tag", (e) =>
  e.every((x) => x.textContent.trim() === "Roads")));

await call("filter_records", { sort: "severity" });
check("filter_records moves the sort control", (await view()).sortControl === "severity");

await call("filter_records", { sources: ["incident", "river", "road", "alert", "forecast", "damage"], search: "flood" });
const v2 = await view();
check("search text lands in the search box", v2.searchControl === "flood", v2.searchControl);
check("...and the rows match it", await p.$$eval("#rows .row", (e) =>
  e.length === 0 || e.every((x) => /flood/i.test(x.textContent))));

await call("filter_records", { search: "" });
const dName = districts[0].name;
await call("filter_records", { district: dName });
check(`district filter applies (${dName})`, (await view()).district === dName);
check("...and the rows agree", await p.$$eval("#rows .row .row-where", (e) => e.map((x) => x.textContent.trim()))
  .then((w) => w.every((x) => x === dName)));

const target = (await p.evaluate((d) => {
  const r = window.SankatSathi.state.records.find((x) => x.district === d && x.point);
  return r ? r.id : null;
}, dName)) ?? ids[0];

await call("select_record", { id: target });
const v3 = await view();
check("select_record opens the detail panel", v3.detailOpen && v3.selected === target, target);
check("...and the panel names the record", await p.evaluate((id) => {
  const r = window.SankatSathi.state.records.find((x) => x.id === id);
  return document.querySelector("#detail h2").textContent.trim() === r.title;
}, target));

const focused = await call("focus_map", { lat: 28.16, lon: 85.35, zoom: 12 });
check("focus_map moves the map", /Map centred on 28\.1600, 85\.3500/.test(focused));
check("...to the zoom asked for", /"zoom": 12/.test(focused), focused.match(/"zoom": \d+/)?.[0]);
check("...leaving the list alone", (await view()).district === dName);
await call("focus_map", { whole: true });
check("focus_map can zoom back out", /whole of Nepal/.test(await call("focus_map", { whole: true })));

await call("select_record", {});
check("select_record with no id closes the panel", !(await view()).detailOpen);

const wide = await call("filter_records", { window: 7 });
const v4 = await view();
check("window change refetches", /refetched/.test(wide) && v4.days === 7);
check("...and moves the window control", v4.daysControl === "7", v4.daysControl);

await call("reset_view");
const v5 = await view();
check("reset_view restores the defaults",
  v5.sources.length === 6 && !v5.severities.includes("normal") && !v5.district && !v5.search && !v5.selected);

const refreshed = await call("refresh_data");
check("refresh_data refetches and reports source health", /Refetched\./.test(refreshed) && /"sources"/.test(refreshed));

// --- honesty ---------------------------------------------------------------
console.log("\n-- honesty --");
check("every result carries the no-authority footer",
  [summary, health, listing, detail, refreshed, xref].every((t) => /issues no warnings and dispatches nothing/.test(t)));
check("write tools declare themselves as write",
  tools.filter((t) => !t.readOnly).map((t) => t.name).sort().join() ===
  "filter_records,focus_map,refresh_data,reset_view,select_record");

check("no console errors", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
