// Boot. Wires the tool layer to the page, the map and the WebMCP registration.

import { loadRefdata } from "./refdata.js";
import { TOOLS, get_event_geometry } from "./tools.js";
import { registerWebMCPTools, modelContext, TOOL_SPECS } from "./webmcp.js";
import { renderResult } from "./render.js";
import { route } from "./ask.js";
import * as Map from "./map.js";
import { health, snapshotMode } from "./api.js";
import { LIVE_EVENT, EMERGENCY } from "./config.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $("#ask-form"),
  input: $("#ask-input"),
  submit: $("#ask-submit"),
  results: $("#results"),
  suggestions: $("#suggestions"),
  agentStatus: $("#agent-status"),
  dataStatus: $("#data-status"),
  emergency: $("#emergency"),
};

const SUGGESTIONS = [
  "Which municipalities have flood incidents but no evacuation centre?",
  "How many people have died in floods in Sindhupalchok since 2015, by year?",
  "Which rivers are closest to their warning level right now?",
  "Which roads are closed, and how many households are cut off?",
  "What is the discharge forecast for Rasuwa?",
  "Where is the nearest shelter to Dhunche?",
  "Which districts lose the most bridges to flooding?",
  "How can I help?",
];

// ---------------------------------------------------------------------------

async function boot() {
  renderEmergency();
  renderSuggestions();

  Map.initMap("map");

  try {
    await loadRefdata();
  } catch (err) {
    fail(`Reference data failed to load: ${err.message}`);
    return;
  }

  els.form.addEventListener("submit", onAsk);
  els.results.addEventListener("click", onActionClick);

  await setupAgent();
  await openingView();
}

// ---------------------------------------------------------------------------
// WebMCP
// ---------------------------------------------------------------------------

async function setupAgent() {
  const { registered, supported } = await registerWebMCPTools(onAgentToolCall);

  if (supported && registered.length) {
    els.agentStatus.innerHTML =
      `<span class="pulse" style="background:var(--good)"></span>` +
      `<strong>${registered.length} tools registered</strong> · an agent can query this page directly`;
  } else {
    els.agentStatus.innerHTML =
      `<strong>${TOOL_SPECS.length} tools defined</strong> · no WebMCP agent in this browser — ` +
      `the ask box below runs the same tools locally`;
    els.agentStatus.title =
      "WebMCP lives on document.modelContext. Try Chrome with chrome://flags/#enable-webmcp-testing, " +
      "or open this page inside an agent that supports it.";
  }
}

/** An agent called a tool. Render exactly what it was told. */
function onAgentToolCall(name, args, result) {
  show(name, result, { caller: "agent" });
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

async function onAsk(event) {
  event.preventDefault();
  const question = els.input.value.trim();
  if (!question) return;

  const { tool, args, matched, kind } = route(question);
  await run(tool, args, { question, matched, kind });
}

async function run(tool, args, { question, matched, kind } = {}) {
  const impl = TOOLS[tool];
  if (!impl) return;

  els.submit.disabled = true;
  const pending = pendingCard(question ?? tool, kind, matched);
  els.results.prepend(pending);

  try {
    const result = await impl(args);
    pending.remove();
    show(tool, result, { caller: "you", question, matched });
  } catch (err) {
    pending.remove();
    // A failed fetch is not a finding. Say so, loudly.
    show(tool, {
      summary:
        `Could not reach the data source: ${err.message}. This is a failure to fetch, ` +
        `not a finding — it does not mean nothing happened.`,
      data: [], provenance: [], actions: [], error: true,
    }, { caller: "you", question });
  } finally {
    els.submit.disabled = false;
    updateDataStatus();
  }
}

function show(tool, result, opts) {
  const card = renderResult(tool, result, opts);

  if (opts?.question) {
    const q = document.createElement("p");
    q.className = "result-question";
    q.textContent = `“${opts.question}”`;
    card.insertBefore(q, card.children[1]);
  }

  if (opts?.matched) {
    const m = document.createElement("div");
    m.className = "panel-note";
    m.style.cssText = "padding:0 .9rem .6rem;margin:0";
    m.textContent = `Matched — ${opts.matched}`;
    card.insertBefore(m, card.querySelector(".result-body"));
  }

  els.results.prepend(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pendingCard(question, kind, matched) {
  const card = document.createElement("article");
  card.className = "result";
  card.innerHTML =
    `<div class="result-head"><span class="result-tool">querying</span>` +
    `<span class="result-caller">${escapeHtml(kind ?? "")}</span></div>` +
    `<p class="result-summary"><span class="spinner"></span>${escapeHtml(question)}</p>` +
    (matched ? `<div class="panel-note" style="padding:0 .9rem .9rem;margin:0">Matched — ${escapeHtml(matched)}</div>` : "");
  return card;
}

/** A follow-up action button — the loop closing back on itself. */
function onActionClick(event) {
  const btn = event.target.closest("button.action[data-tool]");
  if (!btn) return;
  const tool = btn.dataset.tool;
  if (!TOOLS[tool]) return;
  let args = {};
  try { args = JSON.parse(btn.dataset.args || "{}"); } catch { /* ignore */ }
  run(tool, args, { question: btn.textContent, kind: "follow-up" });
}

// ---------------------------------------------------------------------------
// Opening view — the live event, without being asked
// ---------------------------------------------------------------------------

async function openingView() {
  Map.focusLiveEvent();

  // Alert footprint first, so it sits under everything drawn afterwards.
  get_event_geometry().then(Map.showAlertGeometry).catch(() => {});

  await run("get_river_status", { onlyElevated: false }, {
    question: "Which rivers are closest to their warning level right now?",
    kind: "opening",
  });
  updateDataStatus();
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function renderEmergency() {
  els.emergency.innerHTML =
    `<span class="emergency-label">Emergency</span>` +
    EMERGENCY.map(
      (e) =>
        `<a class="tel" href="tel:${e.number}">${e.number}<span>${escapeHtml(e.label)}</span></a>`
    ).join("");
}

function renderSuggestions() {
  els.suggestions.innerHTML = SUGGESTIONS.map(
    (s) => `<button type="button" class="suggestion">${escapeHtml(s)}</button>`
  ).join("");

  els.suggestions.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".suggestion");
    if (!btn) return;
    els.input.value = btn.textContent;
    els.form.requestSubmit();
  });
}

function updateDataStatus() {
  const live = [...health.live];
  const failed = [...health.failed.entries()];
  const snap = [...health.snapshot];

  const parts = [];
  if (snapshotMode || snap.length) parts.push(`<strong style="color:var(--warning)">snapshot mode</strong>`);
  if (live.length) parts.push(`live: ${live.map(shortHost).join(", ")}`);
  if (failed.length) {
    parts.push(
      `<strong style="color:var(--critical)">unreachable: ${failed
        .map(([host]) => shortHost(host))
        .join(", ")}</strong>`
    );
  }
  els.dataStatus.innerHTML = parts.join(" · ") || "connecting…";
}

const shortHost = (h) =>
  ({
    "bipadportal.gov.np": "BIPAD",
    "www.gdacs.org": "GDACS",
    "flood-api.open-meteo.com": "Open-Meteo",
    "nominatim.openstreetmap.org": "OSM",
  }[h] ?? h);

function fail(message) {
  els.results.innerHTML = `<article class="result result--error"><p class="result-summary">${escapeHtml(message)}</p></article>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Expose the tool surface for the console and for agents that prefer a plain
// global. The WebMCP registration above is the supported path.
window.SankatSathi = { TOOLS, route, run, modelContext, LIVE_EVENT };

boot();
