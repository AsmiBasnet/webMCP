// The one moving part on the response page.
//
// Everything else in index.html is static and stays correct without JavaScript,
// which is deliberate: a person on a degraded connection still gets the phone
// numbers, the missing-person chain and the donation route. This file adds the
// operational layer on top — which rivers are close to their warning mark and
// which roads are cut right now — and fails quietly and visibly if it cannot.

import { loadRefdata } from "./refdata.js";
import { get_river_status, get_road_closures } from "./tools.js";
import { health } from "./api.js";

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const n = (v) => (typeof v === "number" ? v.toLocaleString() : "—");

/** A failure here must never read as "all clear". */
function failed(el, what, err) {
  el.innerHTML =
    `<div class="live-empty">Could not reach the ${esc(what)} feed — ${esc(err.message)}. ` +
    `This is a data-source failure, not an all-clear: it does not mean nothing is happening. ` +
    `Call <a href="tel:1234">1234</a> for your district's emergency centre.</div>`;
}

// ---------------------------------------------------------------------------

async function rivers() {
  const el = $("rivers");
  try {
    const r = await get_river_status({ onlyElevated: false });

    // Only the gauges anyone needs to act on. If none are close, say that
    // plainly rather than padding the list out to look busy.
    const near = r.data
      .filter((s) => s.severity === "danger" || s.severity === "warning" || s.severity === "approaching")
      .slice(0, 8);

    if (!near.length) {
      el.innerHTML =
        `<div class="live-empty">No gauge is within half a metre of its warning level. ` +
        `${r.totals.stations} stations reporting.</div>`;
      return r;
    }

    el.innerHTML = near
      .map((s) => {
        const label =
          s.severity === "danger" ? "above danger"
          : s.severity === "warning" ? "above warning"
          : "nearing warning";
        const gap = s.metresBelowWarning;
        return (
          `<div class="live-row">` +
          `<span class="live-t">${esc(s.title)}` +
          `<span class="dim">${esc(s.basin ?? "")} basin${s.trend ? ` · ${esc(String(s.trend).toLowerCase())}` : ""}</span></span>` +
          `<span class="live-v"><span class="tag tag--${s.severity}">${label}</span> ` +
          `${gap != null && gap > 0 ? `${gap.toFixed(2)} m to go` : `${Math.abs(gap ?? 0).toFixed(2)} m over`}</span>` +
          `</div>`
        );
      })
      .join("");
    return r;
  } catch (err) {
    failed(el, "river gauge", err);
    return null;
  }
}

async function roads() {
  const el = $("roads");
  try {
    const r = await get_road_closures({ currentOnly: true });

    if (!r.data.length) {
      el.innerHTML = `<div class="live-empty">No roadblock is currently in force on the national network.</div>`;
      return r;
    }

    // The register is only as current as the last officer to update it. One
    // entry tonight is a Mechi Highway closure logged on 8 July with a
    // five-hour repair estimate and no reopening time — almost certainly a
    // record nobody closed, not a road cut for seven weeks. Directing someone
    // around a road that reopened in July is as harmful as missing one that is
    // shut, so anything older than its own estimate by this margin is shown
    // with the doubt attached rather than dropped or presented as fact.
    const STALE_DAYS = 7;

    el.innerHTML = r.data
      .slice(0, 8)
      .map((road) => {
        const since = road.blockedSince
          ? new Date(road.blockedSince).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
          : "time not recorded";
        const days = road.blockedSince
          ? Math.floor((Date.now() - new Date(road.blockedSince)) / 86_400_000)
          : null;
        const stale = days != null && days > STALE_DAYS;

        return (
          `<div class="live-row">` +
          `<span class="live-t">${esc(road.title)}` +
          `<span class="dim">${esc(road.location ?? "")} · ${esc(road.closureReason ?? "cause not stated")} · since ${esc(since)}` +
          `${road.repairEta ? ` · ETA ${esc(road.repairEta)}` : ""}</span>` +
          (stale
            ? `<span class="dim">Logged ${days} days ago and never marked reopened — the Department of ` +
              `Roads record may simply be stale. Verify before relying on it.</span>`
            : "") +
          `</span>` +
          `<span class="live-v"><span class="tag tag--${stale ? "approaching" : road.status === "CLOSED" ? "closed" : "approaching"}">` +
          `${stale ? "unverified" : road.status === "CLOSED" ? "closed" : "part open"}</span> ` +
          `${road.householdsCutOff ? `${n(road.householdsCutOff)} households` : ""}</span>` +
          `</div>`
        );
      })
      .join("");
    return r;
  } catch (err) {
    failed(el, "road register", err);
    return null;
  }
}

// ---------------------------------------------------------------------------

