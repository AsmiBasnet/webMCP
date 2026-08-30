// The response page: live strip resolves, no console errors, no overflow at
// desktop or phone width. Run against a server on 8787.
import { chromium } from "playwright";
const b = await chromium.launch();
const errs = [];
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("console", m => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", e => errs.push("PAGEERROR " + e.message));
await p.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await p.waitForFunction(() => !document.getElementById("band").textContent.includes("Loading"), { timeout: 40000 });
await p.waitForTimeout(1500);
console.log("BAND:", (await p.textContent("#band")).replace(/\s+/g," ").trim());
console.log("RIVERS:", (await p.textContent("#rivers")).replace(/\s+/g," ").trim().slice(0,300));
console.log("ROADS:", (await p.textContent("#roads")).replace(/\s+/g," ").trim().slice(0,320));
console.log("overflow:", await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
await m.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await m.waitForTimeout(2500);
console.log("mobile overflow:", await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
console.log("errors:", errs.length ? errs : 0);

// The page must be complete without JavaScript. The live strip is the only
// part that needs it, and <noscript> names the phone numbers to call instead.
const nojs = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
const q = await nojs.newPage();
await q.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" });
const t = (await q.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const missing = ["100", "1234", "768", "2,502", "one-door", "pmdrf", "ward office"].filter((k) => !t.includes(k));
console.log("no-JS missing:", missing.length ? missing : "nothing");
console.log("no-JS stuck on 'Loading':", t.includes("Loading"));
console.log("no-JS tel links:", (await q.$$("a[href^='tel:']")).length);
console.log("no-JS overflow:", await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

await b.close();
