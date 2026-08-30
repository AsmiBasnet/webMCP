// Inline SVG charts. No library — three forms, each chosen for the job the
// data does, drawn against the validated palette in styles.css.
//
//   gaugeBar   status  — one reading against its own two thresholds
//   hydrograph change  — discharge over time, observed then forecast
//   barChart   magnitude — casualties per year, optionally split by sex

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  if (text !== undefined) n.textContent = String(text);
  return n;
}

const STATUS_VAR = {
  danger: "var(--critical)",
  warning: "var(--serious)",
  approaching: "var(--warning)",
  normal: "var(--good)",
  unknown: "var(--ink-3)",
};

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

const fmt = (n, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : Number(n.toFixed(digits)).toLocaleString();

// ---------------------------------------------------------------------------
// Gauge — a bullet bar. The reading, and the two lines it must not cross.
// ---------------------------------------------------------------------------

/**
 * Water level against this station's own warning and danger marks.
 *
 * The domain is local to the station: many gauges report metres above sea
 * level, so a shared or zero-based axis would compress every reading into an
 * unreadable sliver at the far right.
 */
export function gaugeBar(station, { width = 520, height = 26 } = {}) {
  const { waterLevel: level, warningLevel: warn, dangerLevel: danger, severity } = station;

  const marks = [level, warn, danger].filter((v) => typeof v === "number");
  const lo = Math.min(...marks);
  const hi = Math.max(...marks);
  const pad = (hi - lo || Math.max(hi * 0.02, 0.5)) * 0.35;
  const min = lo - pad;
  const max = hi + pad;

  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label":
      `${station.title}: water level ${fmt(level)} metres` +
      (warn != null ? `, warning level ${fmt(warn)}` : "") +
      (danger != null ? `, danger level ${fmt(danger)}` : "") +
      `. Status: ${severity}.`,
  });

  const x = (v) => ((v - min) / (max - min)) * width;
  const barY = 6;
  const barH = 10;

  // Track — recessive, the full local range.
  svg.append(el("rect", { x: 0, y: barY, width, height: barH, rx: 2, fill: "var(--panel-3)" }));

  // The reading. Rounded data-end, square against the baseline.
  const w = Math.max(2, x(level));
  const fill = el("path", {
    d: roundedRight(0, barY, w, barH, 4),
    fill: STATUS_VAR[severity] ?? STATUS_VAR.unknown,
  });
  svg.append(fill);

  // Thresholds — hairlines with a surface gap so they read on top of the fill.
  for (const [value, label, color] of [
    [warn, "warning", "var(--warning)"],
    [danger, "danger", "var(--critical)"],
  ]) {
    if (typeof value !== "number") continue;
    const tx = x(value);
    svg.append(el("line", {
      x1: tx, x2: tx, y1: 1, y2: barY + barH + 4,
      stroke: "var(--panel)", "stroke-width": 4,
    }));
    svg.append(el("line", {
      x1: tx, x2: tx, y1: 1, y2: barY + barH + 4,
      stroke: color, "stroke-width": 1.5,
    }));
    const anchor = tx > width * 0.82 ? "end" : "start";
    svg.append(el("text", {
      x: anchor === "end" ? tx - 4 : tx + 4,
      y: height - 0.5,
      "text-anchor": anchor,
      "font-family": "var(--mono)",
      "font-size": 8,
      fill: color,
      "letter-spacing": "0.06em",
    }, `${label} ${fmt(value)}`));
  }

  return svg;
}

