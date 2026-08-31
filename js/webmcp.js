// WebMCP — the same page, addressed by an agent instead of a mouse.
//
// https://developer.chrome.com/docs/ai/webmcp
//
// Every tool here drives the live view through exactly the paths a person's
// clicks drive it: it mutates `state.filters`, then re-renders. There is no
// second code path and no agent-only data. What the agent asks for, the human
// watching sees happen — the filter chips move, the list re-sorts, the map
// pans. That is the point of WebMCP over DOM actuation: the page declares what
// it can do, rather than the agent guessing which button to click.
//
// Nothing here is visible in the interface. The tools exist for agents and for
// DevTools; the page renders identically whether or not anything reads them.
//
// The API lives on `document.modelContext` (Chrome 149+, behind
// chrome://flags/#enable-webmcp-testing or the origin trial). Older builds and
// polyfills expose `navigator.modelContext`; both are accepted. Where neither
// exists we install a local shim so the tools are still callable from the
// console and from Playwright — see installShim(). The shim announces itself,
// because a tool surface pretending to be a browser API it is not would be the
// same kind of lie as a stale figure shown as live.

import { SOURCES, SEVERITIES, applyFilters, facets } from "./feed.js";
import { health } from "./api.js";

// --- schema helpers --------------------------------------------------------

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const int = (description, extra = {}) => ({ type: "number", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const strs = (description, extra = {}) => ({ type: "array", items: { type: "string", ...extra }, description });

const SOURCE_IDS = SOURCES.map((s) => s.id);
const DISTRICT_HINT =
  'A district name exactly as it appears in this view, e.g. "Rasuwa". ' +
  "Call list_filter_options first if you are unsure — the spelling must match.";

// The caveat every answer carries. These are casualty figures; an agent
// repeating them should be able to say where they came from, and should never
// present a fetch failure as an absence of events.
const FOOTER =
  "Unofficial view of public data. It issues no warnings and dispatches nothing. " +
  "Emergencies in Nepal: 100 Police, 102 Ambulance, 1149 National Emergency Operation Centre.";

// ---------------------------------------------------------------------------
// Tool definitions
//
// `specs(ctl)` closes over the dashboard's own controls, so a tool cannot reach
// past the interface into the data layer. Read tools are marked readOnlyHint;
// the five that move the view are not, because they change what the person on
// the other side of the screen is looking at.
// ---------------------------------------------------------------------------

function specs(ctl) {
  const { state, apply, refresh, select, focus, reset } = ctl;

  /** Rows currently on screen, in screen order. */
  const visible = () => applyFilters(state.records, state.filters);
  /** Everything inside the window, before severity/district/type/search. */
  const windowed = () => applyFilters(state.records, { days: state.filters.days });

  const brief = (r) => ({
    id: r.id,
    source: r.source,
    kind: r.kind,
    title: r.title,
    severity: r.severity,
    severityLabel: r.severityLabel,
    district: r.district,
    municipality: r.municipality,
    at: r.at,
    summary: r.line,
  });

  const sourceHealth = () => {
    const failed = new Set(state.errors.map((e) => e.source));
    return SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      origin: s.origin,
      cadence: s.cadence,
      status: failed.has(s.id) ? "unreachable" : state.stale.has(s.id) ? "snapshot" : "live",
      records: state.records.filter((r) => r.source === s.id).length,
      shown: state.filters.sources.has(s.id),
    }));
  };

  return [
    // -- read ---------------------------------------------------------------
    {
      name: "get_situation_summary",
      description:
        "START HERE. The current disaster picture for Nepal as this page has it: how many records are in the " +
        "window, how they break down by severity and by source, the worst-hit districts ranked by severity " +
        "rather than by record count, and how fresh each source is. Assembled from six live feeds — the BIPAD " +
        "incident record, DHM river gauges, Department of Roads closures, GDACS alerts, GloFAS forecasts and " +
        "Copernicus EMS satellite damage assessment. Use for 'what is happening in Nepal right now', 'where is " +
        "it worst', 'what should I look at first'. Read-only: it does not change the view.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const rows = windowed();
        const bySeverity = Object.fromEntries(
          SEVERITIES.map((s) => [s, rows.filter((r) => r.severity === s).length]).filter(([, n]) => n)
        );
        const bySource = Object.fromEntries(SOURCES.map((s) => [s.id, rows.filter((r) => r.source === s.id).length]));

        // Rank districts by what is worst in them, not by how many rows they
        // have: one fatal incident outranks nine gauge readings.
        const acc = new Map();
        for (const r of rows) {
          if (!r.district) continue;
          const d = acc.get(r.district) ?? { district: r.district, critical: 0, serious: 0, warning: 0, records: 0 };
          d.records += 1;
          if (d[r.severity] !== undefined) d[r.severity] += 1;
          acc.set(r.district, d);
        }
        const worstDistricts = [...acc.values()]
          .sort(
            (a, b) =>
              b.critical - a.critical || b.serious - a.serious || b.warning - a.warning || b.records - a.records
          )
          .slice(0, 8);

        return {
          summary:
            `${rows.length} records in the last ${state.filters.days} day(s): ` +
            (Object.entries(bySeverity).map(([s, n]) => `${n} ${s}`).join(", ") || "none") +
            ".",
          bySeverity,
          bySource,
          worstDistricts,
          sources: sourceHealth(),
          fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
        };
      },
    },
    {
      name: "list_records",
      description:
        "List the records currently on screen, worst first — one normalised row per incident, gauge reading, " +
        "road closure, alert, forecast point or satellite damage assessment. Returns the same rows the human " +
        "sees, in the same order, with the record id that get_record_details and select_record need. Optional " +
        "arguments narrow the returned list WITHOUT changing the view; use filter_records when you want the " +
        "person's screen to change too.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          source: str("Restrict to one source.", { enum: SOURCE_IDS }),
          severity: str("Restrict to one severity.", { enum: SEVERITIES }),
          district: str("Restrict to one district. " + DISTRICT_HINT),
          limit: int("Maximum rows to return. Default 25."),
        },
      },
      execute: async ({ source, severity, district, limit = 25 } = {}) => {
        let rows = visible();
        if (source) rows = rows.filter((r) => r.source === source);
        if (severity) rows = rows.filter((r) => r.severity === severity);
        if (district) rows = rows.filter((r) => r.district === district);
        const shown = rows.slice(0, Math.max(1, limit));
        return {
          summary: `${rows.length} matching record(s); returning ${shown.length}.`,
          total: rows.length,
          records: shown.map(brief),
        };
      },
    },
    {
      name: "get_record_details",
      description:
        "Everything one source published about a single record: every metric, its coordinates, its provenance " +
        "(which endpoint, on what cadence, live or from the stored snapshot) and optionally the raw payload " +
        "verbatim. Use after list_records to open up a specific row — 'tell me more about that gauge', 'what " +
        "exactly did the satellite grade in Timure'.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          id: str('Record id from list_records, e.g. "incident:12345" or "damage:EMSR927-AOI01".'),
          includeRaw: bool("Include the untouched source payload. Default false — it can be large."),
        },
        required: ["id"],
      },
      execute: async ({ id, includeRaw = false } = {}) => {
        const r = state.records.find((x) => x.id === id);
        if (!r) {
          return {
            summary: `No record with id ${id}. Call list_records for current ids — they change as the feed refreshes.`,
            error: true,
          };
        }
        const src = SOURCES.find((s) => s.id === r.source);
        return {
          summary: `${r.title} — ${r.line}`,
          record: {
            ...brief(r),
            titleNe: r.titleNe,
            point: r.point,
            metrics: Object.fromEntries(
              Object.entries(r.metrics).filter(([, v]) => v !== null && v !== undefined && v !== "")
            ),
            series: r.series ?? undefined,
          },
          provenance: {
            source: src?.origin ?? r.source,
            cadence: src?.cadence ?? "unknown",
            live: !state.stale.has(r.source) && !state.errors.some((e) => e.source === r.source),
          },
          raw: includeRaw ? r.raw : undefined,
        };
      },
    },
    {
      name: "list_filter_options",
      description:
        "The values filter_records will actually accept right now: every district and every hazard type present " +
        "in the current window, with counts, plus the six source ids, five severity levels, the available " +
        "windows and sort orders. Call this before filtering by a name you are not certain of — which districts " +
        "appear depends on what has been reported today, so a plausible-looking name may match nothing.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const { districts, kinds } = facets(applyFilters(state.records, { ...state.filters, district: "", kind: "" }));
        return {
          summary: `${districts.length} district(s) and ${kinds.length} hazard type(s) in the current window.`,
          districts: districts.map(([name, count]) => ({ name, count })),
          types: kinds.map(([name, count]) => ({ name, count })),
          sources: SOURCES.map((s) => ({ id: s.id, label: s.label, origin: s.origin, cadence: s.cadence })),
          severities: SEVERITIES,
          windows: [1, 2, 7, 30, 90],
          sorts: ["recency", "severity", "time"],
        };
      },
    },
    {
      name: "get_source_health",
      description:
        "Which of the six sources answered, which are serving a stored snapshot, and which are unreachable — " +
        "with the age of the data on screen. Call this before reporting that something did not happen: an empty " +
        "result from a dead feed is a data-source failure, not an absence of events, and the two must never be " +
        "conflated when the subject is casualties.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const sources = sourceHealth();
        const bad = sources.filter((x) => x.status !== "live");
        return {
          summary: bad.length
            ? `${bad.length} of ${sources.length} sources are not live: ${bad.map((x) => `${x.id} (${x.status})`).join(", ")}.`
            : `All ${sources.length} sources answered live.`,
          fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
          ageSeconds: state.fetchedAt ? Math.round((Date.now() - state.fetchedAt) / 1000) : null,
          sources,
          networkFailures: Object.fromEntries(health.failed),
        };
      },
    },

    // -- write: these move the page the person is looking at -----------------
    {
      name: "filter_records",
      description:
        "Change what the live view is showing — the same controls the filter bar offers, composable in one " +
        "call: source chips, severity chips, time window, district, hazard type, free-text search and sort " +
        "order. THIS CHANGES THE HUMAN'S SCREEN: the chips toggle, the list re-sorts, the map refits. Use for " +
        "'show me only the road closures', 'just Rasuwa', 'widen to the last month', 'sort by severity'. " +
        "Omitted arguments are left alone, so calls compose. Passing `window` refetches all six sources, which " +
        "takes a moment.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          sources: strs("Show only these sources. Omit to leave unchanged; pass all six to widen.", { enum: SOURCE_IDS }),
          severities: strs(
            "Show only these severities. Note that 'normal' is off by default — 163 gauges reporting nothing " +
              "unusual would otherwise bury everything else.",
            { enum: SEVERITIES }
          ),
          window: int("Days back to load: 1, 2, 7, 30 or 90. Refetches all six sources.", { enum: [1, 2, 7, 30, 90] }),
          district: str("Show only this district; empty string clears it. " + DISTRICT_HINT),
          type: str('Show only this hazard type, e.g. "Flood", "Landslide"; empty string clears it.'),
          search: str("Free text over titles, places and summaries; empty string clears it."),
          sort: str("Row order.", { enum: ["recency", "severity", "time"] }),
        },
      },
      execute: async (args = {}, { signal } = {}) => {
        const changed = await apply(args, signal);
        const rows = visible();
        return {
          summary:
            `Applied ${changed.join(", ") || "no change"}. The view now shows ${rows.length} of ` +
            `${windowed().length} records in the window.`,
          changed,
          total: rows.length,
          top: rows.slice(0, 10).map(brief),
        };
      },
    },
    {
      name: "select_record",
      description:
        "Open one record's drill-down panel on the page and pan the map to it — the same thing that happens " +
        "when the person clicks a row. THIS CHANGES THE HUMAN'S SCREEN. Use it to show someone the record you " +
        "are talking about rather than only describing it: 'open the Timure damage assessment', 'show me that " +
        "on the map'. Pass no id to close the panel.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: { id: str("Record id from list_records. Omit or pass empty to deselect.") },
      },
      execute: async ({ id = null } = {}) => {
        if (id && !state.records.find((x) => x.id === id)) {
          return { summary: `No record with id ${id}. Call list_records for current ids.`, error: true };
        }
        select(id || null);
        return {
          summary: id ? `Opened ${id} on the page; the map has moved to it.` : "Closed the detail panel.",
          selected: state.selected,
        };
      },
    },
    {
      name: "focus_map",
      description:
        "Move and zoom the map — to a district present in the current view, to explicit coordinates, or back " +
        "out to the whole of Nepal. THIS CHANGES THE HUMAN'S SCREEN, and only the map: it filters nothing, so " +
        "the list underneath is untouched. Use for 'zoom into the Bhote Koshi corridor', 'show me the whole " +
        "country again'.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: {
          district: str("Fit the map to every record in this district. " + DISTRICT_HINT),
          lat: int("Latitude, if you have exact coordinates."),
          lon: int("Longitude, if you have exact coordinates."),
          zoom: int("Zoom level 6–14. Default 11 for a point; a district is fitted to its bounds."),
          whole: bool("Zoom back out to all of Nepal."),
        },
      },
      execute: async (args = {}) => focus(args),
    },
    {
      name: "reset_view",
      description:
        "Put the page back to how it opens: all six sources, every severity except 'normal', today and " +
        "yesterday, no district, no type, no search, worst first. THIS CHANGES THE HUMAN'S SCREEN. Use after " +
        "exploring, so the next question starts from the default rather than from your last filter.",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        reset();
        return { summary: `View reset to defaults; ${visible().length} records showing.`, total: visible().length };
      },
    },
    {
      name: "refresh_data",
      description:
        "Re-fetch all six sources now, rather than waiting for the three-minute poll. THIS CHANGES THE HUMAN'S " +
        "SCREEN. Use when the data on screen is older than the question being asked — check get_source_health " +
        "first, since a refresh cannot revive a source that is down, and will honestly report it as still down.",
      annotations: { readOnlyHint: false },
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        await refresh();
        const sources = sourceHealth();
        const bad = sources.filter((x) => x.status !== "live");
        return {
          summary:
            `Refetched. ${visible().length} records showing` +
            (bad.length ? `; ${bad.map((x) => `${x.id} ${x.status}`).join(", ")}.` : "; all six sources live."),
          fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
          sources,
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Where the API actually lives in this browser, if anywhere. */
export function modelContext() {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return null;
}

/** Every tool name this page registers, in registration order. */
export const TOOL_NAMES = [
  "get_situation_summary",
  "list_records",
  "get_record_details",
  "list_filter_options",
  "get_source_health",
  "filter_records",
  "select_record",
  "focus_map",
  "reset_view",
  "refresh_data",
];

/**
 * Register every tool against the live dashboard.
 * @param {{state: object, apply: Function, refresh: Function, select: Function,
 *          focus: Function, reset: Function}} ctl dashboard controls, from dash.js
 */
export async function installWebMCP(ctl) {
  const native = !!modelContext();
  if (!native) installShim();
  const mc = modelContext();

  const controller = new AbortController();
  const registered = [];

  for (const spec of specs(ctl)) {
    try {
      await mc.registerTool(
        {
          name: spec.name,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations,
          async execute(args = {}, opts = {}) {
            try {
              return asText(await spec.execute(args, opts));
            } catch (err) {
              // Fail loudly. An agent must never read a tool failure as "no
              // incidents" when the subject is people dying.
              return (
                `${spec.name} could not complete: ${err.message}. This is a tool failure, not a finding — ` +
                `do not report it as an absence of events.\n\n${FOOTER}`
              );
            }
          },
        },
        { signal: controller.signal }
      );
      registered.push(spec.name);
    } catch (err) {
      console.warn(`[WebMCP] could not register ${spec.name}:`, err);
    }
  }

  // The only trace any of this leaves in the product: one console line. The
  // interface is unchanged, which is the intent — these tools are for agents
  // reading the page, not a feature for the person looking at it.
  console.info(
    `[WebMCP] ${registered.length} tools registered on this page ` +
      `(${native ? "native document.modelContext" : "local shim — this browser has no WebMCP"}).\n` +
      `Try:  await document.modelContext.executeTool('filter_records', '{"sources":["road"]}')`
  );

  return { registered, controller, native };
}

/** Serialise a result for the agent: a sentence first, then the structure. */
function asText(result) {
  if (typeof result === "string") return result;
  const { summary, ...rest } = result ?? {};
  const body = Object.keys(rest).length ? `\n\n${JSON.stringify(rest, null, 2)}` : "";
  return `${summary ?? ""}${body}\n\n${FOOTER}`;
}

// ---------------------------------------------------------------------------
// Shim
//
// WebMCP is an origin trial in Chrome 149+ and a flag before that, so on most
// browsers today `document.modelContext` does not exist. Rather than register
// nothing — which would leave the tools untestable and undemonstrable — we
// install a minimal same-shape implementation of the three methods and the one
// event the imperative API defines. It is deliberately not a polyfill of the
// security model: no cross-origin exposure, no permissions policy, no agent.
// It exists so the tools can be called from DevTools and from Playwright the
// way Chrome would call them.
//
// `shim: true` is set so nothing downstream can mistake it for the real thing.
// ---------------------------------------------------------------------------

export function installShim() {
  const existing = modelContext();
  if (existing) return existing;

  const tools = new Map();
  const target = new EventTarget();
  const changed = () => target.dispatchEvent(new Event("toolchange"));

  const mc = {
    shim: true,

    async registerTool(tool, { signal, exposedTo } = {}) {
      if (!tool?.name || typeof tool.execute !== "function") {
        throw new TypeError("registerTool requires a name and an execute function");
      }
      tools.set(tool.name, { ...tool, origin: location.origin, window, title: document.title, exposedTo });
      signal?.addEventListener("abort", () => { tools.delete(tool.name); changed(); }, { once: true });
      changed();
    },

    async getTools() {
      return [...tools.values()]
        .map(({ execute, ...rest }) => rest)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    // Chrome takes a tool object and a JSON *string*. A bare name and a plain
    // object are accepted too, because the first caller is a human at a console
    // who should not have to quote JSON to try something out.
    async executeTool(tool, input = "{}", { signal } = {}) {
      const name = typeof tool === "string" ? tool : tool?.name;
      const entry = tools.get(name);
      if (!entry) throw new Error(`No such tool: ${name}`);
      const args = typeof input === "string" ? JSON.parse(input || "{}") : (input ?? {});
      return entry.execute(args, { signal });
    },

    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };

  Object.defineProperty(document, "modelContext", { value: mc, configurable: true });
  return mc;
}
