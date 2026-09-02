// Agent readout — a WebMCP tool call, rendered for the person watching.
//
// The tools were built for an agent: each one answers in JSON, and until now
// the only trace a call left on screen was the filter chips moving. That is
// enough for the agent and not enough for the responder sitting next to it,
// who gets told "Rasuwa is cut off" with no way to see what that was read from.
//
// So every call is narrated here, in the panel beside the map:
//
//   read tools   paint their answer and light up the records it came from.
//                They still change nothing — no filter moves, no selection
//                changes, the map does not pan. `readOnlyHint: true` stays
//                true: this panel is a transcript of what was read, in the
//                same sense a console log is.
//   write tools  paint what they changed, including what they refused to
//                change. A rejected argument is rendered louder than an
//                applied one, because a filter that silently matched nothing
//                and a district where nothing happened must never look alike.
//
// Nothing in here re-computes a figure. Everything rendered is a field of the
// object the tool already returned to the agent, so the panel and the agent
// cannot drift apart and tell two different stories about the same ground.

import { SOURCES } from "./feed.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : v ?? "—");

const SOURCE_ICONS = {
  incident: "fa-solid fa-triangle-exclamation",
  river: "fa-solid fa-water",
  road: "fa-solid fa-road-barrier",
  alert: "fa-solid fa-bell",
  forecast: "fa-solid fa-cloud-showers-heavy",
  damage: "fa-solid fa-satellite",
};

const TOOL_ICONS = {
  get_situation_summary: "fa-solid fa-gauge-high",
  list_records: "fa-solid fa-list-ul",
  get_record_details: "fa-solid fa-magnifying-glass-chart",
  list_filter_options: "fa-solid fa-sliders",
  cross_reference_district: "fa-solid fa-code-compare",
  get_source_health: "fa-solid fa-heart-pulse",
  filter_records: "fa-solid fa-filter",
  select_record: "fa-solid fa-hand-pointer",
  focus_map: "fa-solid fa-crosshairs",
  reset_view: "fa-solid fa-rotate-left",
  refresh_data: "fa-solid fa-arrows-rotate",
};

const WRITES = new Set(["filter_records", "select_record", "focus_map", "reset_view", "refresh_data"]);

const sourceLabel = (id) => SOURCES.find((s) => s.id === id)?.label ?? id;

// The eight most recent calls. A single prompt routinely makes three or four —
// prompt 3 in PROMPTS.md widens the window, cross-references, then filters —
// and a panel that kept only the last one would throw away the reasoning.
const MAX_TRAIL = 8;
const entries = [];
let cursor = 0;          // which entry is expanded; 0 is the newest
let seq = 0;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

const tile = (label, value, tone = "") =>
  `<div class="ac-tile${tone ? ` ac-tile--${tone}` : ""}"><b>${esc(n(value))}</b><span>${esc(label)}</span></div>`;

const tiles = (list) =>
  `<div class="ac-tiles">${list.filter(Boolean).map(([l, v, t]) => tile(l, v, t)).join("")}</div>`;

/** A finding the reader must not skim past: a divergence between two sources,
 *  an argument that was refused, a map that did not move. */
const note = (text, tone = "warn", icon = "fa-solid fa-triangle-exclamation") =>
  `<div class="ac-note ac-note--${tone}"><i class="${icon}"></i><span>${esc(text)}</span></div>`;

const chip = (text, tone = "") => `<span class="ac-chip${tone ? ` ac-chip--${tone}` : ""}">${esc(text)}</span>`;

/** A clickable action the panel offers the human. `act` is read back in dash.js. */
const act = (label, icon, attrs) =>
  `<button type="button" class="ac-act" ${attrs}><i class="${icon}"></i> ${esc(label)}</button>`;

const recordRow = (r) => `
  <button type="button" class="ac-row" data-act="select" data-id="${esc(r.id)}" title="Open this record on the page">
    <span class="ac-row-sev sev--${esc(r.severity)}"></span>
    <span class="ac-row-main">
      <span class="ac-row-title">${esc(r.title)}</span>
      <span class="ac-row-line">${esc(r.summary ?? r.line ?? "")}</span>
    </span>
    <span class="ac-row-tag tag--${esc(r.source)}">${esc(sourceLabel(r.source))}</span>
  </button>`;