/** A bar with only its far end rounded — the near end stays on the baseline. */
function roundedRight(x, y, w, h, r) {
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} ` +
         `V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`;
}

// ---------------------------------------------------------------------------
// Hydrograph — observed past, forecast future, one axis.
// ---------------------------------------------------------------------------

/**
 * @param {{date:string, discharge:number|null}[]} series
 * @param {{today?: string, unit?: string}} opts
 */
export function hydrograph(series, { today = new Date().toISOString().slice(0, 10), unit = "m³/s" } = {}) {
  const points = series.filter((p) => typeof p.discharge === "number");
  const wrap = document.createElement("div");
  if (points.length < 2) {
    wrap.className = "empty";
    wrap.textContent = "Not enough forecast points to plot.";
    return wrap;
  }

  const W = 640, H = 200;
  const M = { top: 12, right: 14, bottom: 24, left: 44 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const values = points.map((p) => p.discharge);
  const vmax = Math.max(...values);
  const vmin = Math.min(...values);
  const span = vmax - vmin || 1;
  const yMax = vmax + span * 0.15;
  const yMin = Math.max(0, vmin - span * 0.15);

  const x = (i) => M.left + (i / (points.length - 1)) * iw;
  const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `River discharge from ${points[0].date} to ${points.at(-1).date}, in ${unit}.`,
  });

  // Recessive grid — four lines, labelled, nothing more.
  for (let i = 0; i <= 3; i++) {
    const v = yMin + ((yMax - yMin) * i) / 3;
    svg.append(el("line", {
      x1: M.left, x2: W - M.right, y1: y(v), y2: y(v),
      stroke: "var(--rule)", "stroke-width": 1,
    }));
    svg.append(el("text", {
      x: M.left - 6, y: y(v) + 3, "text-anchor": "end",
      "font-family": "var(--mono)", "font-size": 9, fill: "var(--ink-3)",
    }, fmt(v, 1)));
  }

  const splitAt = points.findIndex((p) => p.date >= today);
  const boundary = splitAt < 0 ? points.length - 1 : splitAt;

  // "Now" divider — everything to its right is a model, not an observation.
  if (splitAt > 0 && splitAt < points.length) {
    const bx = x(boundary);
    svg.append(el("line", {
      x1: bx, x2: bx, y1: M.top, y2: M.top + ih,
      stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "2 3",
    }));
    svg.append(el("text", {
      x: bx + 4, y: M.top + 9,
      "font-family": "var(--mono)", "font-size": 8, fill: "var(--ink-3)",
      "letter-spacing": "0.08em",
    }, "NOW"));
  }

  const line = (from, to) =>
    points.slice(from, to).map((p, k) => `${k ? "L" : "M"}${x(from + k)},${y(p.discharge)}`).join(" ");

  // Observed — solid. Forecast — dashed. The distinction is not decorative.
  svg.append(el("path", {
    d: line(0, boundary + 1),
    fill: "none", stroke: "var(--series-1)", "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round",
  }));
  svg.append(el("path", {
    d: line(boundary, points.length),
    fill: "none", stroke: "var(--series-1)", "stroke-width": 2,
    "stroke-dasharray": "5 4", "stroke-linecap": "round", opacity: 0.85,
  }));

  // Peak, direct-labelled. This must be the FORECAST peak — the same number the
  // tool reports in its summary. Labelling the highest point in the whole
  // window instead would put a different figure on the chart than in the text.
  const forecastIdx = points.reduce(
    (best, p, i) => (p.date >= today && (best < 0 || p.discharge > points[best].discharge) ? i : best),
    -1
  );
  const peakIdx = forecastIdx >= 0 ? forecastIdx : values.indexOf(vmax);
  const peakVal = points[peakIdx].discharge;

  svg.append(el("circle", {
    cx: x(peakIdx), cy: y(peakVal), r: 4.5,
    fill: "var(--series-1)", stroke: "var(--panel)", "stroke-width": 2,
  }));
  svg.append(el("text", {
    x: Math.min(x(peakIdx) + 8, W - M.right - 76),
    y: Math.max(y(peakVal) - 7, M.top + 8),
    "font-family": "var(--mono)", "font-size": 9, fill: "var(--ink)",
  }, `${forecastIdx >= 0 ? "forecast peak" : "peak"} ${fmt(peakVal, 2)} ${unit}`));

  // Date axis — first, boundary, last only.
  for (const i of [...new Set([0, boundary, points.length - 1])]) {
    svg.append(el("text", {
      x: x(i), y: H - 6,
      "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle",
      "font-family": "var(--mono)", "font-size": 9, fill: "var(--ink-3)",
    }, points[i].date.slice(5)));
  }

  // Hover: crosshair + readout.
  const hoverLine = el("line", {
    y1: M.top, y2: M.top + ih, stroke: "var(--water)", "stroke-width": 1, opacity: 0,
  });
  const hoverDot = el("circle", { r: 4, fill: "var(--water)", stroke: "var(--panel)", "stroke-width": 2, opacity: 0 });
  svg.append(hoverLine, hoverDot);

  const readout = document.createElement("div");
  readout.className = "legend";
  // The swatches sample the actual stroke — solid against dashed — because the
  // two series share a hue and the dash is what tells them apart.
  readout.innerHTML =
    `<span class="legend-key"><svg width="20" height="10" aria-hidden="true">` +
      `<line x1="0" y1="5" x2="20" y2="5" stroke="var(--series-1)" stroke-width="2"/></svg>observed</span>` +
    `<span class="legend-key"><svg width="20" height="10" aria-hidden="true">` +
      `<line x1="0" y1="5" x2="20" y2="5" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="5 4"/></svg>` +
      `forecast (GloFAS model)</span>` +
    `<span class="legend-key" data-readout></span>`;
  const readoutSlot = readout.querySelector("[data-readout]");

  svg.addEventListener("pointermove", (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - M.left) / iw) * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, i))];
    if (!p) return;
    const idx = points.indexOf(p);
    hoverLine.setAttribute("x1", x(idx));
    hoverLine.setAttribute("x2", x(idx));
    hoverLine.setAttribute("opacity", 0.55);
    hoverDot.setAttribute("cx", x(idx));
    hoverDot.setAttribute("cy", y(p.discharge));
    hoverDot.setAttribute("opacity", 1);
    readoutSlot.textContent = `${p.date} · ${fmt(p.discharge, 2)} ${unit}${p.date >= today ? " (forecast)" : ""}`;
  });
  svg.addEventListener("pointerleave", () => {
    hoverLine.setAttribute("opacity", 0);
    hoverDot.setAttribute("opacity", 0);
    readoutSlot.textContent = "";
  });

  wrap.append(svg, readout);
  return wrap;
}

// ---------------------------------------------------------------------------
// Bars — magnitude across a categorical or time axis.
// ---------------------------------------------------------------------------

/**
 * @param {{group:string, [k:string]:number}[]} rows
 * @param {{fields: {key:string,label:string}[], unit?:string, max?:number}} opts
 *   One field draws a plain bar; two or three stack, with a legend.
 */
export function barChart(rows, { fields, unit = "" } = {}) {
  const wrap = document.createElement("div");
  if (!rows.length || !fields?.length) {
    wrap.className = "empty";
    wrap.textContent = "Nothing to plot.";
    return wrap;
  }

  const shown = rows.slice(0, 24);
  const stacked = fields.length > 1;
  const totalOf = (r) => fields.reduce((s, f) => s + (Number(r[f.key]) || 0), 0);
  const vmax = Math.max(1, ...shown.map(totalOf));

  const W = 640;
  const barH = 22;
  const gap = 6;
  const M = { top: 4, right: 52, bottom: 4, left: 116 };
  const H = M.top + M.bottom + shown.length * (barH + gap);
  const iw = W - M.left - M.right;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `${fields.map((f) => f.label).join(" and ")} by ${"group"}, ${shown.length} rows.`,
  });

  shown.forEach((r, i) => {
    const y = M.top + i * (barH + gap);

    svg.append(el("text", {
      x: M.left - 8, y: y + barH / 2 + 3.5, "text-anchor": "end",
      "font-family": "var(--mono)", "font-size": 10, fill: "var(--ink-2)",
    }, truncate(r.group, 17)));

    let cursor = M.left;
    fields.forEach((f, fi) => {
      const v = Number(r[f.key]) || 0;
      if (v <= 0) return;
      const w = (v / vmax) * iw;
      const last = fi === fields.findLastIndex((ff) => (Number(r[ff.key]) || 0) > 0);
      const rect = el("path", {
        // Only the outermost segment gets the rounded data-end.
        d: last ? roundedRight(cursor, y, Math.max(w, 2), barH, 4)
                : `M${cursor},${y} h${Math.max(w, 2)} v${barH} h${-Math.max(w, 2)} Z`,
        fill: SERIES[fi % SERIES.length],
      });
      rect.append(el("title", {}, `${r.group} — ${f.label}: ${fmt(v, 0)} ${unit}`.trim()));
      svg.append(rect);
      // 2px surface gap between stacked segments.
      cursor += Math.max(w, 2) + (stacked ? 2 : 0);
    });

    const t = totalOf(r);
    svg.append(el("text", {
      x: Math.min(cursor + 6, W - 4), y: y + barH / 2 + 3.5,
      "font-family": "var(--mono)", "font-size": 10, fill: "var(--ink)",
    }, fmt(t, 0)));
  });

  wrap.append(svg);

  if (stacked) {
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = fields
      .map((f, i) =>
        `<span class="legend-key"><span class="legend-swatch" style="background:${SERIES[i % SERIES.length]}"></span>${f.label}</span>`)
      .join("");
    wrap.append(legend);
  }

  return wrap;
}

const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

export { fmt };
