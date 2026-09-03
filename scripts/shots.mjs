// Responsive screenshots at every breakpoint the CSS declares, plus the two
// either side of each. Run after `npm run serve`:
//
//   npm run shots                       # live
//   npm run shots -- '?mode=snapshot'   # deterministic, no network
//
// Writes to shots/<size>-<step>.png. A step is a WebMCP call, so the sheet
// shows what an agent's answer looks like on a phone as well as a desk.
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";

const BASE = "http://127.0.0.1:8787/";
const QUERY = process.argv[2] ?? "?mode=snapshot";
const OUT = process.argv[3] ?? "shots";

const SIZES = [
  { name: "mobile-sm", width: 360, height: 780 },
  { name: "mobile", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-lg", width: 1024, height: 900 },
  { name: "laptop", width: 1280, height: 900 },
  { name: "desktop", width: 1600, height: 1000 },
  { name: "wide", width: 1920, height: 1080 },
];

const STEPS = [
  { label: "01-default", calls: [] },
  // A pure read: the readout paints, the view does not move.
  { label: "02-summary", calls: [["get_situation_summary", {}]] },
  // The showcase — six sources cross-referenced for one district, divergences
  // and all, with that district lit on the map above.
  { label: "03-crossref", calls: [["filter_records", { window: 7 }], ["cross_reference_district", { district: "Rasuwa" }]] },
  // A write that moves everything: chips, sort, list and map.
  { label: "04-roads", calls: [["reset_view", {}], ["filter_records", { sources: ["road"], sort: "severity" }]] },
];

// Known-and-designed network noise, not defects:
//  - Copernicus EMS sends no CORS header, so the browser blocks it and the app
//    falls back to its snapshot and says so (asserted by dash-test).
//  - snapshot/alerts.json was never captured; feed.js treats the BIPAD alert
//    feed as a non-fatal supplement to GDACS and catches it deliberately.
//  - favicon.ico is not served by http-server.
const EXPECTED =
  /rapidmapping\.emergency\.copernicus\.eu|net::ERR_FAILED|unpkg\.com|fonts\.googleapis|cdnjs|snapshot\/alerts\.json|favicon\.ico/;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const b = await chromium.launch();
let problems = 0;

for (const size of SIZES) {
  const p = await b.newPage({ viewport: { width: size.width, height: size.height } });
  const errs = [];
  // A failed subresource logs "Failed to load resource: ... 404" with no URL in
  // the text — the URL is only on the message location, so both are tested.
  p.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = m.location()?.url ?? "";
    if (EXPECTED.test(m.text()) || EXPECTED.test(where)) return;
    errs.push(where ? `${m.text()} (${where})` : m.text());
  });
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));

  await p.goto(BASE + QUERY, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForFunction(() => document.querySelectorAll("#rows .row").length > 0, { timeout: 60000 });
  await p.waitForFunction(() => window.NepalDisasterWatch?.webmcp, { timeout: 30000 });

  for (const step of STEPS) {
    for (const [name, args] of step.calls) {
      await p.evaluate(([n, a]) => document.modelContext.executeTool(n, a), [name, JSON.stringify(args)]);
    }
    // The default shot frames the top of the page; the rest frame the command
    // band, since that is what the tool call was supposed to move.
    if (step.calls.length) {
      await p.evaluate(() => document.querySelector("#map-section")?.scrollIntoView({ block: "start" }));
    }
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/${size.name}-${step.label}.png`, fullPage: false });
  }

  // A page that scrolls sideways is broken at that width, whatever it looks
  // like. Elements inside a deliberate horizontal scroller (the source pills,
  // the subnav tabs) are excluded — they are meant to run past the edge, and
  // flagging them would bury the one element that actually widens the document.
  const overflow = await p.evaluate(() => {
    const scrolls = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      }
      return false;
    };
    return {
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      culprits: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2 && !scrolls(el))
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().trim().split(/\s+/)[0]}`),
    };
  });
  const bleeds = overflow.doc > overflow.win + 2;
  if (bleeds || errs.length) problems++;
  console.log(
    `${bleeds || errs.length ? "FAIL" : "PASS"}  ${size.name} ${size.width}x${size.height}` +
    (bleeds ? `  — h-overflow ${overflow.doc}>${overflow.win}: ${overflow.culprits.join(", ")}` : "") +
    (errs.length ? `  — ${errs.length} console error(s): ${errs[0]}` : "")
  );
  await p.close();
}

await b.close();
console.log(`\n${SIZES.length - problems}/${SIZES.length} sizes clean → ${OUT}/`);
process.exit(problems ? 1 : 0);
