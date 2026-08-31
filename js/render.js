// Rendering. One renderer per tool, each turning a tool result into DOM and
// driving the matching map layer — so the page always shows exactly what the
// agent was told, never a prettier version of it.

import { gaugeBar, hydrograph, barChart, fmt } from "./charts.js";
import * as Map from "./map.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const html = (strings, ...values) => {
  const node = document.createElement("div");
  node.innerHTML = String.raw({ raw: strings }, ...values);
  return node;
};

const date = (iso, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", withTime
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium" })
    : "—";

const n = (v) => (typeof v === "number" ? v.toLocaleString() : "—");

/**
 * @param {object} [opts]
 * @param {boolean} [opts.compact] Narrow enough to fit the results column
 *   without a horizontal scroll. Only for tables of six columns or fewer —
 *   the default width exists so a ten-column casualty table stays readable.
 */
function table(headers, rows, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "tablewrap";
  wrap.innerHTML =
    `<table class="${opts.compact ? "compact" : ""}"><thead><tr>${headers
      .map((h) => `<th class="${h.numeric ? "n" : ""}${h.wide ? " w" : ""}">${esc(h.label)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map((cells) =>
        `<tr>${cells
          .map((c, i) => `<td class="${headers[i]?.numeric ? "n" : ""}${headers[i]?.wide ? " w" : ""}">${c}</td>`)
          .join("")}</tr>`)
      .join("")}</tbody></table>`;
  return wrap;
}

function note(text) {
  const p = document.createElement("p");
  p.className = "panel-note";
  p.style.margin = "0.6rem 0 0";
  p.textContent = text;
  return p;
}

const statusTag = (severity, label) =>
  `<span class="tag tag--${severity}">${esc(label ?? severity)}</span>`;

/** Tools whose answers have a place on the map. Everything else clears it. */
const SPATIAL = new Set([
  "get_current_situation", "get_damage_assessment",
  "query_incidents", "get_river_status", "get_road_closures",
  "find_nearby_resources", "find_coverage_gaps", "get_flood_forecast",
]);

// ---------------------------------------------------------------------------

const RENDERERS = {
  /** The national picture: headline numbers first, then who is worst off. */
  get_current_situation(result) {
    const frag = document.createDocumentFragment();
    const t = result.totals ?? {};

    const tile = (value, label, tone) =>
      `<div class="stat${tone ? ` stat--${tone}` : ""}">` +
      `<div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div></div>`;

    frag.append(
      html`<div class="stats">
        ${tile(n(t.deaths), `dead · last ${t.windowDays} days`, t.deaths ? "critical" : null)}
        ${tile(n(t.missing), "missing", t.missing ? "serious" : null)}
        ${tile(n(t.injured), "injured", t.injured ? "warning" : null)}
        ${tile(n(t.roadsClosed), "roads closed now", t.roadsClosed ? "serious" : null)}
        ${tile(n(t.householdsCutOff), "households cut off", t.householdsCutOff ? "warning" : null)}
        ${tile(n(t.gaugesElevated), "gauges near warning", t.gaugesElevated ? "warning" : null)}
      </div>`.firstElementChild
    );

    if (result.data?.length) {
      frag.append(
        table(
          [
            { label: "District" }, { label: "What is happening", wide: true },
            { label: "Dead", numeric: true }, { label: "Missing", numeric: true },
            { label: "Injured", numeric: true },
            { label: "Cut off", numeric: true },
          ],
          result.data.map((d) => [
            `${esc(d.district)}${d.carriedForRoadClosure ? ` <span class="tag tag--warning">cut off</span>` : ""}` +
              `${d.districtNe ? `<div class="ne dim">${esc(d.districtNe)}</div>` : ""}`,
            esc(d.hazards.join(", ")) || `<span class="dim">road closure only</span>`,
            d.deaths ? `<b>${d.deaths}</b>` : "0",
            n(d.missing), n(d.injured),
            // Roads and the people behind them are one fact, not two columns —
            // and the households figure is the one a relief planner reads.
            d.roadsBlocked
              ? `<b>${n(d.householdsCutOff)}</b><div class="dim">${d.roadsBlocked} road${d.roadsBlocked === 1 ? "" : "s"}</div>`
              : `<span class="dim">—</span>`,
          ]),
          { compact: true }
        )
      );
      const carried = result.data.filter((d) => d.carriedForRoadClosure);
      frag.append(note(
        "Ranked by lives first — deaths and missing, then injuries, then people cut off. " +
        "Deliberately not by incident count, which would rank the districts that report most diligently." +
        (carried.length
          ? ` ${carried.map((d) => d.district).join(", ")} ` +
            `${carried.length === 1 ? "is" : "are"} carried in below the cut: no recorded deaths, but a road ` +
            `still closed and people behind it.`
          : "")
      ));
    }

    // The incidents behind the ranking belong on the map, not just in a table.
    Map.showIncidents(result.incidentPoints ?? []);
    return frag;
  },

  /** Satellite damage grading, one row per mapped area. */
  get_damage_assessment(result) {
    const frag = document.createDocumentFragment();
    if (!result.data?.length) {
      frag.append(html`<p class="empty">No Copernicus EMS area of interest matched. An activation that has not been graded yet is mapped, not undamaged.</p>`.firstElementChild);
      return frag;
    }

    Map.showIncidents(
      result.data.filter((r) => r.point).map((r) => ({
        point: r.point,
        title: `${r.area} — ${r.share}`,
        hazard: "satellite damage grading",
        district: r.district,
        incidentOn: r.imagedAt,
        verified: true,
        dataSource: r.sensor,
        loss: null,
      }))
    );

    frag.append(
      table(
        [
          { label: "Area" }, { label: "District" },
          { label: "Buildings affected", numeric: true }, { label: "Share", numeric: true },
          { label: "Imaged" },
        ],
        result.data.map((r) => [
          `${esc(r.area)}<div class="dim">${esc(r.activation)}</div>`,
          esc(r.district ?? "—"),
          r.buildingsAffected ? `<b>${esc(r.buildingsAffected)}</b>` : `<span class="dim">not graded</span>`,
          // The tag carries the percentage only. Spelling out "of surveyed
          // buildings affected" in every row stretched the table until the
          // acquisition time was clipped off the end of it.
          statusTag(r.severity, String(r.share).match(/\d+%/)?.[0] ?? "not graded"),
          `${esc(r.sensor ?? "—")}<div class="dim">${esc(String(r.imagedAt ?? "").slice(0, 16).replace("T", " "))}</div>`,
        ]),
        { compact: true }
      )
    );

    frag.append(note(
      "Share is of the buildings Copernicus surveyed in that area, not of the settlement. Counted from " +
      "satellite imagery rather than a field report — which is why this can disagree with the incident " +
      "record, and why it is worth asking when the record looks quiet."
    ));
    return frag;
  },

  query_incidents(result) {
    const frag = document.createDocumentFragment();
    Map.showIncidents(result.data);

    if (!result.data.length) {
      frag.append(html`<p class="empty">No incidents matched. That may mean nothing was recorded — not that nothing happened.</p>`.firstElementChild);
      return frag;
    }

    frag.append(
      table(
        [
          { label: "Date" }, { label: "Incident", wide: true }, { label: "Hazard" }, { label: "District" },
          { label: "Dead", numeric: true }, { label: "Missing", numeric: true },
          { label: "Affected", numeric: true }, { label: "Record" },
        ],
        result.data.slice(0, 60).map((i) => [
          `<span class="mono">${date(i.incidentOn)}</span>`,
          `${esc(i.title)}${i.titleNe ? `<div class="ne dim">${esc(i.titleNe)}</div>` : ""}`,
          esc(i.hazard),
          `${esc(i.district ?? "—")}${i.municipality ? `<div class="dim">${esc(i.municipality)}</div>` : ""}`,
          i.loss?.deaths ? `<b>${i.loss.deaths}</b>` : "0",
          n(i.loss?.missing ?? 0),
          n(i.loss?.affected ?? 0),
          i.verified
            ? `<span class="tag tag--normal">verified</span>`
            : `<span class="tag tag--approaching">unverified</span>`,
        ])
      )
    );

    if (result.data.length > 60) frag.append(note(`Showing 60 of ${result.data.length} incidents.`));
    return frag;
  },

  get_casualty_breakdown(result) {
    const frag = document.createDocumentFragment();
    const rows = result.data;
    if (!rows.length) return frag;

    // Sex breakdown only earns a stacked chart when the record actually holds it.
    const hasSplit = rows.some((r) => r.deathsMale + r.deathsFemale + r.deathsOther > 0);
    const fields = hasSplit
      ? [
          { key: "deathsMale", label: "male" },
          { key: "deathsFemale", label: "female" },
          { key: "deathsOther", label: "other / unrecorded" },
        ]
      : [{ key: "incidents", label: "incidents" }];

    const fig = document.createElement("figure");
    fig.className = "chart";
    const cap = document.createElement("figcaption");
    cap.textContent = hasSplit
      ? `Deaths by ${result.groupBy}, split by recorded sex`
      : `Incidents by ${result.groupBy} — the record logs no sex-disaggregated deaths for this query`;
    fig.append(cap, barChart(rows, { fields }));
    frag.append(fig);

    if (result.totals?.deathsDisabled > 0) {
      frag.append(
        html`<div class="caveat">${result.totals.deathsDisabled} of ${result.totals.deaths} recorded deaths were of people the record marks as disabled. This field exists in BIPAD and is published nowhere.</div>`.firstElementChild
      );
    }

    frag.append(
      table(
        [
          { label: result.groupBy }, { label: "Incidents", numeric: true },
          { label: "Dead", numeric: true }, { label: "Male", numeric: true },
          { label: "Female", numeric: true }, { label: "Disabled", numeric: true },
          { label: "Missing", numeric: true }, { label: "Injured", numeric: true },
          { label: "Houses lost", numeric: true }, { label: "Bridges lost", numeric: true },
        ],
        rows.map((r) => [
          `<b>${esc(r.group)}</b>`, n(r.incidents), r.deaths ? `<b>${r.deaths}</b>` : "0",
          n(r.deathsMale), n(r.deathsFemale), n(r.deathsDisabled),
          n(r.missing), n(r.injured), n(r.housesDestroyed), n(r.bridgesDestroyed),
        ])
      )
    );
    return frag;
  },

  get_river_status(result) {
    const frag = document.createDocumentFragment();
    Map.showStations(result.data);

    const list = document.createElement("div");
    list.className = "stationlist";

    // Lead with what is closest to its threshold; the rest goes in the table.
    for (const s of result.data.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "gauge";
      const head =
        s.metresBelowWarning == null
          ? "no warning level published"
          : s.metresBelowWarning > 0
            ? `${fmt(s.metresBelowWarning)} m below warning`
            : `${fmt(Math.abs(s.metresBelowWarning))} m ABOVE warning`;

      row.append(
        html`<div class="gauge-name">${esc(s.title)}</div>`.firstElementChild,
        html`<div>${statusTag(s.severity, s.severity === "approaching" ? "nearing" : s.severity)}
             <span class="trend trend--${String(s.trend ?? "").toLowerCase()}">${esc(s.trend ?? "")}</span></div>`.firstElementChild
      );
      row.append(gaugeBar(s));
      row.append(
        html`<div class="gauge-sub">${esc(s.basin ?? "—")} basin · ${fmt(s.waterLevel)} m · ${esc(head)} · observed ${date(s.observedAt, true)}</div>`.firstElementChild
      );
      list.append(row);
    }
    frag.append(list);

    if (result.data.length > 8) {
      frag.append(
        table(
          [
            { label: "Station" }, { label: "Basin" }, { label: "Level (m)", numeric: true },
            { label: "Warning", numeric: true }, { label: "Danger", numeric: true },
            { label: "Headroom (m)", numeric: true }, { label: "Trend" }, { label: "Status" },
          ],
          result.data.slice(8).map((s) => [
            esc(s.title), esc(s.basin ?? "—"), fmt(s.waterLevel),
            s.warningLevel ?? "—", s.dangerLevel ?? "—",
            s.metresBelowWarning ?? "—",
            `<span class="trend trend--${String(s.trend ?? "").toLowerCase()}">${esc(s.trend ?? "—")}</span>`,
            statusTag(s.severity, s.severity === "approaching" ? "nearing" : s.severity),
          ])
        )
      );
    }
    return frag;
  },

  get_flood_forecast(result) {
    const frag = document.createDocumentFragment();
    const { series, point, label } = result.data ?? {};
    if (!series?.length) return frag;

    Map.focusPoint(point, 10);

    const fig = document.createElement("figure");
    fig.className = "chart";
    const cap = document.createElement("figcaption");
    cap.textContent = `Modelled river discharge at ${label ?? "this point"} — GloFAS via Open-Meteo`;
    fig.append(cap, hydrograph(series));
    frag.append(fig);

    frag.append(
      html`<div class="caveat">This is a model, not a measurement, and it is not a warning. The Department of Hydrology and Meteorology issues Nepal's flood warnings — call <b>1155</b>.</div>`.firstElementChild
    );
    return frag;
  },

  get_road_closures(result) {
    const frag = document.createDocumentFragment();
    Map.showRoads(result.data);
    if (!result.data.length) return frag;

    frag.append(
      table(
        [
          { label: "Road", wide: true }, { label: "Where" }, { label: "Status" }, { label: "Reason", wide: true },
          { label: "Households cut off", numeric: true },
          { label: "Estimated" }, { label: "Actual" }, { label: "Contact" },
        ],
        result.data.slice(0, 50).map((r) => [
          `<b class="mono">${esc(r.road ?? "—")}</b><div class="dim">${esc(r.title)}</div>`,
          esc(r.location ?? "—"),
          statusTag(
            r.status === "CLOSED" ? "danger" : r.status === "PARTIAL_OPEN" ? "approaching" : "normal",
            r.status === "PARTIAL_OPEN" ? "partial" : r.status.toLowerCase()
          ),
          `${esc(r.closureReason ?? "—")}${r.efforts ? `<div class="dim">${esc(r.efforts)}</div>` : ""}`,
          r.householdsCutOff ? `<b>${n(r.householdsCutOff)}</b>` : "—",
          esc(r.repairEta ?? "—"),
          r.delayHours != null && r.delayHours > 0
            ? `${esc(r.actualRepairTime ?? "—")}<div class="dim">+${fmt(r.delayHours, 1)} h over</div>`
            : esc(r.actualRepairTime ?? "—"),
          esc(r.contactPerson ?? "—"),
        ])
      )
    );

    if (result.totals?.overruns) {
      frag.append(
        note(`${result.totals.overruns} of ${result.totals.records} roadblocks took longer to clear than the Department of Roads estimated. That gap is published in the feed and reported nowhere.`)
      );
    }
    return frag;
  },

  find_nearby_resources(result) {
    const frag = document.createDocumentFragment();
    Map.showResources(result.data);
    if (result.centre) Map.focusPoint(result.centre.latlon, 11);

    if (!result.data.length) {
      frag.append(html`<p class="empty">Nothing of that kind is registered here.</p>`.firstElementChild);
      return frag;
    }

    frag.append(
      table(
        [{ label: "Facility", wide: true }, { label: "Type" }, { label: "Distance (km)", numeric: true }],
        result.data.map((r) => [
          `${esc(r.title)}${r.titleNe ? `<div class="ne dim">${esc(r.titleNe)}</div>` : ""}`,
          esc(r.label ?? r.type),
          fmt(r.km, 1),
        ])
      )
    );
    return frag;
  },

  find_coverage_gaps(result) {
    const frag = document.createDocumentFragment();
    Map.showGaps(result.data);
    if (!result.data.length) return frag;

    // A gap list is a list — a chart would decorate an absence, not explain it.
    frag.append(
      table(
        [
          { label: "Municipality", wide: true }, { label: "District" },
          { label: "Incidents", numeric: true }, { label: "Dead", numeric: true },
          { label: "Affected", numeric: true }, { label: "Most recent" },
        ],
        result.data.slice(0, 60).map((g) => [
          `<b>${esc(g.municipality)}</b>${g.municipalityNe ? `<div class="ne dim">${esc(g.municipalityNe)}</div>` : ""}`,
          esc(g.district ?? "—"),
          n(g.incidents),
          g.deaths ? `<b>${g.deaths}</b>` : "0",
          n(g.peopleAffected),
          date(g.lastIncident),
        ])
      )
    );
    if (result.data.length > 60) frag.append(note(`Showing 60 of ${result.data.length} municipalities.`));
    return frag;
  },

  get_global_alert_status(result) {
    const frag = document.createDocumentFragment();
    frag.append(
      table(
        [{ label: "Event", wide: true }, { label: "Type" }, { label: "Alert" }, { label: "GLIDE" }, { label: "From" }, { label: "Report" }],
        result.data.slice(0, 30).map((e) => [
          esc(e.name ?? "—"),
          esc(e.type),
          statusTag(
            e.alertLevel === "Red" ? "danger" : e.alertLevel === "Orange" ? "warning" : "normal",
            e.alertLevel ?? "—"
          ),
          `<span class="mono">${esc(e.glide ?? "—")}</span>`,
          date(e.from),
          `<a href="${esc(e.url)}" target="_blank" rel="noopener">GDACS ↗</a>`,
        ])
      )
    );
    return frag;
  },

  find_mapping_task(result) {
    const d = result.data;
    const frag = document.createDocumentFragment();
    frag.append(
      html`<div class="provenance-body">
        <div><b>Campaign</b> ${esc(d.name)} · opened ${esc(d.openedOn)}<br>
        Coordinated by ${esc(d.coordinatedBy)}<br>
        Hashtag <span class="mono">${esc(d.hashtag)}</span></div>
        <div><b>Why this matters here</b><br>
        This app reads OpenStreetMap for roads and facilities. Where the map is thin, the answers are thin.
        Tracing buildings for fifteen minutes improves the same data the next query reads.</div>
      </div>`.firstElementChild
    );
    return frag;
  },

  get_verified_donation_channels(result) {
    const frag = document.createDocumentFragment();
    frag.append(
      table(
        [{ label: "Channel", wide: true }, { label: "Note", wide: true }, { label: "Scope" }],
        result.data.map((c) => [
          `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>`,
          esc(c.note),
          `<span class="dim">${esc(c.scope)}</span>`,
        ])
      )
    );
    frag.append(
      html`<div class="caveat"><b>Spotting a fake appeal.</b><ul style="margin:.4rem 0 0;padding-left:1rem">
        ${result.fraudWarning.map((w) => `<li>${esc(w)}</li>`).join("")}
      </ul></div>`.firstElementChild
    );
    return frag;
  },

  compose_cap_alert(result) {
    const frag = document.createDocumentFragment();
    if (!result.data) return frag;

    const pre = document.createElement("pre");
    pre.className = "cap";
    pre.textContent = result.data.xml;
    frag.append(pre);

    const copy = document.createElement("button");
    copy.className = "action";
    copy.type = "button";
    copy.textContent = "Copy CAP XML";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.data.xml);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy CAP XML"), 1800);
      } catch {
        copy.textContent = "Select the text above to copy";
      }
    });
    const bar = document.createElement("div");
    bar.className = "actions";
    bar.append(copy);
    frag.append(bar);
    return frag;
  },
};

