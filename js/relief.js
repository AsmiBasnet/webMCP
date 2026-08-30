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
