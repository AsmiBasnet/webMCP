// A deterministic question router.
//
// This is NOT the product's intelligence — that is the agent, which reads the
// tool descriptions in webmcp.js and composes calls far better than any rule
// set. This exists so the page is fully usable on its own: in a browser with no
// WebMCP agent, on demo night, and for anyone who just wants to type a question.
//
// It is rules-based on purpose. A keyword router that admits what it matched is
// more honest than a language model pretending to understand, and it cannot
// invent a filter that silently changes a casualty figure.

import { ref, findDistrict, findMunicipality, findHazard } from "./refdata.js";
import { daysAgo, isoDate } from "./api.js";

const has = (q, ...words) => words.some((w) => q.includes(w));

/**
 * @param {string} question
 * @returns {{tool: string, args: object, matched: string}}
 */
export function route(question) {
  const q = String(question ?? "").toLowerCase().trim();
  const args = {};
  const matched = [];

  // --- place -------------------------------------------------------------
  const place = findPlace(question);
  if (place) matched.push(`place: ${place.name}`);

  // --- hazard ------------------------------------------------------------
  const hazard = findHazardWord(q);
  if (hazard) matched.push(`hazard: ${hazard.en}`);

  // --- time window -------------------------------------------------------
  const since = findSince(q);
  if (since) matched.push(`since: ${since}`);

  // --- grouping ----------------------------------------------------------
  const groupBy = has(q, "by year", "per year", "each year", "yearly", "over time", "by month", "per month")
    ? (has(q, "month") ? "month" : "year")
    : has(q, "by district", "which district", "which districts", "worst district")
      ? "district"
      : has(q, "by municipality", "which municipalit")
        ? "municipality"
        : has(q, "by hazard", "which hazard", "what kind of disaster")
          ? "hazard"
          : null;
  if (groupBy) matched.push(`grouped by ${groupBy}`);

  const withPlace = (key = "district") => {
    if (!place) return {};
    if (place.kind === "municipality" && key === "district") return { district: place.district ?? place.name };
    return { [key]: place.name };
  };

  // --- intent ------------------------------------------------------------
  // Ordered most specific first: a gap question mentions floods and shelters
  // too, so it has to be caught before either of them.

  // The broad "what is going on" question, which has no single endpoint behind
  // it. Gated on the absence of a domain word, because "which rivers are near
  // warning right now" is a gauge question that happens to contain "right now".
  const NAMES_A_DOMAIN = has(q, "river", "gauge", "water level", "road", "highway", "closure",
    "shelter", "evacuation", "hospital", "helipad", "forecast", "discharge", "donate", "map ", "mapping");
  if (!NAMES_A_DOMAIN &&
      has(q, "what is happening", "whats happening", "what's happening", "going on",
             "current situation", "situation now", "situation right now", "overview", "summary",
             "where is help", "help most needed", "most needed", "worst affected", "worst hit",
             "hardest hit", "most affected", "where should relief", "relief go", "latest", "right now", "today")) {
    return done("get_current_situation",
      { days: since ? Math.max(1, Math.round((Date.now() - new Date(since)) / 86_400_000)) : 7 },
      matched, "national situation");
  }

  if (has(q, "no evacuation", "without", "missing", "gap", "lack", "lacking", "don't have",
             "do not have", "none registered", "unregistered", "no shelter", "no registered",
             "with no ", "no health", "no hospital", "no open space", "no facility", "not covered")) {
    return done("find_coverage_gaps", {
      hazard: hazard?.en ?? "flood",
      resourceType: resourceWord(q) ?? "evacuation centre",
      ...withPlace("district"),
      since: since ?? "2020-01-01",
    }, matched, "gap-finding");
  }

  if (has(q, "cap alert", "compose alert", "cap xml", "standards", "alert format",
             "draft an alert", "draft alert", "write an alert", "alert document")) {
    return done("compose_cap_alert", {}, matched, "CAP draft");
  }

  if (has(q, "road", "highway", "closed", "closure", "roadblock", "get through", "drive", "blocked", "cut off")) {
    return done("get_road_closures", {
      ...withPlace("district"),
      status: has(q, "closed", "blocked") && !has(q, "open") ? "CLOSED" : undefined,
      sortBy: has(q, "delay", "late", "overdue", "estimate") ? "delay" : "households",
    }, matched, "road access");
  }

  if (has(q, "forecast", "tomorrow", "next week", "coming days", "going to", "will it", "predict", "expected", "rise")) {
    return done("get_flood_forecast", { place: place?.name ?? undefined }, matched, "forecast");
  }

  if (has(q, "river", "gauge", "water level", "rising", "danger level", "warning level", "basin", "flooding now")) {
    return done("get_river_status", {
      ...withPlace("district"),
      basin: findBasin(q),
      onlyElevated: has(q, "above warning", "dangerous", "at risk", "which are"),
    }, matched, "river gauges");
  }

  if (has(q, "where do i go", "where can i go", "shelter", "evacuation centre", "evacuation center", "safe place",
          "nearest", "near me", "hospital", "health post", "helipad", "open space", "school")) {
    return done("find_nearby_resources", {
      near: place?.name ?? undefined,
      type: resourceWord(q) ?? undefined,
      radiusKm: 20,
    }, matched, "facilities nearby");
  }

  // "How can I help" belongs here rather than with the mapping task: most
  // people asking it mean money, and the mapping flywheel is offered as a
  // follow-up action on this result anyway.
  const WANTS_MAPPING = has(q, "map", "osm", "openstreetmap", "trace", "volunteer");
  if (!WANTS_MAPPING &&
      has(q, "donate", "donation", "give money", "fund", "charity", "contribute",
             "how can i help", "how do i help", "what can i do", "want to help")) {
    return done("get_verified_donation_channels", {}, matched, "donation channels");
  }

  if (WANTS_MAPPING || has(q, "mapping")) {
    return done("find_mapping_task", { place: place?.name ?? undefined }, matched, "mapping task");
  }

  if (has(q, "gdacs", "global", "international", "alert level", "biggest disaster", "major disaster")) {
    return done("get_global_alert_status", { from: since ?? "2015-01-01" }, matched, "global alerts");
  }

  if (has(q, "how many", "total", "deaths", "died", "killed", "casualt", "injured", "missing",
          "compare", "trend", "most", "worst", "disabled", "women", "men", "average") || groupBy) {
    return done("get_casualty_breakdown", {
      hazard: hazard?.en ?? undefined,
      ...withPlace("district"),
      since: since ?? "2015-04-01",
      groupBy: groupBy ?? "year",
    }, matched, "aggregate totals");
  }

  // Default: show the record itself.
  return done("query_incidents", {
    hazard: hazard?.en ?? undefined,
    ...withPlace("district"),
    since: since ?? daysAgo(30),
    near: place?.kind === "settlement" || place?.kind === "osm" ? place.name : undefined,
    limit: 500,
  }, matched, "incident search");
}

