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
// The tools are for agents and for DevTools; the interface must not become a
// console for them. Checked by tool name against the whole rendered page rather
// than by the word "WebMCP" against the nav, which is deliberate branding and
// says nothing about whether a tool surface has leaked into the product.
check("no tool surface leaked into the UI", await p.evaluate((names) => {
  const shown = document.body.innerText;
  return !names.some((n) => shown.includes(n)) && !shown.includes("modelContext");
}, tools.map((t) => t.name)));

// --- read tools ------------------------------------------------------------
console.log("\n-- read tools --");
// Captured before a single read tool runs. Taken afterwards it would only
// prove that view() is stable between two adjacent calls, which no bug could
// ever fail.
const beforeReads = await view();
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
// The id shape in the schema is what an agent will copy. If it does not match
// the ids feed.js actually mints, every constructed id misses.
const shape = await p.evaluate(async () => {
  const t = (await document.modelContext.getTools()).find((x) => x.name === "get_record_details");
  const eg = t.inputSchema.properties.id.description.match(/"(damage:[^"]+)"/)[1];
  const real = window.SankatSathi.state.records.find((r) => r.source === "damage");
  return { eg, real: real ? real.id : null };
});
check("the id example in the schema matches real ids",
  shape.real !== null && shape.eg.split(":").length === shape.real.split(":").length,
  `${shape.eg} vs ${shape.real}`);
check("getTools() survives JSON.stringify", await p.evaluate(async () => {
  try { JSON.stringify(await document.modelContext.getTools()); return true; } catch { return false; }
}));

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

check("read tools changed nothing on screen", JSON.stringify(beforeReads) === JSON.stringify(await view()));
check("get_source_health counts the window, not everything loaded", await p.evaluate(async () => {
  const grab = async (n) => JSON.parse((await document.modelContext.executeTool(n, "{}")).match(/\{[\s\S]*\}/)[0]);
  const h = await grab("get_source_health");
  const g = await grab("get_situation_summary");
  return h.sources.every((x) => x.records === g.bySource[x.id]);
}));
check("...while still reporting everything loaded", /"loaded":/.test(await call("get_source_health")));

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

// A value the page cannot offer must be refused out loud, not applied quietly.
const beforeBad = await view();
const badDistrict = await call("filter_records", { district: "Nowhereistan" });
check("an unknown district is refused, not applied", (await view()).district === beforeBad.district);
check("...and the refusal says the name matched nothing",
  /matched nothing, not a district where nothing happened/.test(badDistrict));
const badWindow = await call("filter_records", { window: 3 });
check("an off-enum window is refused", (await view()).days === beforeBad.days);
check("...so the Window control never goes blank", (await view()).daysControl !== "");
check("...and the refusal is reported", /"rejected"/.test(badWindow) && /window 3/.test(badWindow));
const badSort = await call("filter_records", { sort: "alphabetical", severities: ["nonsense"] });
check("bad sort and bad severity are both refused",
  (await view()).sortControl === "severity" &&
  /sort .{0,2}alphabetical/.test(badSort) && /severities nonsense/.test(badSort));

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
check("...and only claims the map moved when it did",
  /the map has moved to it/.test(await call("select_record", { id: target })));
// A record with no coordinates must say the map did not move.
const unlocated = await p.evaluate(() => (window.SankatSathi.state.records.find((r) => !r.point) ?? {}).id ?? null);
if (unlocated) {
  const out = await call("select_record", { id: unlocated });
  check("an unlocated record says the map did NOT move", /The map did NOT move/.test(out), unlocated);
  await call("select_record", { id: target });
} else {
  console.log("SKIP  an unlocated record says the map did NOT move — every loaded record has coordinates");
}

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

// Deliberately dirty every default, including the two a reset used to leave
// behind, before asking for the reset.
await call("filter_records", { window: 30, sort: "time", search: "flood" });
await call("reset_view");
const v5 = await view();
check("reset_view restores the defaults",
  v5.sources.length === 6 && !v5.severities.includes("normal") && !v5.district && !v5.search && !v5.selected);
check("...including the window", v5.days === 2 && v5.daysControl === "2", `${v5.days}/${v5.daysControl}`);
check("...including the sort", v5.sort === "recency" && v5.sortControl === "recency", `${v5.sort}/${v5.sortControl}`);

const refreshed = await call("refresh_data");
check("refresh_data refetches and reports source health", /Refetched\./.test(refreshed) && /"sources"/.test(refreshed));
check("...and says so explicitly", /"fetched": true/.test(refreshed));
// Two refreshes fired together must both actually load, in order — an agent
// calling tools in parallel must not be told a fetch happened when its request
// was swallowed by one already in flight.
const both = await p.evaluate(() => Promise.all([
  document.modelContext.executeTool("refresh_data", "{}"),
  document.modelContext.executeTool("filter_records", JSON.stringify({ window: 7 })),
]));
check("concurrent refreshes both report truthfully",
  both.every((t) => !/Refetched/.test(t) || /"fetched": true/.test(t)) && /window=7d \(refetched\)/.test(both[1]));
const v6 = await view();
check("...and the window that was asked for is the window that loaded",
  v6.days === 7 && v6.daysControl === "7", `${v6.days}/${v6.daysControl}`);
await call("reset_view");

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
