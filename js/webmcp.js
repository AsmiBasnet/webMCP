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
    // `records` counts what is in the window, matching bySource and the status
    // bar; `loaded` is everything fetched. Reporting only the second would let
    // one response say `alert: 1` and `records: 47` for the same source, since
    // the snapshot fallback carries GDACS events back to 2015.
    const inWindow = windowed();
    return SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      origin: s.origin,
      cadence: s.cadence,
      status: failed.has(s.id) ? "unreachable" : state.stale.has(s.id) ? "snapshot" : "live",
      records: inWindow.filter((r) => r.source === s.id).length,
      loaded: state.records.filter((r) => r.source === s.id).length,
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

        let deaths = 0, missing = 0, injured = 0, evacuated = 0, affected = 0, houses = 0, lossNpr = 0;
        for (const r of rows) {
          if (r.source === "incident" && r.loss) {
            deaths += (r.loss.deaths || 0);
            missing += (r.loss.missing || 0);
            injured += (r.loss.injured || 0);
            evacuated += (r.loss.evacuated || 0);
            affected += (r.loss.affected || 0);
            houses += (r.loss.houses || 0);
            lossNpr += (r.loss.estimatedLoss || 0);
          }
        }

        return {
          summary:
            `${rows.length} records in the last ${state.filters.days} day(s): ` +
            (Object.entries(bySeverity).map(([s, n]) => `${n} ${s}`).join(", ") || "none") +
            `. Casualties: ${deaths} deaths, ${missing} missing, ${injured} injured, ${evacuated} families evacuated.`,
          bySeverity,
          bySource,
          humanImpact: {
            deaths,
            missing,
            injured,
            evacuatedFamilies: evacuated,
            affectedFamilies: affected,
            housesDestroyed: houses,
            estimatedLossNpr: lossNpr,
          },
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
          id: str('Record id from list_records, e.g. "incident:12345" or "damage:EMSR927:AOI01".'),
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
      name: "cross_reference_district",
      description:
        "THE ONE THAT MATTERS. Everything all six sources say about one district, side by side: the incident " +
        "record's casualty totals, every river gauge with its headroom, every road closure with the households " +
        "behind it, the international alert, the discharge forecast, and the satellite damage assessment — plus " +
        "an explicit note wherever two sources disagree about how bad it is. Nepal publishes all of this and " +
        "none of it together, so the comparison is the product: a district where Copernicus grades 431 of 441 " +
        "buildings as affected while the incident record holds one injury is not a quiet district, it is a " +
        "district whose reporting chain is underwater. Use for 'what is really happening in X', 'is the " +
        "official record keeping up', 'can relief reach X', 'is this district worse than it looks'.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          district: str("The district to cross-reference. " + DISTRICT_HINT),
          includeNational: bool("Include GDACS alerts, which are scoped to the country rather than a district. Default true."),
        },
        required: ["district"],
      },
      execute: async ({ district, includeNational = true } = {}) => {
        if (!district) return { summary: "Pass a district name. Call list_filter_options for the ones loaded now.", error: true };

        const rows = windowed();
        const here = rows.filter((r) => r.district === district);
        if (!here.length) {
          return {
            summary:
              `No records for ${district} in the current ${state.filters.days}-day window. That is what the ` +
              `sources published, which is not the same as nothing having happened — widen the window with ` +
              `filter_records, and check get_source_health before concluding the district is quiet.`,
            district,
            records: 0,
          };
        }

        const of = (s) => here.filter((r) => r.source === s);
        const sum = (list, key) => list.reduce((a, r) => a + (Number(r.metrics?.[key]) || 0), 0);

        const incidents = of("incident");
        const roads = of("road");
        const damage = of("damage");

        // Buildings graded from orbit, across every mapped area in the district.
        let affected = 0, surveyed = 0, ungraded = 0;
        for (const r of damage) {
          const m = /^([\d,]+) of ([\d,]+)$/.exec(String(r.metrics["Buildings affected"] ?? ""));
          if (m) { affected += Number(m[1].replace(/,/g, "")); surveyed += Number(m[2].replace(/,/g, "")); }
          else ungraded += 1;
        }

        const deaths = sum(incidents, "Deaths");
        const injured = sum(incidents, "Injured");
        const missing = sum(incidents, "Missing");
        const households = sum(roads, "Households cut off");

        // Where two sources tell different stories about the same ground. Stated
        // as a divergence to check, never as a conclusion: this page cannot know
        // which source is right, only that a responder should not read one of
        // them alone.
        const divergence = [];
        if (surveyed && incidents.length <= 2 && affected / surveyed > 0.25) {
          divergence.push(
            `Copernicus EMS graded ${affected.toLocaleString()} of ${surveyed.toLocaleString()} surveyed buildings ` +
            `as affected here, while the incident record holds ${incidents.length} record(s) for the same window ` +
            `(${deaths} dead, ${missing} missing, ${injured} injured). Satellite assessment does not depend on a ` +
            `district officer being able to file, and the filing chain is what breaks when the roads are cut — ` +
            `so treat the low incident count as a reporting lag to verify, not as evidence that the district is fine.`
          );
        }
        if (ungraded) {
          divergence.push(
            `${ungraded} area(s) here have been imaged but not yet graded. Mapped is not undamaged — the ` +
            `statistics follow the satellite pass by a day or more.`
          );
        }
        for (const r of roads) {
          const eta = r.metrics["Estimated reopening"], since = r.metrics["Blocked since"];
          if (eta && since && new Date(eta) < Date.now() && !r.metrics["Actually reopened"]) {
            divergence.push(
              `${r.title} was due to reopen ${new Date(eta).toISOString().slice(0, 10)} and has not been marked ` +
              `reopened. Either it is still shut and the estimate is stale, or it opened and nobody updated the ` +
              `record; ${(Number(r.metrics["Households cut off"]) || 0).toLocaleString()} households are behind it either way.`
            );
          }
        }
        if (roads.length && damage.length) {
          divergence.push(
            `${households.toLocaleString()} households are behind a closure in the same district the satellite is ` +
            `grading. Access and damage are being reported by different agencies; both bear on whether relief arrives.`
          );
        }

        return {
          summary:
            `${district}: ${here.length} records across ${new Set(here.map((r) => r.source)).size} of 6 sources — ` +
            `${incidents.length} incident(s) (${deaths} dead, ${missing} missing, ${injured} injured), ` +
            `${of("river").length} gauge(s), ${roads.length} closure(s)` +
            (households ? ` cutting off ${households.toLocaleString()} households` : "") +
            (surveyed ? `, ${affected.toLocaleString()} of ${surveyed.toLocaleString()} buildings graded affected from orbit` : "") +
            `.` + (divergence.length ? ` ${divergence.length} divergence(s) between sources — see below.` : ""),
          district,
          windowDays: state.filters.days,
          incidents: { count: incidents.length, deaths, missing, injured, housesDestroyed: sum(incidents, "Houses destroyed"), records: incidents.map(brief) },
          gauges: of("river").map(brief),
          roads: roads.map((r) => ({
            ...brief(r),
            householdsCutOff: Number(r.metrics["Households cut off"]) || 0,
            peopleBehind: Number(r.metrics["People behind it"]) || 0,
            blockedSince: r.metrics["Blocked since"] ?? null,
            estimatedReopening: r.metrics["Estimated reopening"] ?? null,
            effortsUnderWay: r.metrics["Efforts under way"] || null,
            contact: r.metrics.Contact || null,
          })),
          forecast: of("forecast").map(brief),
          damage: damage.map((r) => ({
            ...brief(r),
            buildingsAffected: r.metrics["Buildings affected"] ?? "not yet graded",
            sensor: r.metrics.Sensor ?? null,
            imageAcquired: r.metrics["Image acquired"] ?? null,
          })),
          nationalAlerts: includeNational
            ? rows.filter((r) => r.source === "alert").map((r) => ({ ...brief(r), scope: "national — GDACS scopes to the country, not the district" }))
            : [],
          divergence,
          sources: sourceHealth(),
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
        const { changed, rejected } = await apply(args, signal);
        const rows = visible();
        return {
          summary:
            `Applied ${changed.join(", ") || "no change"}. The view now shows ${rows.length} of ` +
            `${windowed().length} records in the window.` +
            (rejected.length
              ? ` ${rejected.length} argument(s) were NOT applied — see rejected below, and do not read the ` +
                `resulting row count as a finding until you have.`
              : ""),
          changed,
          rejected,
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
        const { mapMoved } = select(id || null);
        return {
          summary: !id
            ? "Closed the detail panel."
            : mapMoved
              ? `Opened ${id} on the page; the map has moved to it.`
              : `Opened ${id} on the page. The map did NOT move — this record has no coordinates, which is a ` +
                `gap in what the source published. Do not tell the person you have shown it to them on the map.`,
          selected: state.selected,
          mapMoved,
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
        await reset();
        return {
          summary:
            `View reset to defaults — all six sources, every severity except normal, a ${state.filters.days}-day ` +
            `window, sorted ${state.filters.sort}, nothing selected; ${visible().length} records showing.`,
          total: visible().length,
        };
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
        const before = state.fetchedAt;
        const res = await refresh();
        const sources = sourceHealth();
        const bad = sources.filter((x) => x.status !== "live");
        const moved = state.fetchedAt !== before;
        return {
          summary:
            (res.fetched
              ? moved ? "Refetched. " : "Refetch ran but the timestamp did not move. "
              : `No refetch ran — ${res.reason}. The data on screen is unchanged. `) +
            `${visible().length} records showing` +
            (bad.length ? `; ${bad.map((x) => `${x.id} ${x.status}`).join(", ")}.` : "; all six sources live."),
          fetched: res.fetched,
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
  "cross_reference_district",
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
      tools.set(tool.name, { ...tool, origin: location.origin, title: document.title, exposedTo });
      signal?.addEventListener("abort", () => { tools.delete(tool.name); changed(); }, { once: true });
      changed();
    },

    async getTools() {
      return [...tools.values()]
        .map(({ execute, ...rest }) => {
          // Chrome puts the owning `window` on each descriptor. Keeping it
          // enumerable would make JSON.stringify(await getTools()) throw on a
          // circular structure — which is the first thing anyone tries at a
          // console — so it is present but hidden from serialisation.
          Object.defineProperty(rest, "window", { value: window, enumerable: false, configurable: true });
          return rest;
        })
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
