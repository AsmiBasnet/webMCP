import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1150 } });
p.on("pageerror", e => console.log("ERR", e.message));
p.on("console", m => m.type()==="error" && console.log("CONSOLE", m.text()));
await p.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForSelector(".result .result-summary", { timeout: 60000 });
const shots = [
  ["Which municipalities have flood incidents but no evacuation centre?", "shot-gaps.png"],
  ["How many people have died in floods across Nepal since 2015, by year?", "shot-casualty.png"],
  ["What is the discharge forecast for Rasuwa?", "shot-forecast.png"],
];
for (const [q, file] of shots) {
  await p.fill("#ask-input", q);
  await p.press("#ask-input", "Enter");
  await p.waitForFunction(() => !document.querySelector("#ask-submit").disabled, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: file });
  console.log(file, "→", (await p.textContent(".result .result-summary")).trim().slice(0,120));
}
await b.close();
