// Drive the real page in a real browser: check it boots, that the WebMCP tools
// register against a polyfilled document.modelContext, and that asking a
// question renders an answer.
//
//   node scripts/e2e.mjs [baseUrl]

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787/explore.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

// Stand in for the browser's WebMCP implementation so registration is exercised.
await page.addInitScript(() => {
  const tools = new Map();
  document.modelContext = {
    async registerTool(spec) { tools.set(spec.name, spec); return { name: spec.name }; },
    async getTools() { return [...tools.values()]; },
    async executeTool(name, args) { return tools.get(name).execute(args); },
    addEventListener() {},
  };
  window.__tools = tools;
});

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

console.log(`→ ${BASE}`);
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });

// 1. Tools registered
const registered = await page.evaluate(() => [...window.__tools.keys()]);
console.log(`\nWebMCP tools registered: ${registered.length}`);
console.log(`  ${registered.join(", ")}`);

const agentStatus = await page.textContent("#agent-status");
console.log(`Agent status: ${agentStatus.trim()}`);

// 2. Opening view rendered
await page.waitForSelector(".result .result-summary", { timeout: 60_000 });
const opening = await page.textContent(".result .result-summary");
console.log(`\nOpening view: ${opening.trim().slice(0, 160)}`);
console.log(`Gauge bars drawn: ${await page.locator(".gauge svg").count()}`);
console.log(`Map markers: ${await page.locator(".leaflet-marker-pane *, .leaflet-overlay-pane path").count()}`);

// 3. An agent calls a tool directly — the path that matters for the submission
const gapText = await page.evaluate(async () => {
  const r = await document.modelContext.executeTool("find_coverage_gaps", {
    hazard: "flood", resourceType: "evacuation centre", since: "2023-01-01",
  });
  return r.content[0].text;
});
console.log(`\nAgent tool call → find_coverage_gaps:`);
console.log(gapText.split("\n").slice(0, 3).join("\n"));
console.log(`  (returned ${gapText.length} chars to the agent)`);

// 4. The agent's call must also have rendered into the page
await page.waitForSelector(".result--agent", { timeout: 20_000 });
console.log(`Rendered into page as an agent card: yes`);

// 5. A typed question, end to end
for (const q of [
  "How many people have died in floods in Sindhupalchok since 2015, by year?",
  "Which roads are closed, and how many households are cut off?",
  "Where is the nearest shelter to Dhunche?",
]) {
  await page.fill("#ask-input", q);
  await page.press("#ask-input", "Enter");
  await page.waitForFunction(
    () => !document.querySelector("#ask-submit").disabled,
    null, { timeout: 60_000 }
  );
  const summary = (await page.textContent(".result:not(.result--agent) .result-summary")) ?? "";
  const tool = await page.textContent(".result .result-tool");
  console.log(`\n"${q}"\n  → ${tool.trim()}`);
  console.log(`  ${summary.trim().slice(0, 170)}`);
}

// 6. Actions present — the product bet
const actionCount = await page.locator(".action").count();
console.log(`\nAction buttons on screen: ${actionCount}`);

// 7. Layout sanity
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`Horizontal overflow: ${overflow}px`);

await page.screenshot({ path: "screenshot-desktop.png", fullPage: false });
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(600);
const mobileOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`Mobile overflow (420px): ${mobileOverflow}px`);
await page.screenshot({ path: "screenshot-mobile.png", fullPage: false });

console.log(`\nErrors: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log(`  ${e}`);

await browser.close();
process.exit(errors.length ? 1 : 0);
