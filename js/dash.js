// The dashboard: filter bar, record list, drill-down, map, refresh loop.
//
// One rule runs through all of it — the screen never shows a number without
// showing how old it is and which source it came from.

import { loadRefdata } from "./refdata.js";
import { loadFeed, applyFilters, facets, groupByDay, SOURCES, SEVERITIES } from "./feed.js";
import { health, snapshotMode } from "./api.js";

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n = (v) => (typeof v === "number" ? v.toLocaleString() : v);

const REFRESH_MS = 180_000;   // three minutes; DHM publishes every ten
const TICK_MS = 15_000;

const DEFAULT_SEVERITIES = SEVERITIES.filter((s) => s !== "normal");

const state = {
  records: [],
  errors: [],
  stale: new Set(),
  fetchedAt: null,
  failures: 0,
  busy: false,
  selected: null,
  filters: {
    // Opens on today and yesterday. Everything older is one dropdown away —
    // the window is the escape hatch, not the default.
    days: 2,
    sources: new Set(SOURCES.map((s) => s.id)),
    // Every severity except `normal`. 163 gauges report every ten minutes and
    // on a quiet day all but a handful sit below their warning level — 159 rows
    // of "nothing is happening" ahead of anything that is. They are one chip
    // away, which is where "the rest" belongs.
    severities: new Set(DEFAULT_SEVERITIES),
    district: "",
    kind: "",
    search: "",
    sort: "recency",
  },
};

let timer = null;
let map = null;
const markers = { layer: null };

// ---------------------------------------------------------------------------
// Fetch + refresh loop
// ---------------------------------------------------------------------------

async function refresh({ force = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  setBusy(true);

  const res = await loadFeed({ days: state.filters.days, force });

  // Keep the previous records if literally everything failed — a stale list
  // with its age stated beats an empty screen.
  if (res.records.length || !state.records.length) state.records = res.records;
  state.errors = res.errors;
  state.stale = res.stale ?? new Set();
  state.fetchedAt = res.fetchedAt;
  // A source that only answered from the snapshot has not really answered, so
  // it counts towards backoff too.
  state.failures = res.errors.length || state.stale.size ? state.failures + 1 : 0;

  state.busy = false;
  setBusy(false);
  renderAll();
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const delay = state.failures ? Math.min(REFRESH_MS * 2 ** state.failures, 900_000) : REFRESH_MS;
  timer = setTimeout(() => refresh(), delay);
}

function setBusy(busy) {
  const b = $("#refresh");
  if (b) { b.disabled = busy; b.textContent = busy ? "Loading…" : "Refresh"; }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function renderStatus(visible = null) {
  const el = $("#status");
  if (!state.fetchedAt) { el.textContent = "Loading…"; return; }

  const secs = Math.round((Date.now() - state.fetchedAt) / 1000);
  const when = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)} min ago`;

  const bad = new Set(state.errors.map((e) => e.source));
  const stale = state.stale ?? new Set();
  const onSnapshot = stale.size > 0;

  // Per-source dots, so a reader can see at a glance which feed is down rather
  // than inferring it from a missing row.
  const dots = SOURCES.map((s) => {
    const off = !state.filters.sources.has(s.id);
    const broken = bad.has(s.id);
    const isStale = stale.has(s.id);
    const cls = off ? "off" : broken ? "bad" : isStale ? "stale" : "ok";
    // Count what is on screen, not what was fetched. A source that returned 17
    // records of which the window shows 1 is reported as 1 — otherwise the bar
    // contradicts the list directly beneath it.
    const pool = visible ?? state.records;
    const count = pool.filter((r) => r.source === s.id).length;
    const note = broken ? "unreachable" : isStale ? "serving stored snapshot, not live" : "live";
    return `<span class="src src--${cls}" title="${esc(s.origin)} · updates ${esc(s.cadence)} · ${note}">` +
      `<i></i>${esc(s.label)} <b>${off ? "—" : broken ? "failed" : isStale ? `${count} stale` : count}</b></span>`;
  }).join("");

  el.innerHTML =
    dots +
    `<span class="status-when">` +
    (snapshotMode || onSnapshot
      ? `<b class="warn">${esc([...stale].join(", ") || "some sources")} serving stored snapshot — not live.</b> `
      : "") +
    `updated ${esc(when)}` +
    (bad.size ? ` · <b class="bad-text">${bad.size} source${bad.size === 1 ? "" : "s"} unreachable</b>` : "") +
    ` · auto every ${REFRESH_MS / 60_000} min</span>`;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function renderFilterChrome() {
  $("#f-sources").innerHTML = SOURCES.map((s) =>
    `<button type="button" class="chip${state.filters.sources.has(s.id) ? " on" : ""}" data-src="${s.id}" ` +
    `title="${esc(s.origin)} · updates ${esc(s.cadence)}">${esc(s.label)}</button>`
  ).join("");

  $("#f-sev").innerHTML = SEVERITIES.map((s) =>
    `<button type="button" class="chip chip--${s}${state.filters.severities.has(s) ? " on" : ""}" ` +
    `data-sev="${s}">${s}</button>`
  ).join("");
}

function renderFacets(visibleBefore) {
  const { districts, kinds } = facets(visibleBefore);

  const opts = (list, current, label) =>
    `<option value="">${label}</option>` +
    list.map(([v, c]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)} (${c})</option>`).join("");

  $("#f-district").innerHTML = opts(districts, state.filters.district, "All districts");
  $("#f-kind").innerHTML = opts(kinds, state.filters.kind, "All types");
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const ago = (iso) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso);
  if (Number.isNaN(ms)) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

