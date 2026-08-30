// Prove the demo survives the data sources going down.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
// Kill every upstream API. Only local files and tiles survive.
await p.route("**://bipadportal.gov.np/**", r => r.abort());
await p.route("**://www.gdacs.org/**", r => r.abort());
await p.route("**://flood-api.open-meteo.com/**", r => r.abort());
p.on("pageerror", e => console.log("ERR", e.message));
await p.goto("http://127.0.0.1:8787/?mode=snapshot", { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForSelector(".result .result-summary", { timeout: 90000 });
console.log("Opening view:", (await p.textContent(".result .result-summary")).trim().slice(0,150));
for (const q of ["Which roads are closed?", "Which municipalities have flood incidents but no evacuation centre?"]) {
  await p.fill("#ask-input", q); await p.press("#ask-input", "Enter");
  await p.waitForFunction(() => !document.querySelector("#ask-submit").disabled, null, { timeout: 90000 });
  console.log(`"${q}" →`, (await p.textContent(".result .result-summary")).trim().slice(0,140));
}
console.log("Status bar:", (await p.textContent("#data-status")).trim());
await p.screenshot({ path: "shot-snapshot.png" });
await b.close();
