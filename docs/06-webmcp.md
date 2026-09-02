# 06 · WebMCP — the page as a tool surface

What WebMCP is, how it works, and exactly how SankatSathi uses it.

Sources, read 30 August 2026:
[Overview](https://developer.chrome.com/docs/ai/webmcp) ·
[Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) ·
[Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api) ·
[Explainer on GitHub](https://github.com/webmachinelearning/webmcp)

---

## The problem it solves

An agent operating a website today does **actuation**: it reads the DOM, guesses which
element is the search box, types into it, guesses which element is the submit button,
clicks it, re-reads the DOM to find out what happened. Every step is a fresh guess, and a
long task is a chain of guesses where any one link can break. Nothing about a `<div>` tells
an agent that clicking it filters a list rather than deleting an account.

WebMCP inverts that. The page *declares* what it can do — a named tool, a description, a
JSON Schema for its inputs — and the agent calls it. The browser mediates. Chrome's framing:

> Instead of an agent reviewing the element, such as a button or a field, to understand its
> purpose, the website declares the element's purpose, so it's used correctly.

Three things it standardises:

| | |
|---|---|
| **Discovery** | one way for a page to register tools with whatever agent is present |
| **JSON Schemas** | inputs and outputs stated explicitly, so an agent cannot invent an argument |
| **State** | a shared view of what the page currently holds, in real time |

It is a *progressive enhancement*. A browser without WebMCP renders exactly the same page, and
the page advertises no tools; nothing about the interface depends on an agent being there.

What an agent does is not hidden from the human, though. Each call is narrated in the readout
beside the map — see `public/js/agentview.js` — because an agent that concludes "Rasuwa is cut
off" is half an answer if the responder next to it cannot see what that was read from.

## Status, as of August 2026

- **Origin trial** from Chrome 149.
- **Local development**: `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch.
- A proposed standard under discussion at the W3C Web Machine Learning group. It will change.
- Chrome ships a **Model Context Tool Inspector** extension: lists a page's registered tools,
  calls them by hand, validates the schemas, and talks to the page in natural language
  through `gemini-3-flash-preview`. It is the fastest way to see this page's tools work.

## The two APIs

**Declarative** — annotate an existing HTML form and it becomes a tool. Best when the thing
the agent should do is already a form submission.

**Imperative** — `document.modelContext`, plain JavaScript, arbitrary behaviour. This is what
SankatSathi uses, because nothing here is a form: the tools drive a filter state and a map.

### The imperative surface, in full

```js
// Register
await document.modelContext.registerTool({
  name: 'toggle_layer',
  description: 'Control pizza layers (sauce, cheese). Use "add", "remove", or "toggle".',
  inputSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string', enum: ['sauce-layer', 'cheese-layer'] },
      action: { type: 'string', enum: ['add', 'remove', 'toggle'] },
    },
    required: ['layer'],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  execute: async ({ layer, action }, { signal }) => {
    await toggleLayer(layer, action);
    return `Performed ${action || 'toggle'} on layer: ${layer}`;
  },
}, { signal: controller.signal, exposedTo: ['https://example.com'] });

// Discover — alphabetical, same-origin by default
const tools = await document.modelContext.getTools({ fromOrigins: ['https://partner.org'] });

// Call — a tool object (or, in Chrome, from the agent side) and a JSON *string*
const result = await document.modelContext.executeTool(tool, '{"layer":"cheese-layer"}');

// Watch
document.modelContext.addEventListener('toolchange', () => { /* the tool list moved */ });
```

Points worth knowing:

- `execute` receives `(args, { signal })`. The `AbortSignal` is the agent or user cancelling —
  pass it into `fetch()` so a cancelled tool stops doing work.
- Unregister by aborting the `AbortController` you registered with. Since Chrome 153 that no
  longer kills in-flight executions.
- `annotations.readOnlyHint` says the tool does not change anything. `untrustedContentHint`
  says the tool returns content the page did not author — user text, third-party data.
- Earlier builds and the polyfills expose `navigator.modelContext`. Accept both.

### Security model

- **Origin isolation required.** A document with `document.domain` enabled (via
  `Origin-Agent-Cluster: ?0`) gets no WebMCP at all.
- **Permissions Policy `tools`**, defaulting to `self`: top-level and same-origin frames may
  register; cross-origin iframes may not, unless the embedder writes `<iframe allow="tools">`.
- **`exposedTo`** on `registerTool` lists which origins may see and call a tool; the caller
  must *also* ask for that origin via `fromOrigins`. Both sides opt in. Secure origins only.

### Limitations Chrome names

- Designed for a **human in the loop** in a local browser, not headless fleets.
- A complex app may need real refactoring before its state is expressible as tools.
- **Discoverability**: an agent has to visit the site to learn it has tools. There is no registry.

---

## How SankatSathi uses it

`public/js/webmcp.js`, registered from `dash.js` after the first load.

**Eleven tools. Six read, five write.**

| Tool | | What it does |
|---|---|---|
| `get_situation_summary` | read | The whole picture: counts by severity and source, worst districts ranked by severity not volume, per-source freshness |
| `list_records` | read | The rows on screen, worst first, with the ids the other tools need |
| `get_record_details` | read | Every field one source published for one record, its provenance, optionally the raw payload |
| `list_filter_options` | read | The district and hazard names `filter_records` will actually accept right now |
| `cross_reference_district` | read | Everything all six sources say about one district, side by side, with the divergences between them named |
| `get_source_health` | read | Which of the six sources are live, on snapshot, or unreachable — and how old the data is |
| `filter_records` | **write** | Sources, severities, window, district, type, search, sort — the whole filter bar, composable |
| `select_record` | **write** | Opens a record's drill-down panel and pans the map to it |
| `focus_map` | **write** | Moves the map only: a district, coordinates, or back out to all of Nepal |
| `reset_view` | **write** | Back to how the page opens |
| `refresh_data` | **write** | Refetch all six sources now |

### The one that earns the exercise

`cross_reference_district` is why the tool surface is worth building rather than leaving an agent
to scrape the list. The other ten answer questions about the page; this one answers the question
the page was built for.

Nepal publishes six disaster feeds and none of them together. Each is internally consistent and
none of them knows what the others are saying about the same valley on the same day. Asked about
Rasuwa during the August 2026 GLOF flood, the tool returns in one answer: Copernicus EMS grading
**864 of 1,000 surveyed buildings** affected across Syapru Besi and Timure; the BIPAD incident
record holding **one** record for the same window, an injury at Gosaikunda; NH42 to Rasuwagadhi
closed since 26 August with **7,025 households / 27,094 people** behind it, cause filed as *"Huge
flood from Tibet Region has swept away entire river route road"*; one gauge; one forecast; and the
GDACS Orange alert, flagged **national scope** rather than silently treated as a district record.

Then it names the divergences:

> Copernicus EMS graded 864 of 1,000 surveyed buildings as affected here, while the incident record
> holds 1 record for the same window (0 dead, 0 missing, 1 injured). Satellite assessment does not
> depend on a district officer being able to file, and the filing chain is what breaks when the
> roads are cut — so treat the low incident count as a reporting lag to verify, not as evidence
> that the district is fine.

It computes four kinds of divergence: satellite damage against a near-silent incident record; an
area imaged but not yet graded (*mapped is not undamaged*); a closure whose estimated reopening has
passed with no reopening recorded — which surfaced Mechi Rajmarg, logged with a five-hour repair
estimate and still not marked reopened 53 days later, with 99,910 households behind it; and damage
being graded in a district that also has households behind a closure, since access and damage are
reported by different agencies and both bear on whether relief arrives.

Every one of those is stated as **a divergence to check, never as a conclusion**. The page cannot
know which source is right. It can know that a responder reading one of them alone is missing
something, and say so.

### The rules they were written to

**One code path to the screen.** A tool mutates `state.filters` and re-renders — the same
thing a click does. There is no agent-only data path and no agent-only rendering. When an
agent filters to road closures, the Roads chip lights up, the list re-sorts, the counts
change and the map refits, because that is simply what the app does when those filters
change. The person watching sees the work happen. Chrome's word for this is that tools
*execute on your webpage visibly*.

That is why `dash.js` gained `syncControls()`. The chips and dropdowns are re-rendered from
state on every pass, but the window, sort and search inputs hold their own value — a person
changing them is already in sync, an agent changing state is not, and a filter bar that
disagrees with the list beneath it is worse than no filter bar at all.

**The tools cannot reach past the interface.** `dash.js` hands `webmcp.js` a small control
object — `apply`, `refresh`, `select`, `focus`, `reset`, plus read access to `state`. An
agent can do what a person with a mouse could do, and nothing else. No tool writes anywhere,
sends anything, or calls an endpoint the page would not have called.

**Every result says where it came from and how old it is.** These are casualty figures. Each
tool result ends with the same footer the page carries — no warnings issued, nothing
dispatched, the three emergency numbers — and `get_source_health` exists precisely so an
agent can distinguish *nothing happened* from *the feed is down*. A tool that throws returns
a sentence saying so and telling the agent not to report it as an absence of events. An
agent that reads a fetch failure as "zero deaths" is the specific harm this file is written
against.

**Read tools declare `readOnlyHint: true`**, so a cautious agent can explore before it moves
anything on a stranger's screen.

### Registration

```js
// dash.js, after the first successful load, so a tool called immediately
// answers over real records rather than an empty list.
installWebMCP(controls).then((r) => { window.SankatSathi.webmcp = r; });
```

Nothing appears in the interface. The only trace is one `console.info` line naming the tool
count and whether the API is native — which is the point: this is for agents reading the
page, not a feature for the person looking at it.

### The shim

Most browsers today have no `document.modelContext`. Registering nothing would leave the
tools untestable and undemonstrable, so `installShim()` installs a minimal same-shape
implementation of `registerTool`, `getTools`, `executeTool` and the `toolchange` event.

It is **not** a polyfill of the security model — no cross-origin exposure, no permissions
policy, no agent — and it sets `shim: true` so nothing can mistake it for the real thing.
The console line says which one you are running. In a Chrome with the flag on, the shim never
installs and the same calls go to the browser.

One deliberate difference: the shim's `executeTool` accepts a bare tool name and a plain
object as well as a tool object and a JSON string, because the first caller is a human at a
console who should not have to quote JSON to try something.

---

## Trying it

```bash
npm run serve            # http://127.0.0.1:8787
npm run test:webmcp      # 55 assertions: tools registered, the page moves, and nothing overstates what it did
```

In the browser console on the live page:

```js
await document.modelContext.getTools();                       // eleven tools
await document.modelContext.executeTool('get_situation_summary', '{}');
await document.modelContext.executeTool('filter_records', '{"window":7}');
await document.modelContext.executeTool('cross_reference_district', '{"district":"Rasuwa"}');
await document.modelContext.executeTool('filter_records', '{"sources":["road"],"sort":"severity"}');
```

Watch the filter bar while that last one runs.

For the real API: enable `chrome://flags/#enable-webmcp-testing`, relaunch, then install the
**Model Context Tool Inspector** extension and ask it, in English, the prompts in
[`../PROMPTS.md`](../PROMPTS.md).

`scripts/webmcp-test.mjs` drives the page through `executeTool` exactly as an agent would —
it never touches app internals to make a change, only to check one — and asserts that the
DOM actually moved: the right chips lit, the rows all match the filter, the detail panel
carries the selected record's title, the window control follows a refetch, and the read-only
tools changed nothing at all.