function renderList(rows) {
  const el = $("#rows");

  if (!rows.length) {
    el.innerHTML =
      `<div class="empty">Nothing in the last ${state.filters.days === 1 ? "day" : `${state.filters.days} days`} ` +
      `matches these filters. ` +
      (state.errors.length
        ? `Note that ${esc(state.errors.map((e) => e.source).join(", "))} could not be reached — this is a ` +
          `data-source failure, not an absence of events. `
        : `That is what the sources returned, which is not the same as nothing having happened. `) +
      `Widen the window to look further back.</div>`;
    return;
  }

  // Grouped only under the default sort. Choosing "severity" or "most recent"
  // means the reader has asked for one flat ordering, and day headers would cut
  // straight across it.
  if (state.filters.sort !== "recency") {
    el.innerHTML = rows.map(rowHtml).join("");
    return;
  }

  el.innerHTML = groupByDay(rows)
    .map((g) =>
      `<div class="group-head"><span>${esc(g.label)}</span><b>${g.rows.length}</b></div>` +
      g.rows.map(rowHtml).join("")
    )
    .join("");
}

function rowHtml(r) {
  return `
    <button type="button" class="row${state.selected === r.id ? " sel" : ""}" data-id="${esc(r.id)}">
      <span class="row-sev sev--${r.severity}" title="${esc(r.severityLabel)}"></span>
      <span class="row-main">
        <span class="row-title">${esc(r.title)}</span>
        ${r.titleNe ? `<span class="row-ne">${esc(r.titleNe)}</span>` : ""}
        <span class="row-line">${esc(r.line)}</span>
      </span>
      <span class="row-meta">
        <span class="tag tag--${r.source}">${esc(sourceLabel(r.source))}</span>
        <span class="row-kind">${esc(r.kind)}</span>
        <span class="row-where">${esc(r.district ?? r.municipality ?? "—")}</span>
        <span class="row-age" title="${esc(r.at ?? "no timestamp")}">${esc(ago(r.at))}</span>
      </span>
    </button>`;
}

const sourceLabel = (id) => SOURCES.find((s) => s.id === id)?.label ?? id;

// ---------------------------------------------------------------------------
// Drill-down
// ---------------------------------------------------------------------------