const recordList = (rows, cap = 6) =>
  rows.length
    ? `<div class="ac-rows">${rows.slice(0, cap).map(recordRow).join("")}</div>` +
      (rows.length > cap ? `<p class="ac-more">+ ${rows.length - cap} more in the feed below</p>` : "")
    : "";

/** Source counts as a labelled bar chart. Zero is drawn, not omitted — a source
 *  contributing nothing is a fact about the source, not a reason to hide it. */
function sourceBars(bySource) {
  const max = Math.max(1, ...Object.values(bySource));
  return `<div class="ac-bars">${SOURCES.map((s) => {
    const v = bySource[s.id] ?? 0;
    return `<div class="ac-bar" title="${esc(s.origin)} · ${esc(s.cadence)}">
      <span class="ac-bar-label"><i class="${SOURCE_ICONS[s.id]}"></i> ${esc(s.label)}</span>
      <span class="ac-bar-track"><span class="ac-bar-fill ac-bar-fill--${s.id}" style="width:${(v / max) * 100}%"></span></span>
      <span class="ac-bar-val">${n(v)}</span>
    </div>`;
  }).join("")}</div>`;
}

function healthRows(sources, ageSeconds) {
  const age =
    ageSeconds == null ? "never fetched" : ageSeconds < 60 ? `${ageSeconds}s old` : `${Math.round(ageSeconds / 60)}m old`;
  return (
    `<div class="ac-health">${sources
      .map(
        (s) => `<div class="ac-health-row ac-health-row--${esc(s.status)}">
          <span class="ac-health-dot"></span>
          <span class="ac-health-name"><i class="${SOURCE_ICONS[s.id]}"></i> ${esc(s.label)}</span>
          <span class="ac-health-status">${esc(s.status)}</span>
          <span class="ac-health-count">${n(s.records)}</span>
        </div>`
      )
      .join("")}</div>` +
    `<p class="ac-foot">Data on screen is ${esc(age)}.</p>`
  );
}

// ---------------------------------------------------------------------------
// Per-tool bodies
//
// Each returns { html, spotlight }. `spotlight` is what the map and the feed
// should light up — record ids, or a district — so the answer and the map agree
// about which ground is being discussed.
// ---------------------------------------------------------------------------