function done(tool, args, matched, kind) {
  for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
  return { tool, args, matched: matched.join(" · "), kind };
}

// ---------------------------------------------------------------------------

/** Longest matching admin name wins, so "Rasuwa" never beats "Rasuwa Gadhi". */
function findPlace(original) {
  const { districts, municipalities } = ref();
  const q = String(original).toLowerCase();
  let best = null;

  const consider = (item, kind) => {
    for (const name of [item.en, item.ne]) {
      if (!name || name.length < 4) continue;
      // Whole words only. A bare substring test matches the district "Dang"
      // inside "danger level", which then silently filters every gauge in the
      // country down to one district — a wrong answer that looks like a right
      // one. Boundaries are checked by hand rather than with  so that
      // Devanagari, which  does not treat as word characters, still matches.
      if (!containsWord(q, name.toLowerCase())) continue;
      if (!best || name.length > best.length) {
        best = { name: item.en, ne: item.ne, kind, length: name.length, district: null };
        if (kind === "municipality") best.district = districts.get(item.district)?.en ?? null;
      }
    }
  };

  for (const d of districts.values()) consider(d, "district");
  for (const m of municipalities.values()) consider(m, "municipality");
  if (best) return best;

  // A capitalised word that is not a stop word — likely a settlement name.
  // The first word is skipped: every sentence starts capitalised, so including
  // it turned "Give me an overview" into a search for a place called "Give".
  // All-caps tokens are skipped too, since they are acronyms (GDACS, BIPAD),
  // not settlements.
  const words = String(original).split(/[\s,?.]+/).filter(Boolean);
  const candidate = words
    .slice(1)
    .find((w) => /^[A-Z][a-z]{3,}$/.test(w) && !STOPWORDS.has(w.toLowerCase()));
  return candidate ? { name: candidate, kind: "settlement", district: null } : null;
}

