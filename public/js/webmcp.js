// WebMCP registration.
//
// Per the W3C proposal the API lives on `document.modelContext`; earlier Chrome
// builds and the polyfills expose `navigator.modelContext`. Both are accepted.
// Tools are unregistered by aborting the shared signal.
//
// Every tool does two things: it returns structured text to the agent, and it
// renders the same result into the page. The human interface stays primary —
// the person watching sees exactly what the agent was told.

import { TOOLS } from "./tools.js";
import { RESOURCE_TYPES } from "./tools.js";

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const int = (description, extra = {}) => ({ type: "number", description, ...extra });
const bool = (description) => ({ type: "boolean", description });

const PLACE = "A district, municipality or settlement name in Nepal — English or Nepali. e.g. \"Rasuwa\", \"Dhunche\", \"रसुवा\".";
const HAZARD = "Hazard type, e.g. flood, landslide, earthquake, fire, lightning. Nepali names work.";
const SINCE = "ISO date (YYYY-MM-DD). The record starts April 2015.";

export const TOOL_SPECS = [
  {
    name: "query_incidents",
    description:
      "Search Nepal's national disaster incident record — 60,000+ verified records from April 2015 to today, " +
      "each with a casualty and loss breakdown. Use for 'what happened', 'has this happened here before', " +
      "'show me incidents near X'. Returns individual incidents; use get_casualty_breakdown for totals over time.",
    inputSchema: {
      type: "object",
      properties: {
        hazard: str(HAZARD),
        district: str("District name. " + PLACE),
        municipality: str("Municipality name."),
        since: str("Only incidents after this date. " + SINCE),
        until: str("Only incidents before this date (ISO YYYY-MM-DD)."),
        near: str("Centre the search on this place. " + PLACE),
        radiusKm: int("Radius in km when `near` is given. Default 25."),
        search: str("Free-text search over incident titles."),
        verifiedOnly: bool("Only incidents BIPAD has marked verified and approved."),
        limit: int("Maximum incidents to return. Default 500."),
      },
    },
  },
  {
    name: "get_casualty_breakdown",
    description:
      "Aggregate deaths, injuries, missing people and destroyed infrastructure across the incident record, " +
      "grouped by year, month, district, municipality or hazard — including the breakdown by sex and by " +
      "disability that BIPAD records but never displays. BIPAD has no aggregation endpoint, so this is the " +
      "only way to get totals. Use for 'how many died in X since Y', 'which districts lose the most bridges', " +
      "'are disabled people over-represented in flood casualties'.",
    inputSchema: {
      type: "object",
      properties: {
        hazard: str(HAZARD),
        district: str("Restrict to one district. " + PLACE),
        since: str("Start of the window. " + SINCE + " Defaults to 2015-04-01."),
        until: str("End of the window (ISO YYYY-MM-DD)."),
        groupBy: str("How to bucket the totals.", { enum: ["year", "month", "district", "municipality", "hazard"] }),
        limit: int("Maximum incidents to scan. Default 4000."),
      },
    },
  },
  {
    name: "get_river_status",
    description:
      "Live river gauge readings from the Department of Hydrology and Meteorology, each compared against that " +
      "station's own published warning and danger level, with its trend (rising, steady, falling). Use for " +
      "'is the river rising', 'which gauges are above warning level', 'is it safe near X'. Comparison is in " +
      "metres of headroom, not a ratio — many stations report metres above sea level.",
    inputSchema: {
      type: "object",
      properties: {
        basin: str("River basin name, e.g. Koshi, Gandaki, Karnali, Bagmati."),
        district: str("Restrict to one district."),
        near: str("Only gauges near this place. " + PLACE),
        radiusKm: int("Radius in km when `near` is given. Default 50."),
        onlyElevated: bool("Only return gauges at or approaching their warning level."),
      },
    },
  },
  {
    name: "get_flood_forecast",
    description:
      "GloFAS modelled river discharge forecast for the next two weeks at a point — the one thing the national " +
      "record cannot tell you, because it only holds observations. Use for 'what happens tomorrow', " +
      "'is it going to get worse'. This is a model, not an observation, and not an official warning.",
    inputSchema: {
      type: "object",
      properties: {
        place: str("Place to forecast for. " + PLACE),
        lat: int("Latitude, if you have exact coordinates."),
        lon: int("Longitude, if you have exact coordinates."),
        days: int("Forecast days ahead, up to 14. Default 14."),
      },
    },
  },
  {
    name: "get_road_closures",
    description:
      "Live Department of Roads roadblock feed: status (open, partially open, closed), the reason, what is being " +
      "done, how many households are cut off, the named engineer responsible, and estimated versus actual " +
      "clearance time. Use for 'can I get through', 'which roads are closed', 'who do I call about this road'.",
    inputSchema: {
      type: "object",
      properties: {
        district: str("Restrict to one district."),
        status: str("Filter by status.", { enum: ["OPEN", "PARTIAL_OPEN", "CLOSED"] }),
        near: str("Only roadblocks near this place. " + PLACE),
        radiusKm: int("Radius in km when `near` is given. Default 50."),
        sortBy: str("Ordering.", { enum: ["households", "delay", "recent"] }),
      },
    },
  },
  {
    name: "find_nearby_resources",
    description:
      "Registered facilities near a place — evacuation centres, open spaces, health posts, helipads, schools. " +
      "Use for 'where do I go', 'where is the nearest shelter'. An empty result is meaningful: it means nothing " +
      "of that kind is registered there, which is itself worth reporting.",
    inputSchema: {
      type: "object",
      properties: {
        near: str("Place to search around. " + PLACE),
        lat: int("Latitude, if you have exact coordinates."),
        lon: int("Longitude, if you have exact coordinates."),
        type: str("Facility type.", { enum: RESOURCE_TYPES.map((t) => t.label) }),
        radiusKm: int("Search radius in km. Default 15."),
        limit: int("Maximum facilities to return. Default 20."),
      },
    },
  },
  {
    name: "find_coverage_gaps",
    description:
      "Find municipalities that have recorded incidents of a hazard but have NO registered facility of a given " +
      "type — for example flood-hit municipalities with no evacuation centre. This is a question about what is " +
      "MISSING from the national record, which no dashboard can ask, and it requires joining two endpoints " +
      "client-side. Use for 'where are the gaps', 'which flood-affected places have no shelter'.",
    inputSchema: {
      type: "object",
      properties: {
        hazard: str(HAZARD + " Defaults to flood."),
        resourceType: str("The facility that should be there but may not be.", { enum: RESOURCE_TYPES.map((t) => t.label) }),
        district: str("Restrict the search to one district."),
        since: str("Only count incidents after this date. " + SINCE + " Defaults to 2020-01-01."),
        minIncidents: int("Only report municipalities with at least this many incidents. Default 1."),
      },
    },
  },
  {
    name: "get_global_alert_status",
    description:
      "GDACS global disaster alerts for Nepal — alert level (Green, Orange, Red), GLIDE identifier, dates and " +
      "the link to the official CAP alert. Use to place a local event in international context, or for " +
      "'what major disasters has Nepal had'. Indicative only; not a national warning.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("Start date (ISO YYYY-MM-DD). Defaults to 2015-01-01."),
        to: str("End date (ISO YYYY-MM-DD). Defaults to today."),
        types: str("Comma-separated GDACS event types, e.g. \"FL,EQ\". FL flood, EQ earthquake, TC cyclone, DR drought."),
      },
    },
  },
  {
    name: "find_mapping_task",
    description:
      "Find an open Humanitarian OpenStreetMap Team mapping task for the flood-affected area, from the campaign " +
      "HOT, NAXA and NDRRMA opened on 27 August 2026. Anyone anywhere can trace buildings and roads from " +
      "imagery in about fifteen minutes, and that improves the same OpenStreetMap data this app queries. " +
      "Use when a query has revealed thin map coverage, or when someone asks how to help.",
    inputSchema: {
      type: "object",
      properties: {
        place: str("The area the person wants to help with. " + PLACE),
        district: str("District name, if known."),
      },
    },
  },
  {
    name: "get_verified_donation_channels",
    description:
      "Verified channels for donating to the Nepal flood response, each URL checked live, together with the " +
      "signs of a fundraising scam — fraud was reported within 72 hours of this flood. Use when someone asks " +
      "how to help with money.",
    inputSchema: {
      type: "object",
      properties: {
        scope: str("Narrow the list.", { enum: ["international", "nepal", "government"] }),
      },
    },
  },
  {
    name: "compose_cap_alert",
    description:
      "Draft a standards-compliant OASIS CAP v1.2 alert document from a live gauge reading, so it can be shared " +
      "or checked against the official one. The draft is marked status Exercise and is NOT broadcast to anyone — " +
      "this app has no authority to issue warnings and does not send them.",
    inputSchema: {
      type: "object",
      properties: {
        station: str("Gauge or station name. Defaults to the most elevated gauge currently reporting."),
        urgency: str("CAP urgency.", { enum: ["Immediate", "Expected", "Future", "Past", "Unknown"] }),
        severity: str("CAP severity.", { enum: ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] }),
        certainty: str("CAP certainty.", { enum: ["Observed", "Likely", "Possible", "Unlikely", "Unknown"] }),
      },
    },
  },
];

