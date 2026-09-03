// The dashboard: filter bar, record list, drill-down, map, refresh loop.
//
// One rule runs through all of it — the screen never shows a number without
// showing how old it is and which source it came from.

import { loadRefdata } from "./refdata.js";
import { loadFeed, applyFilters, facets, groupByDay, SOURCES, SEVERITIES } from "./feed.js";
import { health, snapshotMode } from "./api.js";
import { installWebMCP } from "./webmcp.js";

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n = (v) => (typeof v === "number" ? v.toLocaleString() : v);

const REFRESH_MS = 180_000;   // three minutes; DHM publishes every ten
const TICK_MS = 15_000;

const DEFAULT_SEVERITIES = SEVERITIES.filter((s) => s !== "normal");
const DEFAULT_DAYS = 2;
const DEFAULT_SORT = "recency";
// The windows index.html offers. A value outside this set has no <option> to
// select, so syncControls would blank the control while the list stayed
// filtered — the exact disagreement syncControls exists to prevent.
const WINDOWS = [1, 2, 7, 30, 90];
const SORTS = ["recency", "severity", "time"];

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
    days: DEFAULT_DAYS,
    sources: new Set(SOURCES.map((s) => s.id)),
    // Every severity except `normal`. 163 gauges report every ten minutes and
    // on a quiet day all but a handful sit below their warning level — 159 rows
    // of "nothing is happening" ahead of anything that is. They are one chip
    // away, which is where "the rest" belongs.
    severities: new Set(DEFAULT_SEVERITIES),
    district: "",
    kind: "",
    search: "",
    sort: DEFAULT_SORT,
  },
};

let timer = null;
let pending = null;          // the in-flight load, so concurrent callers queue
let map = null;
const markers = { layer: null };

// ---------------------------------------------------------------------------
// Fetch + refresh loop
// ---------------------------------------------------------------------------

/**
 * Fetch all six sources.
 *
 * Serialised rather than dropped. The old guard returned early whenever a
 * fetch was already in flight, which was fine for a poll tick and wrong for
 * everything else: a caller that has just widened the window to 90 days must
 * not be satisfied by the 2-day fetch that happened to be running, and must
 * certainly not be told it was. Concurrent callers now queue and each gets its
 * own load, which matters because agents issue tool calls in parallel.
 *
 * @param {{force?: boolean, tick?: boolean}} opts
 * @returns {Promise<{fetched: boolean, reason?: string}>} whether a fetch
 *          actually ran, so callers can report what happened rather than
 *          assume it.
 */
function refresh(opts = {}) {
  // A background tick has nothing to prove. If a load is already running, that
  // load *is* this tick, and queueing a second one would just double the
  // traffic to APIs that have no SLA.
  if (opts.tick && pending) return Promise.resolve({ fetched: false, reason: "a refresh was already running" });

  const run = () => load(opts);
  pending = pending ? pending.then(run, run) : run();

  const mine = pending;
  mine.finally(() => { if (pending === mine) pending = null; });
  return mine;
}

async function load({ force = true } = {}) {
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
  return { fetched: true };
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const delay = state.failures ? Math.min(REFRESH_MS * 2 ** state.failures, 900_000) : REFRESH_MS;
  timer = setTimeout(() => refresh({ tick: true }), delay);
}