/**
 * True when `name` appears in `text` as a word rather than inside one.
 *
 * Latin names need a boundary on both sides — without the trailing one, the
 * district "Dang" matches inside "danger level" and silently filters every
 * gauge in the country to one district.
 *
 * Devanagari cannot use the same rule. Nepali postpositions attach directly to
 * the noun — रसुवामा is रसुवा + मा, "in Rasuwa" — so a trailing boundary would
 * reject every naturally written Nepali question. For those, only the leading
 * boundary is required.
 */
function containsWord(text, name) {
  const isLetter = (c) => c !== "" && c !== undefined && /[\p{L}\p{N}]/u.test(c);
  const devanagari = /[ऀ-ॿ]/.test(name);

  let from = 0;
  for (;;) {
    const i = text.indexOf(name, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : text[i - 1];
    const after = text[i + name.length];
    if (!isLetter(before) && (devanagari || !isLetter(after))) return true;
    from = i + 1;
  }
}

const STOPWORDS = new Set([
  "which", "what", "where", "when", "show", "list", "find", "there", "these", "those",
  "have", "many", "since", "nepal", "river", "flood", "road", "district", "municipality",
  "compare", "people", "every", "some", "most", "worst", "help", "donate", "with", "from",
  "that", "this", "been", "were", "does", "here", "near",
  // Verbs and nouns that open a question and would otherwise be read as a
  // settlement the moment they appear anywhere but the first word.
  "give", "using", "draft", "compose", "will", "open", "deaths", "died", "killed",
  "landslide", "landslides", "floods", "flooding", "rivers", "roads", "budget",
  "evacuation", "shelter", "hospital", "health", "facility", "facilities", "centre",
  "center", "centres", "centers", "incidents", "incident", "areas", "area", "level",
  "warning", "danger", "alert", "alerts", "forecast", "water", "highest", "recorded",
  "tell", "explain", "reasoning", "sources", "report", "news", "government",
]);

function findHazardWord(q) {
  for (const word of [
    "flood", "landslide", "earthquake", "fire", "lightning", "thunderbolt", "avalanche",
    "drought", "epidemic", "snake bite", "animal attack", "heavy rain", "storm",
    // Nepali. refdata already aliases these; they were simply never scanned
    // for, so a question written in Devanagari lost its hazard filter. A bare
    // includes() is right here — Nepali postpositions attach to the noun, so
    // बाढीले still has to match बाढी.
    "बाढी", "पहिरो", "भूकम्प", "आगलागी", "चट्याङ", "हिमपहिरो",
  ]) {
    if (q.includes(word)) {
      const h = findHazard(word);
      if (h) return h;
    }
  }
  return null;
}

function findBasin(q) {
  for (const b of ["koshi", "gandaki", "karnali", "bagmati", "mahakali", "rapti", "babai", "west rapti"]) {
    if (q.includes(b)) return b;
  }
  return undefined;
}

function resourceWord(q) {
  const map = [
    [["evacuation", "shelter", "safe place"], "evacuation centre"],
    [["open space", "open ground"], "open space"],
    [["hospital", "health", "clinic", "medical"], "health facility"],
    [["helipad", "helicopter"], "helipad"],
    [["school", "education"], "school"],
    [["bridge"], "bridge"],
    [["water supply", "drinking water"], "water supply"],
    [["community"], "community space"],
  ];
  for (const [words, type] of map) if (words.some((w) => q.includes(w))) return type;
  return null;
}

function findSince(q) {
  const year = q.match(/\b(?:since|from|after)\s+(\d{4})\b/) ?? q.match(/\bin\s+(\d{4})\b/);
  if (year) return `${year[1]}-01-01`;

  if (has(q, "last week", "past week", "this week")) return daysAgo(7);
  if (has(q, "last month", "past month", "this month")) return daysAgo(30);
  if (has(q, "last year", "past year")) return daysAgo(365);
  if (has(q, "today", "right now", "currently", "now")) return daysAgo(2);
  if (has(q, "monsoon", "this season")) return isoDate(`${new Date().getFullYear()}-06-01`);
  if (has(q, "since 2015", "since the earthquake", "all time", "ever", "eleven years", "11 years")) return "2015-04-01";

  const rel = q.match(/\blast\s+(\d+)\s+(day|week|month|year)s?\b/);
  if (rel) {
    const mult = { day: 1, week: 7, month: 30, year: 365 }[rel[2]];
    return daysAgo(Number(rel[1]) * mult);
  }
  return null;
}