/** Where the API actually lives in this browser, if anywhere. */
export function modelContext() {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return null;
}

/**
 * Register every tool.
 * @param {(name: string, args: object, result: object) => void} onResult
 *        Called after each tool runs, so the page can render what the agent saw.
 * @returns {{registered: string[], controller: AbortController|null, supported: boolean}}
 */
export async function registerWebMCPTools(onResult = () => {}) {
  const mc = modelContext();
  if (!mc?.registerTool) return { registered: [], controller: null, supported: false };

  const controller = new AbortController();
  const registered = [];

  for (const spec of TOOL_SPECS) {
    const impl = TOOLS[spec.name];
    if (!impl) continue;

    try {
      await mc.registerTool(
        {
          name: spec.name,
          description: spec.description,
          inputSchema: spec.inputSchema,
          async execute(args = {}) {
            try {
              const result = await impl(args);
              onResult(spec.name, args, result);
              return { content: [{ type: "text", text: asText(spec.name, result) }] };
            } catch (err) {
              // Fail visibly. An agent must never read a fetch failure as "zero deaths".
              const text =
                `${spec.name} could not complete: ${err.message}. ` +
                `This is a data-source failure, not a finding — do not report it as an absence of incidents.`;
              onResult(spec.name, args, { summary: text, data: [], provenance: [], actions: [], error: true });
              return { content: [{ type: "text", text }], isError: true };
            }
          },
        },
        { signal: controller.signal }
      );
      registered.push(spec.name);
    } catch (err) {
      console.warn(`WebMCP: could not register ${spec.name}`, err);
    }
  }

  return { registered, controller, supported: true };
}