const BODIES = {
  get_situation_summary(res) {
    const sev = res.bySeverity ?? {};
    const total = Object.values(sev).reduce((a, b) => a + b, 0);
    const h = res.humanImpact ?? {};
    const worst = res.worstDistricts ?? [];

    return {
      html:
        `<div class="ac-headline"><b>${n(total)}</b> records in the window</div>` +
        `<div class="ac-sevrow">${["critical", "serious", "warning", "normal", "info"]
          .filter((s) => sev[s])
          .map((s) => `<span class="ac-sev ac-sev--${s}"><b>${n(sev[s])}</b> ${s}</span>`)
          .join("")}</div>` +
        (h.deaths || h.missing || h.injured || h.evacuatedFamilies
          ? `<h4 class="ac-h4">Human impact, from the incident record</h4>` +
            tiles([
              ["dead", h.deaths, h.deaths ? "critical" : ""],
              ["missing", h.missing, h.missing ? "critical" : ""],
              ["injured", h.injured, h.injured ? "serious" : ""],
              ["families evacuated", h.evacuatedFamilies],
              ["houses destroyed", h.housesDestroyed],
            ])
          : "") +
        `<h4 class="ac-h4">What each source contributed</h4>` +
        sourceBars(res.bySource ?? {}) +
        (worst.length
          ? `<h4 class="ac-h4">Worst-hit districts, ranked by severity not by row count</h4>` +
            `<div class="ac-districts">${worst
              .map(
                (d) => `<button type="button" class="ac-district" data-act="district" data-district="${esc(d.district)}"
                  title="Cross-reference every source for ${esc(d.district)}">
                  <span class="ac-district-name">${esc(d.district)}</span>
                  <span class="ac-district-counts">${d.critical ? `<i class="sev--critical"></i>${d.critical}` : ""}${
                    d.serious ? `<i class="sev--serious"></i>${d.serious}` : ""
                  }${d.warning ? `<i class="sev--warning"></i>${d.warning}` : ""}</span>
                </button>`
              )
              .join("")}</div>`
          : ""),
      spotlight: null,
    };
  },

  cross_reference_district(res) {
    // The district exists but nothing was published for it. This is the case
    // the whole tool is written around, so it gets the loudest treatment.
    if (res.records === 0) {
      return {
        html:
          note(
            `No records for ${res.district} in the current ${res.windowDays ?? ""}-day window. That is what the ` +
              `sources published, which is not the same as nothing having happened.`,
            "warn"
          ) +
          `<div class="ac-actions">${act("Widen to 7 days", "fa-solid fa-calendar-plus", 'data-act="window" data-window="7"')}${act(
            "Check source health",
            "fa-solid fa-heart-pulse",
            'data-act="tool" data-tool="get_source_health"'
          )}</div>`,
        spotlight: { district: res.district, label: `${res.district} — nothing published` },
      };
    }

    const inc = res.incidents ?? { count: 0 };
    const roads = res.roads ?? [];
    const damage = res.damage ?? [];
    const households = roads.reduce((a, r) => a + (r.householdsCutOff || 0), 0);

    return {
      html:
        `<div class="ac-headline"><b>${esc(res.district)}</b><span class="ac-headline-sub">${n(
          res.records
        )} records · ${res.windowDays}-day window</span></div>` +
        // Six tiles for the six sources that are actually scoped to this
        // district. GDACS is not one of them, and is reported separately below.
        tiles([
          ["incidents", inc.count, inc.count ? "serious" : ""],
          ["gauges", res.gauges?.length ?? 0],
          ["closures", roads.length, roads.length ? "serious" : ""],
          ["forecasts", res.forecast?.length ?? 0],
          ["damage AOIs", damage.length, damage.length ? "damage" : ""],
        ]) +
        (inc.deaths || inc.missing || inc.injured
          ? tiles([
              ["dead", inc.deaths, "critical"],
              ["missing", inc.missing, "critical"],
              ["injured", inc.injured, "serious"],
            ])
          : "") +
        // The reason this tool exists, and so the first thing after the counts:
        // the panel scrolls internally, and a divergence rendered below that
        // line is a divergence nobody reads.
        (res.divergence?.length
          ? `<h4 class="ac-h4 ac-h4--warn"><i class="fa-solid fa-code-compare"></i> ${res.divergence.length} divergence(s) between sources</h4>` +
            res.divergence.map((d) => note(d, "warn", "fa-solid fa-circle-exclamation")).join("")
          : note("No divergence between these sources in this window.", "ok", "fa-solid fa-circle-check")) +
        (households
          ? `<h4 class="ac-h4">Access</h4>` +
            `<p class="ac-p"><b>${n(households)}</b> households are behind a closure here.</p>` +
            recordList(roads, 3)
          : "") +
        (damage.length
          ? `<h4 class="ac-h4">Graded from orbit</h4>` +
            damage
              .map(
                (d) =>
                  `<p class="ac-p"><b>${esc(d.title)}</b> — ${esc(d.buildingsAffected)}` +
                  (d.sensor ? ` · ${esc(d.sensor)}` : "") +
                  (d.imageAcquired ? ` · ${esc(String(d.imageAcquired).slice(0, 10))}` : "") +
                  `</p>`
              )
              .join("")
          : "") +
        // GDACS scopes an alert to the country, so giving these a tile beside
        // the district's own counts would inflate every district in Nepal by
        // the same number. A footnote, in words.
        (res.nationalAlerts?.length
          ? `<p class="ac-foot"><b>${n(res.nationalAlerts.length)}</b> GDACS alert(s) are in this window, ` +
            `scoped to Nepal as a whole rather than to ${esc(res.district)}.</p>`
          : "") +
        `<div class="ac-actions">${act(
          `Show ${res.district} on the map`,
          "fa-solid fa-crosshairs",
          `data-act="tool" data-tool="focus_map" data-args='{"district":${JSON.stringify(res.district)}}'`
        )}${act(
          "Filter the view to it",
          "fa-solid fa-filter",
          `data-act="tool" data-tool="filter_records" data-args='{"district":${JSON.stringify(res.district)}}'`
        )}</div>`,
      spotlight: { district: res.district, label: `${res.district} — cross-referenced across six sources` },
    };
  },

  get_source_health(res) {
    const bad = (res.sources ?? []).filter((s) => s.status !== "live");
    return {
      html:
        (bad.length
          ? note(
              `${bad.length} of ${res.sources.length} sources are not answering live. An empty result from a dead ` +
                `feed is a source failure, not an absence of events.`,
              "warn"
            )
          : note("All six sources answered live.", "ok", "fa-solid fa-circle-check")) +
        healthRows(res.sources ?? [], res.ageSeconds) +
        `<div class="ac-actions">${act("Refetch all six now", "fa-solid fa-arrows-rotate", 'data-act="tool" data-tool="refresh_data"')}</div>`,
      spotlight: null,
    };
  },

  list_records(res) {
    return {
      html:
        `<div class="ac-headline"><b>${n(res.total)}</b> matching record${res.total === 1 ? "" : "s"}</div>` +
        recordList(res.records ?? [], 8),
      spotlight: { ids: (res.records ?? []).map((r) => r.id), label: `${res.records?.length ?? 0} records listed` },
    };
  },

  get_record_details(res) {
    if (!res.record) return { html: note(res.summary ?? "No such record.", "warn"), spotlight: null };
    const r = res.record;
    const m = Object.entries(r.metrics ?? {}).slice(0, 12);
    return {
      html:
        `<div class="ac-headline"><b>${esc(r.title)}</b><span class="ac-headline-sub">${esc(
          sourceLabel(r.source)
        )} · ${esc(r.kind)}${r.district ? ` · ${esc(r.district)}` : ""}</span></div>` +
        (m.length
          ? `<dl class="ac-metrics">${m
              .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(n(v))}</dd></div>`)
              .join("")}</dl>`
          : "") +
        `<p class="ac-foot">${esc(res.provenance?.source ?? "")} · updates ${esc(res.provenance?.cadence ?? "unknown")} · ` +
        `${res.provenance?.live ? "live" : "stored snapshot"}</p>` +
        (r.point
          ? `<div class="ac-actions">${act("Open it on the page", "fa-solid fa-hand-pointer", `data-act="select" data-id="${esc(r.id)}"`)}</div>`
          : note("This record carries no coordinates, so it cannot appear on the map.", "warn")),
      spotlight: { ids: [r.id], label: r.title },
    };
  },

  list_filter_options(res) {
    const cap = (list, key) =>
      list.slice(0, 14).map((x) => chip(`${x.name} (${x.count})`, key)).join("") +
      (list.length > 14 ? `<span class="ac-more-inline">+${list.length - 14}</span>` : "");
    return {
      html:
        `<h4 class="ac-h4">Districts filter_records will accept</h4><div class="ac-chips">${cap(res.districts ?? [])}</div>` +
        `<h4 class="ac-h4">Hazard types</h4><div class="ac-chips">${cap(res.types ?? [])}</div>`,
      spotlight: null,
    };
  },

  filter_records(res) {
    return {
      html:
        `<div class="ac-headline"><b>${n(res.total)}</b> records now showing</div>` +
        (res.changed?.length
          ? `<div class="ac-chips">${res.changed.map((c) => chip(c, "ok")).join("")}</div>`
          : note("Nothing changed — every argument was already in force.", "info", "fa-solid fa-circle-info")) +
        // Rejected arguments carry the whole reason string the tool wrote. It
        // explains the difference between a name that matched nothing and a
        // place where nothing happened, and shortening it would lose exactly
        // the distinction it exists to make.
        (res.rejected?.length ? res.rejected.map((r) => note(r, "warn")).join("") : "") +
        recordList(res.top ?? [], 5),
      spotlight: null,
    };
  },

  select_record(res) {
    if (!res.selected) return { html: note("Closed the detail panel.", "info", "fa-solid fa-circle-info"), spotlight: null };
    return {
      html:
        (res.mapMoved
          ? note("Opened on the page; the map has moved to it.", "ok", "fa-solid fa-circle-check")
          : note(
              "Opened on the page, but the map did NOT move — this record has no coordinates. That is a gap in " +
                "what the source published.",
              "warn"
            )),
      spotlight: { ids: [res.selected], label: "selected record" },
    };
  },

  focus_map(res) {
    return {
      html: res.center
        ? note(res.summary, "ok", "fa-solid fa-crosshairs") +
          `<p class="ac-foot">Centre ${res.center[0].toFixed(3)}, ${res.center[1].toFixed(3)} · zoom ${n(res.zoom)}</p>`
        : note(res.summary, "warn"),
      spotlight: null,
    };
  },

  reset_view(res) {
    return { html: note(res.summary, "info", "fa-solid fa-rotate-left"), spotlight: null };
  },

  refresh_data(res) {
    return {
      html:
        note(res.summary, res.fetched ? "ok" : "warn", res.fetched ? "fa-solid fa-circle-check" : undefined) +
        healthRows(res.sources ?? [], 0),
      spotlight: null,
    };
  },
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const argSummary = (args) => {
  const parts = Object.entries(args ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("+") : v}`);
  return parts.join(" · ");
};