// ---------------------------------------------------------------------------

/**
 * Build one result card.
 * @param {string} toolName
 * @param {object} result
 * @param {{caller?: "you"|"agent"}} opts
 */
export function renderResult(toolName, result, { caller = "you" } = {}) {
  const card = document.createElement("article");
  card.className = `result${caller === "agent" ? " result--agent" : ""}${result.error ? " result--error" : ""}`;

  const head = document.createElement("div");
  head.className = "result-head";
  head.innerHTML =
    `<span class="result-tool">${esc(toolName)}</span>` +
    `<span class="result-caller">${caller === "agent" ? "called by agent" : "you asked"}</span>` +
    `<span class="result-time">${new Date().toLocaleTimeString("en-GB")}</span>`;
  card.append(head);

  const summary = document.createElement("p");
  summary.className = "result-summary";
  summary.textContent = result.summary ?? "";
  card.append(summary);

  if (result.caveat) {
    const c = document.createElement("div");
    c.className = "caveat";
    c.textContent = result.caveat;
    card.append(c);
  }

  const body = document.createElement("div");
  body.className = "result-body";

  // A result with no map of its own must not inherit the last one's. Leaving
  // the previous answer's markers on screen beside a different answer is how a
  // map starts lying.
  if (!SPATIAL.has(toolName) || result.error) Map.clearData();

  try {
    const renderer = RENDERERS[toolName];
    if (renderer && !result.error) body.append(renderer(result));
  } catch (err) {
    console.error(`render ${toolName}`, err);
    body.append(note(`Could not render this result: ${err.message}`));
  }

  if (result.provenance?.length) body.append(provenance(result.provenance));
  if (result.actions?.length) body.append(actions(result.actions));

  card.append(body);
  return card;
}