/**
 * Serialise a tool result for the agent. Provenance is included on purpose:
 * the numbers are casualty figures, and an agent repeating them should be able
 * to say where they came from and how fresh they are.
 */
function asText(name, result) {
  const lines = [result.summary];

  if (result.totals) lines.push(`\nTotals: ${JSON.stringify(result.totals)}`);
  if (result.caveat) lines.push(`\nCaveat: ${result.caveat}`);

  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  if (rows.length) {
    const shown = rows.slice(0, 60);
    lines.push(`\nData (${shown.length} of ${rows.length} rows):`);
    lines.push(JSON.stringify(shown));
    if (rows.length > shown.length) {
      lines.push(`(${rows.length - shown.length} further rows omitted; narrow the query to see them.)`);
    }
  }

  if (result.provenance?.length) {
    lines.push(
      "\nProvenance: " +
        result.provenance
          .map((p) => `${p.source} — ${p.endpoint}, retrieved ${p.retrievedAt}${p.note ? ` (${p.note})` : ""}`)
          .join("; ")
    );
  }

  if (result.actions?.length) {
    lines.push(
      "\nWhat the person can do next: " +
        result.actions.map((a) => (a.href ? `${a.verb} → ${a.href}` : a.verb)).join(" · ")
    );
  }

  lines.push(
    "\nThis is an unofficial view of public data. It issues no warnings and dispatches nothing. " +
      "For emergencies in Nepal: 100 Police, 102 Ambulance, 1149 National Emergency Operation Centre."
  );

  return lines.join("\n");
}