function entryHtml(e, i) {
  const failed = !!e.error || e.result?.error === true;
  const body = failed
    ? { html: note(e.error ?? e.result?.summary ?? "The tool did not complete.", "bad"), spotlight: null }
    : (BODIES[e.tool] ?? (() => ({ html: "", spotlight: null })))(e.result ?? {});

  return `<article class="ac-entry${failed ? " ac-entry--bad" : ""}" data-entry="${i}">
    <header class="ac-head">
      <span class="ac-tool"><i class="${TOOL_ICONS[e.tool] ?? "fa-solid fa-wrench"}"></i> ${esc(e.tool)}</span>
      <span class="ac-kind ac-kind--${WRITES.has(e.tool) ? "write" : "read"}">${
        WRITES.has(e.tool) ? "moved the view" : "read only"
      }</span>
      <span class="ac-time">${esc(e.at)}${e.ms != null ? ` · ${e.ms}ms` : ""}</span>
    </header>
    ${argSummary(e.args) ? `<p class="ac-args">${esc(argSummary(e.args))}</p>` : ""}
    ${e.result?.summary && !failed ? `<p class="ac-summary">${esc(e.result.summary)}</p>` : ""}
    <div class="ac-body">${body.html}</div>
  </article>`;
}

function trailHtml() {
  if (entries.length < 2) return "";
  return `<div class="ac-trail" aria-label="Earlier tool calls in this session">${entries
    .map(
      (e, i) =>
        `<button type="button" class="ac-trail-pill${i === cursor ? " on" : ""}" data-act="trail" data-i="${i}"
          title="${esc(e.tool)} · ${esc(e.at)}"><i class="${TOOL_ICONS[e.tool] ?? "fa-solid fa-wrench"}"></i> ${esc(
          e.tool.replace(/_/g, " ")
        )}</button>`
    )
    .join("")}</div>`;
}