function setBusy(busy) {
  const b = $("#refresh");
  if (b) { b.disabled = busy; b.textContent = busy ? "Loading…" : "Refresh"; }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const SOURCE_ICONS = {
  incident: "fa-solid fa-triangle-exclamation",
  river: "fa-solid fa-water",
  road: "fa-solid fa-road-barrier",
  alert: "fa-solid fa-bell",
  forecast: "fa-solid fa-cloud-showers-heavy",
  damage: "fa-solid fa-satellite",
};

function renderStatus(visible = null) {
  const el = $("#status");
  if (!el) return;
  if (!state.fetchedAt) {
    el.innerHTML = `<span class="loading-pulse"><i class="fa-solid fa-spinner fa-spin"></i> Syncing live disaster feeds…</span>`;
    return;
  }

  const secs = Math.round((Date.now() - state.fetchedAt) / 1000);
  const when = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;

  const bad = new Set(state.errors.map((e) => e.source));
  const stale = state.stale ?? new Set();

  const chips = SOURCES.map((s) => {
    const off = !state.filters.sources.has(s.id);
    const broken = bad.has(s.id);
    const isStale = stale.has(s.id);
    const cls = off ? "off" : broken ? "bad" : isStale ? "stale" : "ok";
    const pool = visible ?? state.records;
    const count = pool.filter((r) => r.source === s.id).length;
    const note = broken ? "Feed unreachable" : isStale ? "Serving cached snapshot" : "Realtime feed live";
    const icon = SOURCE_ICONS[s.id] || "fa-solid fa-database";

    return `<div class="src-pill src-pill--${cls}" data-src="${s.id}" title="${esc(s.origin)} · updates ${esc(s.cadence)} · ${note} (Click to toggle filter)">
      <span class="src-dot"></span>
      <i class="${icon} src-icon"></i>
      <span class="src-label">${esc(s.label)}</span>
      <span class="src-count">${off ? "—" : broken ? "fail" : count}</span>
    </div>`;
  }).join("");

  const degradedNote = bad.size
    ? `${bad.size} unreachable`
    : stale.size
      ? `${stale.size} snapshot fallback`
      : null;

  el.innerHTML = `
    <div class="status-sources-grid">
      ${chips}
    </div>
    <div class="status-meta-group">
      ${degradedNote ? `<span class="status-sync-pill status-sync-pill--warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(degradedNote)}</span>` : ""}
      <span class="status-sync-pill"><i class="fa-solid fa-arrows-rotate"></i> Updated ${esc(when)} · Auto ${REFRESH_MS / 60_000}m</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

// The three severities worth a headline, in the order they should be read.
const TILES = [
  { sev: "critical", label: "critical" },
  { sev: "serious", label: "serious" },
  { sev: "warning", label: "warning" },
];

/** Counts for what is in the window, not what was fetched — same rule as the
 *  status bar, so the tiles can never contradict the list below them. */
function renderSummary(windowed) {
  const el = $("#summary");
  if (!el) return;

  const tiles = TILES.map((t) => {
    const count = windowed.filter((r) => r.severity === t.sev).length;
    // Pressed when the severity filter has been narrowed to exactly this one.
    const only = state.filters.severities.size === 1 && state.filters.severities.has(t.sev);
    return `<button type="button" class="tile tile--${t.sev}" data-tile-sev="${t.sev}" aria-pressed="${only}"
      title="Show only ${esc(t.label)} records"><b>${count}</b>${esc(t.label)}</button>`;
  }).join("");

  const districts = new Set(windowed.map((r) => r.district).filter(Boolean)).size;
  const live = SOURCES.length - new Set(state.errors.map((e) => e.source)).size;

  el.innerHTML =
    `<span class="sum-total"><b>${windowed.length}</b> records in window</span>` +
    tiles +
    `<span class="sum-sub">${districts} district${districts === 1 ? "" : "s"} · ` +
    `${live} of ${SOURCES.length} sources answering</span>`;
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
  // Satellite acquisition times occasionally sit slightly ahead of local time.
  // Rendering that as "-73m" reads like a bug in the page rather than a quirk
  // of the source, so anything in the future is simply "now".
  if (ms < 0) return "now";
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
      <path d="${d}" fill="none" stroke="var(--info)" stroke-width="2"/>
    </svg>
    <figcaption>${esc(pts[0].date)} → ${esc(pts[pts.length - 1].date)} · ${min.toFixed(1)}–${max.toFixed(1)} m³/s · dashed line is today</figcaption>
  </figure>`;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function initMap() {
  if (typeof L === "undefined") return;
  // Scroll wheel, buttons, double-click, pinch — all the usual ways to zoom.
  map = L.map("map", { scrollWheelZoom: true, zoomControl: true }).setView([28.2, 84.5], 7);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16, attribution: "Tiles &copy; Esri" }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 16 }).addTo(map);
}

// Kept in step with the severity tokens in dash.css — Leaflet paints on canvas,
// so it cannot read the custom properties itself.
const SEV_COLOUR = {
  critical: "#c62828", serious: "#e05a10", warning: "#f0b429",
  normal: "#2e7d32", info: "#1a56c4",
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
  renderMapCaption(rows, pts);
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

/** What the map is showing — and, just as importantly, what it is not.
 *
 *  Plenty of BIPAD rows carry no coordinates. Those records are in the feed and
 *  in every tool's answer but cannot be drawn, and a map that says nothing
 *  about them reads as a quiet district to anyone scanning it. */
function renderMapCaption(rows, pts) {
  const el = $("#map-caption");
  if (!el) return;

  const missing = rows.length - pts.length;
  el.innerHTML =
    `<b>${pts.length}</b> of ${rows.length} record${rows.length === 1 ? "" : "s"} plotted` +
    (missing
      ? `<span class="cap-sep">·</span><span class="cap-warn">` +
        `<i class="fa-solid fa-triangle-exclamation"></i> ${missing} published without coordinates — ` +
        `in the feed, not on this map</span>`
      : "");
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
  renderSummary(windowed);
  renderList(rows);
  renderDetail();
  renderMap(rows);
  syncControls();
}

/** Push state back into the three controls that hold their own value.
 *
 *  The chips and the two dropdowns are re-rendered from state on every pass,
 *  but the window, sort and search inputs are plain DOM that keeps whatever it
 *  was last given. A person changing them is already in sync; a WebMCP tool
 *  changing `state.filters` is not, and a filter bar that disagrees with the
 *  list beneath it is worse than no filter bar. */
function syncControls() {
  const days = $("#f-days"), sort = $("#f-sort"), search = $("#f-search");
  if (days && days.value !== String(state.filters.days)) days.value = String(state.filters.days);
  if (sort && sort.value !== state.filters.sort) sort.value = state.filters.sort;
  // Never fight the person's cursor: leave the box alone while it has focus.
  if (search && document.activeElement !== search && search.value !== state.filters.search) {
    search.value = state.filters.search;
  }
}

/** The default view, shared by the Reset button and the reset_view tool.
 *
 *  Every default, including the two that used to be left behind: the window and
 *  the sort. reset_view promises "back to how the page opens", and a reset that
 *  quietly left a 90-day window in place would have every later reading answer
 *  over 90 days while reporting itself as the default view. Restoring the
 *  window means a fetch, so this is async and the tool awaits it. */
async function resetFilters() {
  state.filters.sources = new Set(SOURCES.map((s) => s.id));
  state.filters.severities = new Set(DEFAULT_SEVERITIES);
  state.filters.district = ""; state.filters.kind = ""; state.filters.search = "";
  state.filters.sort = DEFAULT_SORT;
  state.selected = null;

  const refetch = state.filters.days !== DEFAULT_DAYS;
  state.filters.days = DEFAULT_DAYS;

  renderFilterChrome();
  if (refetch) await refresh();
  else renderAll();
}

function wire() {
  document.querySelectorAll(".subnav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.target;
      if (target === "tab-feed") {
        document.querySelector("#feed-section")?.scrollIntoView({ behavior: "smooth" });
      } else if (target === "tab-map") {
        document.querySelector("#map-section")?.scrollIntoView({ behavior: "smooth" });
        if (map) setTimeout(() => map.invalidateSize(), 300);
      } else if (target === "tab-sources") {
        const sec = document.querySelector("#sources-section");
        if (sec) {
          if (sec.tagName === "DETAILS") sec.open = true;
          sec.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  });

  $("#status")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-src]"); if (!b) return;
    const id = b.dataset.src;
    state.filters.sources.has(id) ? state.filters.sources.delete(id) : state.filters.sources.add(id);
    renderFilterChrome(); renderAll();
  });

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

  // A tile is a shortcut into the severity filter: click to see only that
  // severity, click again to go back to the default set.
  $("#summary").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tile-sev]"); if (!b) return;
    const s = b.dataset.tileSev;
    const only = state.filters.severities.size === 1 && state.filters.severities.has(s);
    state.filters.severities = new Set(only ? DEFAULT_SEVERITIES : [s]);
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

  $("#map-whole")?.addEventListener("click", () => {
    if (!map) return;
    map.setView([28.2, 84.5], 7);
    lastFitKey = null;   // a manual zoom-out must not block the next district fit
  });

  $("#refresh").addEventListener("click", () => refresh());

  $("#reset").addEventListener("click", () => resetFilters());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected) { state.selected = null; renderAll(); }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else if (!state.fetchedAt || Date.now() - state.fetchedAt > REFRESH_MS) refresh({ tick: true });
    else schedule();
  });
}

// ---------------------------------------------------------------------------
// The control surface WebMCP tools drive
//
// Deliberately the same handful of operations the filter bar performs, and
// nothing more. Tools mutate `state.filters` and re-render exactly as a click
// does, so there is one code path to the screen rather than two, and an agent
// cannot reach anything a person could not have reached by hand.
// ---------------------------------------------------------------------------

const controls = {
  state,

  /**
   * Apply any subset of the filter bar.
   *
   * Returns `{ changed, rejected }`. Nothing is applied silently and nothing is
   * dropped silently: a value that is not on offer comes back in `rejected`
   * with the reason, because the alternative is a view filtered to zero rows
   * and an agent with no way to tell "that name matched nothing" from "nothing
   * has happened there". On a page about casualties those must never look the
   * same.
   */
  async apply({ sources, severities, window: days, district, type, search, sort } = {}, signal) {
    const changed = [];
    const rejected = [];

    // What the loaded window actually offers. Checked against the records
    // rather than a fixed list, because which districts exist depends on what
    // was reported today.
    const inWindow = applyFilters(state.records, { days: state.filters.days });
    const known = (key) => new Set(inWindow.map((r) => r[key]).filter(Boolean));

    if (Array.isArray(sources) && sources.length) {
      const valid = sources.filter((x) => SOURCES.some((s) => s.id === x));
      const bad = sources.filter((x) => !valid.includes(x));
      if (bad.length) rejected.push(`sources ${bad.join(", ")} — not among ${SOURCES.map((s) => s.id).join(", ")}`);
      if (valid.length) { state.filters.sources = new Set(valid); changed.push(`sources=${valid.join("+")}`); }
    }

    if (Array.isArray(severities) && severities.length) {
      const valid = severities.filter((x) => SEVERITIES.includes(x));
      const bad = severities.filter((x) => !valid.includes(x));
      if (bad.length) rejected.push(`severities ${bad.join(", ")} — not among ${SEVERITIES.join(", ")}`);
      if (valid.length) { state.filters.severities = new Set(valid); changed.push(`severities=${valid.join("+")}`); }
    }

    if (typeof district === "string") {
      if (!district || known("district").has(district)) {
        state.filters.district = district;
        changed.push(`district=${district || "all"}`);
      } else {
        rejected.push(
          `district "${district}" — no records in the current ${state.filters.days}-day window carry that ` +
          `name, so the filter was NOT applied and the view is unchanged. This is a name that matched ` +
          `nothing, not a district where nothing happened. Call list_filter_options for the names on offer, ` +
          `or widen the window.`
        );
      }
    }

    if (typeof type === "string") {
      if (!type || known("kind").has(type)) {
        state.filters.kind = type;
        changed.push(`type=${type || "all"}`);
      } else {
        rejected.push(
          `type "${type}" — no records in the current window carry that hazard type, so the filter was NOT ` +
          `applied. Call list_filter_options for the types on offer.`
        );
      }
    }

    if (typeof search === "string") { state.filters.search = search.trim(); changed.push(`search=${search.trim() || "cleared"}`); }

    if (typeof sort === "string") {
      if (SORTS.includes(sort)) { state.filters.sort = sort; changed.push(`sort=${sort}`); }
      else rejected.push(`sort "${sort}" — not among ${SORTS.join(", ")}`);
    }

    renderFilterChrome();

    // The window is the one filter that is also a fetch: widening it asks all
    // six sources for more. It is awaited, and reported by what actually
    // happened rather than by what was asked for.
    if (typeof days === "number" && !WINDOWS.includes(days)) {
      rejected.push(
        `window ${days} — the page offers ${WINDOWS.join(", ")} days. Applying anything else would leave the ` +
        `Window control blank while the list stayed filtered, so it was NOT applied.`
      );
      renderAll();
    } else if (typeof days === "number" && days !== state.filters.days) {
      state.filters.days = days;
      const res = await refresh();
      changed.push(res.fetched ? `window=${days}d (refetched)` : `window=${days}d (refetch skipped: ${res.reason})`);
    } else {
      renderAll();
    }

    if (signal?.aborted) throw new DOMException("Tool execution aborted", "AbortError");
    return { changed, rejected };
  },

  refresh: (opts) => refresh(opts),

  /** @returns {{selected: string|null, mapMoved: boolean}} */
  select(id) {
    state.selected = id;
    const r = id ? state.records.find((x) => x.id === id) : null;
    renderAll();               // renderDetail pans the map when the record has a point
    // Whether the map actually moved is the caller's to report. Plenty of BIPAD
    // rows have no coordinates, and telling someone "I have put it on the map"
    // when the map has not moved is the small lie this file is written against.
    return { selected: state.selected, mapMoved: !!(r?.point && map) };
  },

  /** Move the map only. Nothing here touches the list. */
  focus({ district, lat, lon, zoom, whole } = {}) {
    if (!map) return { summary: "No map on this page.", center: null, zoom: null };

    if (whole) {
      map.setView([28.2, 84.5], 7);
      return { summary: "Zoomed out to the whole of Nepal.", center: [28.2, 84.5], zoom: 7 };
    }
    if (typeof lat === "number" && typeof lon === "number") {
      const z = zoom ?? 11;
      map.setView([lat, lon], z);
      return { summary: `Map centred on ${lat.toFixed(4)}, ${lon.toFixed(4)} at zoom ${z}.`, center: [lat, lon], zoom: z };
    }
    if (district) {
      const pts = state.records.filter((r) => r.district === district && r.point).map((r) => r.point);
      if (!pts.length) {
        return {
          summary: `Nothing with coordinates in ${district} is loaded, so the map has not moved. ` +
                   `That is a gap in what the sources published, not necessarily an absence of events.`,
          center: null, zoom: null,
        };
      }
      map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: zoom ?? 11 });
      const c = map.getCenter();
      return { summary: `Map fitted to ${pts.length} located record(s) in ${district}.`, center: [c.lat, c.lng], zoom: map.getZoom() };
    }
    if (typeof zoom === "number") {
      map.setZoom(zoom);
      const c = map.getCenter();
      return { summary: `Zoom set to ${zoom}.`, center: [c.lat, c.lng], zoom };
    }
    return { summary: "Nothing to move to — pass a district, coordinates, a zoom, or whole:true.", center: null, zoom: null };
  },

  reset: () => resetFilters(),
};

async function boot() {
  renderFilterChrome();
  wire();
  initMap();

  try {
    await loadRefdata();
  } catch (err) {
    $("#rows").innerHTML = `<div class="empty">Reference data failed to load: ${esc(err.message)}. Run <span class="mono">node scripts/build-refdata.mjs</span>.</div>`;
    // No tools are registered on this path, deliberately. Without reference
    // data nothing resolves to a district and no records load, so every tool
    // would answer "0 records" over a local failure — an agent finding no tool
    // surface at all learns strictly more than one told the country is quiet.
    console.error("[WebMCP] no tools registered: reference data failed to load.", err);
    return;
  }

  await refresh({ force: false });

  // Registered after the first load, so a tool called the instant the page
  // settles answers over real records rather than an empty list. Invisible in
  // the interface by design — the evidence is in the console and in
  // `document.modelContext.getTools()`.
  installWebMCP(controls)
    .then((r) => { window.NepalDisasterWatch.webmcp = r; })
    // Registration can fail outside the per-tool guard — an extension or a
    // polyfill may have already defined document.modelContext non-configurably.
    // Unhandled, that leaves no tools and no explanation, which is the worst of
    // the three outcomes.
    .catch((err) => {
      window.NepalDisasterWatch.webmcp = { registered: [], error: String(err?.message ?? err), native: false };
      console.error("[WebMCP] tool registration failed; this page has no tool surface.", err);
    });

  // Re-render the age every 15s against the currently visible rows.
  setInterval(() => renderStatus(applyFilters(state.records, { days: state.filters.days })), TICK_MS);
}

// For the console and for tests.
window.NepalDisasterWatch = { state, refresh, loadFeed, applyFilters, controls };

boot();