function band(river, road) {
  const parts = [];

  if (river) {
    const elevated = river.totals.aboveWarning + river.totals.approaching;
    parts.push(
      `<span><span class="pulse" style="background:var(--${elevated ? "warning" : "good"})"></span>` +
      `<strong>${river.totals.stations}</strong> gauges reporting · ` +
      `<strong>${elevated}</strong> at or near warning</span>`
    );
  }
  if (road) {
    parts.push(
      `<span><strong>${road.totals.closed}</strong> roads closed · ` +
      `<strong>${n(road.totals.householdsCutOff)}</strong> households cut off</span>`
    );
  }
  if (river?.totals.observedAt) {
    const age = Math.round((Date.now() - new Date(river.totals.observedAt)) / 60_000);
    parts.push(`<span class="dim">newest gauge reading ${age} min ago</span>`);
  }

  const down = [...health.failed.keys()];
  if (down.length) {
    parts.push(
      `<span style="color:var(--critical)"><strong>unreachable:</strong> ${down.map(esc).join(", ")}</span>`
    );
  }

  $("band").innerHTML = parts.length
    ? parts.join("")
    : `<span style="color:var(--critical)">Live conditions unavailable — the government data sources could not be reached. ` +
      `The emergency numbers below are unaffected.</span>`;
}

async function boot() {
  try {
    await loadRefdata();
  } catch {
    // Reference data only labels districts; the gauges and roads still resolve
    // without it, so this is not fatal to anything on this page.
  }

  const [river, road] = await Promise.all([rivers(), roads()]);
  band(river, road);

  $("live-asof").textContent =
    `Fetched ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} ` +
    `from bipadportal.gov.np. Reload this page for a fresh reading.`;
}

boot();

// ---------------------------------------------------------------------------
// The corridor map.
//
// Static geography, not live data: where the ice fell, the route the surge
// took down the Trishuli, and the seven districts that buried people. Circles
// are scaled by the square root of the death toll so that AREA carries the
// count — scaling the radius instead would make Chitwan look twenty times
// Rasuwa rather than four.
// ---------------------------------------------------------------------------

// District centroids from the BIPAD admin hierarchy; tolls from Nepal Police
// bulletin 10275. Centroids locate the district, not the deaths within it.
const CORRIDOR_DISTRICTS = [
  { en: "Chitwan", ne: "चितवन", at: [27.5849, 84.4345], deaths: 264 },
  { en: "Nawalparasi East", ne: "नवलपरासी पूर्व", at: [27.6874, 84.0622], deaths: 194 },
  { en: "Nawalparasi West", ne: "नवलपरासी पश्चिम", at: [27.5283, 83.7387], deaths: 100 },
  { en: "Gorkha", ne: "गोरखा", at: [28.3188, 84.7902], deaths: 58 },
  { en: "Nuwakot", ne: "नुवाकोट", at: [27.9151, 85.2354], deaths: 52 },
  { en: "Dhading", ne: "धादिङ्ग", at: [27.9547, 84.9602], deaths: 50 },
  { en: "Tanahu", ne: "तनहुँ", at: [27.9554, 84.2512], deaths: 37 },
  { en: "Rasuwa", ne: "रसुवा", at: [28.1832, 85.4159], deaths: 13 },
];

// The reported route: Langtang Lirung → Rasuwagadhi → down the Bhote Koshi and
// Trishuli → the Narayani across the Chitwan plain. Drawn from the described
// course, not from a surveyed inundation boundary.
const CORRIDOR_PATH = [
  [28.2560, 85.5170], // Langtang Lirung — the collapse
  [28.2810, 85.3780], // Rasuwagadhi / Gyirong border crossing
  [28.1100, 85.2990], // Dhunche
  [27.9600, 85.1800], // Betrawati
  [27.9310, 85.1450], // Trishuli Bazar
  [27.8700, 84.9900], // Devighat
  [27.7700, 84.7500], // Benighat
  [27.8600, 84.5500], // Mugling
  [27.6900, 84.4300], // Narayangadh, Chitwan
  [27.5700, 84.1800], // out onto the plain
  [27.5300, 83.9000], // Nawalparasi
];

const GLACIER = [28.2560, 85.5170];

function corridorMap() {
  const el = $("corridor-map");
  if (!el || typeof L === "undefined") return;

  const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16, attribution: "Tiles &copy; Esri" }
  ).addTo(map);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16 }
  ).addTo(map);

  L.polyline(CORRIDOR_PATH, { color: "#4fc3d9", weight: 3, opacity: 0.85 }).addTo(map);

  for (const d of CORRIDOR_DISTRICTS) {
    L.circleMarker(d.at, {
      radius: Math.max(5, Math.sqrt(d.deaths) * 1.5),
      color: "#d03b3b",
      weight: 1.5,
      fillOpacity: 0.32,
    })
      .bindPopup(
        `<b>${esc(d.en)}</b><br><span class="meta">${esc(d.ne)}</span>` +
        `<br>${d.deaths} confirmed dead` +
        `<br><span class="meta">Nepal Police bulletin 10275</span>`
      )
      .addTo(map);
  }

  L.circleMarker(GLACIER, { radius: 7, color: "#fab219", weight: 2, fillOpacity: 0.5 })
    .bindPopup(
      `<b>Langtang Lirung</b><br><span class="meta">28.256 N, 85.517 E</span>` +
      `<br>Roughly 0.2 km² of ice fell about 1.2 km at 08:40 on 26 August 2026.` +
      `<br><span class="meta">Ms 5.2 — detected worldwide</span>`
    )
    .addTo(map);

  map.fitBounds(L.latLngBounds([...CORRIDOR_PATH, ...CORRIDOR_DISTRICTS.map((d) => d.at)]), {
    padding: [28, 28],
  });
}

corridorMap();