function provenance(sources) {
  const d = document.createElement("details");
  d.className = "provenance";
  d.innerHTML =
    `<summary>Where these numbers came from</summary>` +
    `<div class="provenance-body">${sources
      .map((p) =>
        `<div><b>${esc(p.source)}</b><br>${esc(p.endpoint)}<br>` +
        `retrieved ${date(p.retrievedAt, true)}` +
        (p.note ? `<br><i>${esc(p.note)}</i>` : "") + `</div>`)
      .join("")}</div>`;
  return d;
}

/** Every result ends in a verb. That constraint is the product. */
function actions(list) {
  const wrap = document.createElement("div");
  wrap.className = "actions";
  wrap.innerHTML = `<span class="actions-label">What you can do about it</span>`;

  for (const a of list) {
    if (a.href) {
      const link = document.createElement("a");
      link.className = "action";
      link.href = a.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = a.verb;
      wrap.append(link);
    } else if (a.tool) {
      const btn = document.createElement("button");
      btn.className = "action";
      btn.type = "button";
      btn.textContent = a.verb;
      btn.dataset.tool = a.tool;
      btn.dataset.args = JSON.stringify(a.args ?? {});
      wrap.append(btn);
    }
  }
  return wrap.children.length > 1 ? wrap : document.createComment("no actions");
}