function renderDetail() {
  const el = $("#detail");
  const r = state.records.find((x) => x.id === state.selected);

  if (!r) {
    el.innerHTML = `<div class="detail-empty">Select a record to see everything the source published about it.</div>`;
    return;
  }

  const rows = Object.entries(r.metrics)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0)
    .map(([k, v]) => `<div class="dt">${esc(k)}</div><div class="dd">${esc(n(v))}</div>`)
    .join("");

  const src = SOURCES.find((s) => s.id === r.source);

  el.innerHTML = `
    <div class="detail-head">
      <span class="tag tag--${r.source}">${esc(sourceLabel(r.source))}</span>
      <span class="tag tag--sev sev-text--${r.severity}">${esc(r.severityLabel)}</span>
      <button type="button" class="close" id="detail-close" aria-label="Close">×</button>
    </div>
    <h2>${esc(r.title)}</h2>
    ${r.titleNe ? `<p class="detail-ne">${esc(r.titleNe)}</p>` : ""}
    <p class="detail-line">${esc(r.line)}</p>

    <dl class="dl">
      <div class="dt">Type</div><div class="dd">${esc(r.kind)}</div>
      <div class="dt">District</div><div class="dd">${esc(r.district ?? "not resolved")}${r.districtNe ? ` <span class="dim">${esc(r.districtNe)}</span>` : ""}</div>
      ${r.municipality ? `<div class="dt">Location</div><div class="dd">${esc(r.municipality)}</div>` : ""}
      <div class="dt">Recorded at</div><div class="dd">${esc(r.at ?? "no timestamp published")}</div>
      ${r.point ? `<div class="dt">Coordinates</div><div class="dd">${r.point[0].toFixed(4)}, ${r.point[1].toFixed(4)}</div>` : ""}
      ${rows}
    </dl>

    ${r.series ? forecastSpark(r.series) : ""}

    <div class="prov">
      <b>Source</b> ${esc(src?.origin ?? r.source)} · updates ${esc(src?.cadence ?? "unknown")}<br>
      <b>Record id</b> <span class="mono">${esc(r.id)}</span>
    </div>

    <details class="rawbox">
      <summary>Raw payload as published</summary>
      <pre>${esc(JSON.stringify(r.raw, null, 2))}</pre>
    </details>
  `;

  $("#detail-close")?.addEventListener("click", () => { state.selected = null; renderAll(); });
  if (r.point && map) map.setView(r.point, Math.max(map.getZoom(), 10));
}

