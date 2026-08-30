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

async function rivers({ force = false } = {}) {
  const el = $("rivers");
  try {
    const r = await get_river_status({ onlyElevated: false, force });

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

async function roads({ force = false } = {}) {
  const el = $("roads");
  try {
    const r = await get_road_closures({ currentOnly: true, force });

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

// ---------------------------------------------------------------------------
// Refresh loop.
//
// There is nothing to subscribe to. BIPAD has no websocket, no server-sent
// events and no webhook — it is a read-only REST API over a Django admin — so
// "real time" here means polling, and the only honest questions are how often
// and how visibly.
//
// The cadence is set by the source, not by what feels live. DHM's gauges report
// every ten minutes; the road register is updated by hand by division officers.
// Polling faster than that would burn a government server that is, at this
// moment, being used to coordinate a flood response, and would return the
// identical body every time. So: fetch every three minutes, and tick the
// displayed age every fifteen seconds so the reader can see the clock running
// between fetches. The liveness a person needs is knowing how old the number
// is — not watching a request fire.
// ---------------------------------------------------------------------------

const REFRESH_MS = 180_000;   // three minutes; DHM publishes every ten
const TICK_MS = 15_000;       // re-render the ages, no network
const BACKOFF_MAX_MS = 900_000;

const state = { river: null, road: null, fetchedAt: null, failures: 0, busy: false };
let timer = null;

async function refresh({ force = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  setStatus("refreshing");

  const [river, road] = await Promise.all([rivers({ force }), roads({ force })]);

  // Keep the last good reading rather than blanking the page on one bad poll.
  // A person looking at a river level needs the old number plus its age far
  // more than they need an empty panel.
  if (river) state.river = river;
  if (road) state.road = road;

  if (river || road) {
    state.fetchedAt = Date.now();
    // A source that answered only from the snapshot has not really answered.
    // Counting it as success would hold the poll at full rate against a server
    // that is failing every request.
    state.failures = health.failed.size ? state.failures + 1 : 0;
  } else {
    state.failures++;
  }

  state.busy = false;
  setStatus("idle");
  render();
  schedule();
}

/** Back off on repeated failure so a struggling server is not hammered. */
function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;   // nothing to refresh for a tab nobody is reading
  const delay = state.failures
    ? Math.min(REFRESH_MS * 2 ** state.failures, BACKOFF_MAX_MS)
    : REFRESH_MS;
  timer = setTimeout(() => refresh(), delay);
}

function render() {
  band(state.river, state.road);
  ages();
}

/**
 * Ages tick locally between fetches — no network, no flicker.
 *
 * This line has to distinguish three states that look identical on screen:
 * a fresh reading, the last good reading after a failed poll, and the built-in
 * snapshot. The third is the dangerous one — `getJSON` falls back to the
 * snapshot when a source is unreachable, so a poll can "succeed" while quietly
 * serving canned data hours old. Saying "fetched 0s ago" over that would be a
 * lie told in the one place the reader looks to check.
 */
function ages() {
  const el = $("live-asof");
  if (!el) return;
  if (!state.fetchedAt) {
    el.textContent = "Not yet fetched.";
    return;
  }

  const secs = Math.round((Date.now() - state.fetchedAt) / 1000);
  const when = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)} min ago`;

  const down = [...health.failed.keys()];
  const onSnapshot = health.snapshot.size > 0;

  if (down.length) {
    el.innerHTML =
      `<strong style="color:var(--critical)">${esc(down.join(", "))} could not be reached ${esc(when)}.</strong> ` +
      (onSnapshot
        ? `The panels above are showing this build's stored snapshot, not current conditions — ` +
          `check the reading times, which will be hours old. `
        : `The panels above are the last readings that arrived, not current ones. `) +
      `Retrying with a longer gap after ${state.failures || 1} failure${(state.failures || 1) === 1 ? "" : "s"}. ` +
      `Call <a href="tel:1234">1234</a> for your district emergency centre.`;
    return;
  }

  el.textContent =
    `Fetched live from bipadportal.gov.np ${when} · ` +
    `refreshing every ${REFRESH_MS / 60_000} minutes while this tab is open.`;
}

function setStatus(what) {
  const btn = $("refresh-now");
  if (btn) {
    btn.disabled = what === "refreshing";
    btn.textContent = what === "refreshing" ? "Refreshing…" : "Refresh now";
  }
}

async function boot() {
  try {
    await loadRefdata();
  } catch {
    // Reference data only labels districts; the gauges and roads still resolve
    // without it, so this is not fatal to anything on this page.
  }

  handEnteredAge();
  await refresh({ force: false });

  setInterval(ages, TICK_MS);

  // A tab left open overnight should not poll all night, and should not show
  // last night's reading when it comes back to the front either.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
    } else if (!state.fetchedAt || Date.now() - state.fetchedAt > REFRESH_MS) {
      refresh();
    } else {
      schedule();
    }
  });

  $("refresh-now")?.addEventListener("click", () => refresh());
}

// ---------------------------------------------------------------------------
// The figures that cannot be live.
//
// The casualty counts on this page are hand-transcribed from a Nepal Police
// bulletin. There is no API behind them: BIPAD's machine-readable record says
// ten deaths for the week, the bulletin says 768, and the bulletin is a press
// release. Nothing here can fix that, so the only responsible thing is to make
// the staleness impossible to miss and say where the current figure lives.
// ---------------------------------------------------------------------------

function handEnteredAge() {
  const el = document.querySelector("[data-captured]");
  if (!el) return;
  const captured = new Date(el.dataset.captured);
  if (Number.isNaN(+captured)) return;

  const hours = Math.round((Date.now() - captured) / 3_600_000);
  const age =
    hours < 1 ? "less than an hour ago"
    : hours < 48 ? `${hours} hour${hours === 1 ? "" : "s"} ago`
    : `${Math.round(hours / 24)} days ago`;

  const out = $("hand-entered-age");
  if (out) {
    out.innerHTML =
      `<strong>Entered by hand ${esc(age)}</strong>, from Nepal Police bulletin 10275. ` +
      `These counts are not live and cannot be — no API publishes them. ` +
      (hours > 24
        ? `<strong style="color:var(--critical)">They are almost certainly out of date by now.</strong> `
        : "") +
      `The river and road panels below this section are live; these are not.`;
  }
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