const IDLE = `
  <div class="ac-idle">
    <i class="fa-solid fa-robot ac-idle-icon"></i>
    <p class="ac-idle-lead">Nothing has asked this page a question yet.</p>
    <p class="ac-idle-sub">
      Eleven WebMCP tools are registered on <code>document.modelContext</code>. When an agent — or a line typed
      into DevTools — calls one, what it read appears here and the map above lights up with the records the
      answer came from.
    </p>
    <pre class="ac-idle-code">await document.modelContext.executeTool(
  'cross_reference_district', '{"district":"Rasuwa"}')</pre>
  </div>`;

/** Paint the panel. Returns the spotlight the map and feed should apply. */
export function paint() {
  const el = document.querySelector("#agentcast");
  const clear = document.querySelector("#agent-clear");
  if (!el) return null;

  if (!entries.length) {
    el.innerHTML = IDLE;
    if (clear) clear.hidden = true;
    return null;
  }

  const e = entries[cursor] ?? entries[0];
  el.innerHTML = entryHtml(e, cursor) + trailHtml();
  if (clear) clear.hidden = false;

  const failed = !!e.error || e.result?.error === true;
  if (failed) return null;
  return (BODIES[e.tool] ?? (() => ({ spotlight: null })))(e.result ?? {}).spotlight;
}

/** Record a completed tool call and paint it. @returns the spotlight to apply. */
export function record({ tool, args, result, error, ms }) {
  entries.unshift({
    tool,
    args,
    result,
    error,
    ms,
    seq: ++seq,
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
  entries.length = Math.min(entries.length, MAX_TRAIL);
  cursor = 0;
  return paint();
}

/** Re-expand an earlier call from the trail. @returns its spotlight. */
export function show(i) {
  if (i < 0 || i >= entries.length) return null;
  cursor = i;
  return paint();
}

export function clear() {
  entries.length = 0;
  cursor = 0;
  return paint();
}

export const count = () => entries.length;
