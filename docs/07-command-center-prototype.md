> **This is the README of the early command-centre prototype**.
> Its code is the five files at the repository root — `index.html`, `app.js`, `agent.js`, `webmcp.js`, `style.css`.
> The active live telemetry platform described in the top-level [`README.md`](../README.md) is under `public/`.

---

# 🌊 Nepal Disaster Watch · नेपाल विपद् वाच
### WebMCP-Enabled Flood Response Command Center for Nepal

> **Submission for the WebMCP Devpost Challenge (2026)**
> *“Nepal Disaster Watch turns a disaster-response website into an agent-operable emergency command center.”*

---

## 📌 Project Overview

**Nepal Disaster Watch** is an interactive crisis command center designed to orchestrate emergency flood response in Nepal (focusing on the Koshi, Bagmati, and Terai regions). The web application provides a real-time view of:
- **Stranded Citizen SOS Alerts**: Live distress signals (location, urgency, children, elderly, water levels).
- **Relief Resource Inventories**: regional rescue depots containing boats, medical squads, and food packs.
- **Interactive Risk Map**: Visualization of flood water levels, road blocks, and live dispatch routes.

### The WebMCP Moment 🤖
Instead of an AI agent just scraping the DOM or visually describing the layout, **Nepal Disaster Watch exposes client-side imperative WebMCP tools** via `document.modelContext.registerTool()`. 

Through WebMCP, an agent can:
1. Fetch live SOS queues.
2. Inspect geographical rescue center locations.
3. Compute the safest route (avoiding critical flood zones).
4. Dispatch boats, teams, and food.
5. Broadcast district-wide emergency SMS warning alerts.
6. Post structured rationale cards directly to the human-operator's dashboard log.

This enables a true **human-agent collaborative workflow** where the agent acts as an automated dispatcher, updating the UI, updating inventory, and drawing physical routes on the screen.

---

## 🛠️ WebMCP Tool Specifications

Nepal Disaster Watch registers custom tools on `document.modelContext`:

### 1. `get_active_sos_alerts`
Exposes the queue of unresolved distress signals.
* **Return Schema**:
  ```json
  [
    {
      "id": "SOS-107",
      "district": "Lalitpur",
      "people": 7,
      "children": 2,
      "elderly": 1,
      "severity": "critical",
      "needs": ["rescue", "medical"],
      "water_level_m": 2.8,
      "status": "pending"
    }
  ]
  ```

### 2. `get_relief_resources`
Returns regional rescue center stock levels.
* **Return Schema**:
  ```json
  {
    "Kathmandu Center": { "boats": 4, "medical_teams": 3, "food_packs": 150 },
    "Biratnagar Center": { "boats": 3, "medical_teams": 2, "food_packs": 120 }
  }
  ```

### 3. `get_safest_route`
Evaluates alternative paths between a center and an SOS location, flagging flood risk and roadblocks.
* **Arguments**: `center_id` (string), `alert_id` (string)
* **Return Schema**:
  ```json
  {
    "routes": [
      {
        "name": "Route B (East Bypass)",
        "distance_km": 16,
        "flood_risk": "high",
        "blocked_road": false,
        "recommended": true
      }
    ]
  }
  ```

### 4. `dispatch_relief`
Executes resource allocations, updates the SOS status, and triggers dynamic map path routing.
* **Arguments**:
  - `alert_id` (string)
  - `center_id` (string)
  - `resources` (object: e.g. `{"boats": 1}`)
  - `priority` (string)
  - `estimated_arrival` (string)
  - `route_name` (string)

### 5. `broadcast_safety_message`
Simulates sending local emergency warnings.
* **Arguments**: `district` (string), `message` (string), `urgency` (string)

### 6. `explain_dispatch_decision`
Appends a structured text block explaining *why* the AI chose this specific resource/route.
* **Arguments**: `alert_id` (string), `reason` (string)

---

## ⚡ Zero-Friction Sandbox Demo

To guarantee that judges can experience the full end-to-end flow without setting up custom WebMCP browser configurations:
1. **Simulation Mode (Default)**: The application spawns simulated SOS requests and environmental changes over time.
2. **Local Sandbox Agent**: An integrated AI Chat Console runs directly in the browser. Judges can select presets (e.g. *"Triage the Koshi basin alerts"* or *"Send medical squads to Lalitpur via safest path"*) or type custom instructions.
3. **Telemetry Console**: A live terminal displays step-by-step tool registrations and logs executing calls like `[WebMCP Log] get_safest_route called...` with visual feedback on the map.

---

## 🚀 Running the App Locally

This project is a static frontend web app with **zero dependencies**.

### Double-Click to Open
Simply clone this repository and open `index.html` in any web browser:
```bash
# Double click index.html or open via terminal:
start index.html
```

### Run via Simple Dev Server
Alternatively, serve the directory to run it over HTTP (e.g., using Python or Node.js):

**Using Python:**
```bash
python -m http.server 8080
```
Then navigate to `http://localhost:8080` in your browser.

**Using Node / npx:**
```bash
npx http-server -p 8080
```

---

## 🗺️ Nepal District & Geographical Focus
To show realistic disaster conditions, the app focuses on districts representing different terrains:
- **Kathmandu Valley (Kathmandu, Lalitpur)**: Urban flash floods and landlocked landslide risks.
- **Sindhupalchok**: Mountainous landslide zones blocking key logistics highways.
- **Saptari / Siraha / Rautahat (Terai)**: Inundated plains with major river flooding.
- **Koshi Basin**: Large-scale Saptakoshi river overflowing.