/** A bare sparkline for the forecast series — no axis furniture, it is a shape. */
function forecastSpark(series) {
  const pts = series.filter((p) => p.discharge != null);
  if (pts.length < 2) return "";
  const vals = pts.map((p) => p.discharge);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const W = 300, H = 56;
  const d = pts.map((p, i) =>
    `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((p.discharge - min) / span) * H).toFixed(1)}`
  ).join(" ");
  const today = new Date().toISOString().slice(0, 10);
  const ti = pts.findIndex((p) => p.date >= today);
  const tx = ti >= 0 ? ((ti / (pts.length - 1)) * W).toFixed(1) : null;

  return `<figure class="spark">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="Discharge from ${esc(pts[0].date)} to ${esc(pts[pts.length - 1].date)}, ${min.toFixed(1)} to ${max.toFixed(1)} cubic metres per second">
      ${tx ? `<line x1="${tx}" y1="0" x2="${tx}" y2="${H}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>` : ""}
      <path d="${d}" fill="none" stroke="var(--water)" stroke-width="2"/>
    </svg>
    <figcaption>${esc(pts[0].date)} → ${esc(pts[pts.length - 1].date)} · ${min.toFixed(1)}–${max.toFixed(1)} m³/s · dashed line is today</figcaption>
  </figure>`;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function initMap() {
  if (typeof L === "undefined") return;
  map = L.map("map", { scrollWheelZoom: false }).setView([28.2, 84.5], 7);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16, attribution: "Tiles &copy; Esri" }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16 }).addTo(map);
}

const SEV_COLOUR = {
  critical: "#d03b3b", serious: "#ec835a", warning: "#fab219",
  normal: "#0ca30c", info: "#3987e5",
};

let lastFitKey = null;

function renderMap(rows) {
  if (!map) return;

  // Leaflet measures its container at construction. Boot runs before the grid
  // has settled, so without this the map keeps a stale size and renders the
  // wrong part of the country.
  map.invalidateSize({ animate: false });

  if (markers.layer) map.removeLayer(markers.layer);

  const pts = rows.filter((r) => r.point);
  if (!pts.length) { markers.layer = null; return; }

  markers.layer = L.layerGroup(
    pts.map((r) =>
      L.circleMarker(r.point, {
        radius: r.severity === "critical" ? 8 : r.severity === "serious" ? 6 : 4,
        color: SEV_COLOUR[r.severity] ?? "#3987e5",
        weight: 1.5,
        fillOpacity: 0.35,
      })
        .bindPopup(
          `<b>${esc(r.title)}</b><br><span class="meta">${esc(sourceLabel(r.source))} · ${esc(r.kind)}` +
          `${r.district ? ` · ${esc(r.district)}` : ""}</span><br>${esc(r.line)}`
        )
        .on("click", () => { state.selected = r.id; renderAll(); })
    )
  ).addTo(map);

  // Follow the district filter — narrowing to Rasuwa should show Rasuwa. Only
  // refit when that choice actually changes, so the map does not lurch on every
  // search keystroke or refresh tick.
  const fitKey = `${state.filters.district}|${state.filters.days}`;
  if (fitKey !== lastFitKey) {
    lastFitKey = fitKey;
    map.fitBounds(L.latLngBounds(pts.map((r) => r.point)), { padding: [24, 24], maxZoom: 11 });
  }
}

// ---------------------------------------------------------------------------

function renderAll() {
  // Facets are computed before the district/kind filters so the dropdowns keep
  // offering the other values — a filter that erases its own options is a trap.
  const preFacet = applyFilters(state.records, { ...state.filters, district: "", kind: "" });
  renderFacets(preFacet);

  const rows = applyFilters(state.records, state.filters);

  // What each source contributed to this window, before the severity, district
  // and search filters — otherwise the bar would report "Gauges 4" while 163
  // stations are reporting perfectly well.
  const windowed = applyFilters(state.records, { days: state.filters.days });

  $("#count").textContent =
    `${rows.length} of ${windowed.length} in window`;

  renderStatus(windowed);
  renderList(rows);
  renderDetail();
  renderMap(rows);
}

function wire() {
  $("#f-sources").addEventListener("click", (e) => {
    const b = e.target.closest("[data-src]"); if (!b) return;
    const id = b.dataset.src;
    state.filters.sources.has(id) ? state.filters.sources.delete(id) : state.filters.sources.add(id);
    renderFilterChrome(); renderAll();
  });

  $("#f-sev").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sev]"); if (!b) return;
    const s = b.dataset.sev;
    state.filters.severities.has(s) ? state.filters.severities.delete(s) : state.filters.severities.add(s);
    renderFilterChrome(); renderAll();
  });

  $("#f-district").addEventListener("change", (e) => { state.filters.district = e.target.value; renderAll(); });
  $("#f-kind").addEventListener("change", (e) => { state.filters.kind = e.target.value; renderAll(); });
  $("#f-sort").addEventListener("change", (e) => { state.filters.sort = e.target.value; renderAll(); });

  let debounce;
  $("#f-search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.filters.search = e.target.value.trim(); renderAll(); }, 150);
  });

  // Changing the window changes what has to be fetched, not just what is shown.
  $("#f-days").addEventListener("change", (e) => {
    state.filters.days = Number(e.target.value);
    refresh();
  });

  $("#rows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    state.selected = state.selected === b.dataset.id ? null : b.dataset.id;
    renderAll();
  });

  $("#refresh").addEventListener("click", () => refresh());

  $("#reset").addEventListener("click", () => {
    state.filters.sources = new Set(SOURCES.map((s) => s.id));
    state.filters.severities = new Set(DEFAULT_SEVERITIES);
    state.filters.district = ""; state.filters.kind = ""; state.filters.search = "";
    $("#f-search").value = "";
    renderFilterChrome(); renderAll();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected) { state.selected = null; renderAll(); }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else if (!state.fetchedAt || Date.now() - state.fetchedAt > REFRESH_MS) refresh();
    else schedule();
  });
}

async function boot() {
  renderFilterChrome();
  wire();
  initMap();

  try {
    await loadRefdata();
  } catch (err) {
    $("#rows").innerHTML = `<div class="empty">Reference data failed to load: ${esc(err.message)}. Run <span class="mono">node scripts/build-refdata.mjs</span>.</div>`;
    return;
  }

  await refresh({ force: false });
  // Re-render the age every 15s against the currently visible rows.
  setInterval(() => renderStatus(applyFilters(state.records, { days: state.filters.days })), TICK_MS);
}

boot();

// For the console and for tests.
window.SankatSathi = { state, refresh, loadFeed, applyFilters };
