/* ==========================================================================
   SankatSathi - Core Dashboard Application State & Logic
   ========================================================================== */

// --- Global Command Center State ---
const State = {
    districts: {
        "Kathmandu": { water_level: 0.8, risk: "normal" },
        "Lalitpur": { water_level: 0.9, risk: "normal" },
        "Sindhupalchok": { water_level: 0.5, risk: "normal" },
        "Rautahat": { water_level: 1.8, risk: "warning" },
        "Siraha": { water_level: 1.4, risk: "warning" },
        "Saptari": { water_level: 2.5, risk: "critical" }
    },
    depots: {
        "Kathmandu Center": { boats: 4, medical_teams: 3, food_packs: 150, x: 305, y: 160 },
        "Janakpur Center": { boats: 1, medical_teams: 4, food_packs: 200, x: 430, y: 310 },
        "Biratnagar Center": { boats: 3, medical_teams: 2, food_packs: 120, x: 640, y: 310 }
    },
    sos_alerts: [
        {
            id: "SOS-101",
            district: "Saptari",
            people: 12,
            children: 4,
            elderly: 2,
            severity: "critical",
            needs: ["rescue", "food"],
            water_level_m: 2.5,
            status: "pending"
        },
        {
            id: "SOS-102",
            district: "Lalitpur",
            people: 5,
            children: 2,
            elderly: 0,
            severity: "medium",
            needs: ["medical"],
            water_level_m: 1.2,
            status: "pending"
        },
        {
            id: "SOS-103",
            district: "Rautahat",
            people: 18,
            children: 6,
            elderly: 3,
            severity: "critical",
            needs: ["rescue", "medical", "food"],
            water_level_m: 2.1,
            status: "pending"
        }
    ],
    broadcasts: [],
    rationales: [],
    
    // Geographical Node Coordinates on SVG map
    nodes: {
        "Kathmandu": { x: 330, y: 180 },
        "Lalitpur": { x: 320, y: 240 },
        "Sindhupalchok": { x: 420, y: 140 },
        "Rautahat": { x: 350, y: 340 },
        "Siraha": { x: 480, y: 360 },
        "Saptari": { x: 580, y: 350 }
    }
};

// --- Mock Routing Data ---
const RoutingDB = {
    // Kathmandu Depot routes
    "Kathmandu Center": {
        "Kathmandu": [
            { name: "KTM Highway Link", distance_km: 4, flood_risk: "normal", blocked_road: false, recommended: true }
        ],
        "Lalitpur": [
            { name: "Bagmati Corridor Bypass", distance_km: 8, flood_risk: "normal", blocked_road: false, recommended: true },
            { name: "KTM Ring Road Main", distance_km: 10, flood_risk: "warning", blocked_road: true, recommended: false }
        ],
        "Sindhupalchok": [
            { name: "Araniko Highway Main", distance_km: 45, flood_risk: "warning", blocked_road: false, recommended: true },
            { name: "Helambu Mountain Bypass", distance_km: 55, flood_risk: "normal", blocked_road: false, recommended: false }
        ]
    },
    // Janakpur Depot routes
    "Janakpur Center": {
        "Rautahat": [
            { name: "East-West Highway Route A", distance_km: 68, flood_risk: "critical", blocked_road: true, recommended: false },
            { name: "North Bagmati Bypass Route B", distance_km: 85, flood_risk: "warning", blocked_road: false, recommended: true }
        ],
        "Siraha": [
            { name: "Janakpur-Siraha Link Road", distance_km: 30, flood_risk: "normal", blocked_road: false, recommended: true }
        ],
        "Saptari": [
            { name: "Koshi Barrage Access Road", distance_km: 62, flood_risk: "critical", blocked_road: false, recommended: true }
        ]
    },
    // Biratnagar Depot routes
    "Biratnagar Center": {
        "Saptari": [
            { name: "Route A (Koshi Barrage Main)", distance_km: 38, flood_risk: "critical", blocked_road: true, recommended: false },
            { name: "Route B (East Bypass Canal)", distance_km: 54, flood_risk: "warning", blocked_road: false, recommended: true }
        ],
        "Siraha": [
            { name: "H01 East-West Bypass", distance_km: 74, flood_risk: "warning", blocked_road: false, recommended: true }
        ]
    }
};

// --- App Initializer & Renderer Bindings ---
document.addEventListener("DOMContentLoaded", () => {
    initUI();
    renderAll();
    setupSimulation();
});

function initUI() {
    // Settings toggles
    const settingsBtn = document.getElementById("btn-settings");
    const settingsDrawer = document.getElementById("settings-drawer");
    const closeSettings = document.getElementById("btn-close-settings");
    const saveKeyBtn = document.getElementById("btn-save-key");
    const clearKeyBtn = document.getElementById("btn-clear-key");
    const geminiKeyInput = document.getElementById("gemini-key");
    const toggleKeyBtn = document.getElementById("btn-toggle-key");

    // Load key if exists
    if (localStorage.getItem("gemini_api_key")) {
        geminiKeyInput.value = localStorage.getItem("gemini_api_key");
        updateAgentModeBadge(true);
    }

    settingsBtn.addEventListener("click", () => settingsDrawer.classList.toggle("collapsed"));
    closeSettings.addEventListener("click", () => settingsDrawer.classList.add("collapsed"));
    
    toggleKeyBtn.addEventListener("click", () => {
        const type = geminiKeyInput.type === "password" ? "text" : "password";
        geminiKeyInput.type = type;
        toggleKeyBtn.querySelector("i").classList.toggle("fa-eye");
        toggleKeyBtn.querySelector("i").classList.toggle("fa-eye-slash");
    });

    saveKeyBtn.addEventListener("click", () => {
        const key = geminiKeyInput.value.trim();
        if (key) {
            localStorage.setItem("gemini_api_key", key);
            logTelemetry("system", "Gemini API key saved to localStorage. Local sandbox switched to Live Gemini Agent.");
            updateAgentModeBadge(true);
            settingsDrawer.classList.add("collapsed");
        } else {
            alert("Please enter a valid key or clear existing configurations.");
        }
    });

    clearKeyBtn.addEventListener("click", () => {
        localStorage.removeItem("gemini_api_key");
        geminiKeyInput.value = "";
        logTelemetry("system", "API Key cleared. Switched back to Rule-Based Local Simulation Mode.");
        updateAgentModeBadge(false);
        settingsDrawer.classList.add("collapsed");
    });

    // Trigger SOS button
    document.getElementById("btn-trigger-sos").addEventListener("click", triggerMockSOS);
    
    // Clear telemetry
    document.getElementById("btn-clear-telemetry").addEventListener("click", () => {
        const telLog = document.getElementById("telemetry-log");
        telLog.innerHTML = `<div class="tel-row system-msg">[System] Telemetry cleared by operator.</div>`;
    });
}

function updateAgentModeBadge(isLive) {
    const badge = document.getElementById("ai-mode-status");
    if (badge) {
        if (isLive) {
            badge.innerText = "GEMINI LIVE AGENT";
            badge.style.color = "#8b5cf6";
            badge.style.borderColor = "rgba(139, 92, 246, 0.3)";
            badge.style.backgroundColor = "rgba(139, 92, 246, 0.1)";
        } else {
            badge.innerText = "SIMULATOR ACTIVE";
            badge.style.color = "#f59e0b";
            badge.style.borderColor = "rgba(245, 158, 11, 0.2)";
            badge.style.backgroundColor = "rgba(245, 158, 11, 0.15)";
        }
    }
}

// --- Render Functions ---
function renderAll() {
    renderSOSQueue();
    renderDepots();
    renderBroadcasts();
    renderMapState();
    renderRationales();
}

// Render Left Panel SOS Feed
function renderSOSQueue() {
    const sosList = document.getElementById("sos-queue-list");
    const sosCount = document.getElementById("sos-count");
    
    const pendingCount = State.sos_alerts.filter(a => a.status === "pending").length;
    sosCount.innerText = `${pendingCount} pending`;

    if (State.sos_alerts.length === 0) {
        sosList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-check text-green"></i>
                <p>No active distress signals. Rivers stable.</p>
            </div>`;
        return;
    }

    sosList.innerHTML = State.sos_alerts.map(alert => {
        const severityClass = alert.severity === "critical" ? "critical" : "medium";
        const statusClass = alert.status.replace(" ", "").toLowerCase();
        
        let statusBadge = `<span class="sos-status-text pending"><i class="fa-solid fa-circle-exclamation"></i> Pending Dispatch</span>`;
        if (alert.status === "en route") {
            statusBadge = `<span class="sos-status-text enroute"><i class="fa-solid fa-truck-moving animate-pulse"></i> Dispatch En Route</span>`;
        } else if (alert.status === "resolved") {
            statusBadge = `<span class="sos-status-text resolved"><i class="fa-solid fa-circle-check"></i> Resolved</span>`;
        }

        const needsTags = alert.needs.map(n => `<span class="sos-tag ${n}">${n.toUpperCase()}</span>`).join(" ");

        return `
            <div class="sos-card ${severityClass} ${statusClass}" id="card-${alert.id}">
                <div class="sos-card-header">
                    <span class="sos-id">${alert.id}</span>
                    <span class="sos-severity-badge ${severityClass}">${alert.severity}</span>
                </div>
                <div class="sos-location">
                    <i class="fa-solid fa-location-dot text-red"></i> ${alert.district} District
                </div>
                <div class="sos-details">
                    <div><i class="fa-solid fa-users"></i> Size: <strong>${alert.people}</strong></div>
                    <div><i class="fa-solid fa-water"></i> Depth: <strong>${alert.water_level_m}m</strong></div>
                    <div><i class="fa-solid fa-child"></i> Children: <strong>${alert.children}</strong></div>
                    <div><i class="fa-solid fa-person-cane"></i> Elderly: <strong>${alert.elderly}</strong></div>
                </div>
                <div class="sos-needs">
                    ${needsTags}
                </div>
                <div class="sos-status-row">
                    ${statusBadge}
                </div>
            </div>
        `;
    }).join("");
}

// Render Depot inventories
function renderDepots() {
    const depotsContainer = document.getElementById("depots-inventory");
    depotsContainer.innerHTML = Object.entries(State.depots).map(([name, inv]) => {
        return `
            <div class="depot-card" id="depot-${name.replace(" ", "")}">
                <div class="depot-name">${name}</div>
                <div class="depot-grid">
                    <div class="depot-item">
                        <i class="fa-solid fa-ship text-blue"></i>
                        <span class="val" id="depot-${name.replace(" ", "")}-boats">${inv.boats}</span>
                        <span class="lbl">Boats</span>
                    </div>
                    <div class="depot-item">
                        <i class="fa-solid fa-user-doctor text-red"></i>
                        <span class="val" id="depot-${name.replace(" ", "")}-medics">${inv.medical_teams}</span>
                        <span class="lbl">Squads</span>
                    </div>
                    <div class="depot-item">
                        <i class="fa-solid fa-box-open text-orange"></i>
                        <span class="val" id="depot-${name.replace(" ", "")}-food">${inv.food_packs}</span>
                        <span class="lbl">Food</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// Render SMS warning log
function renderBroadcasts() {
    const feed = document.getElementById("sms-broadcasts-feed");
    const countBadge = document.getElementById("sms-broadcast-count");
    
    countBadge.innerText = `${State.broadcasts.length} sent`;

    if (State.broadcasts.length === 0) {
        feed.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-radio text-muted"></i>
                <p>No safety broadcast transmissions logged yet.</p>
            </div>`;
        return;
    }

    feed.innerHTML = State.broadcasts.map(msg => {
        return `
            <div class="broadcast-card">
                <div class="broadcast-meta">
                    <span><i class="fa-solid fa-tower-broadcast"></i> ${msg.district.toUpperCase()}</span>
                    <span class="broadcast-time">${msg.time}</span>
                </div>
                <div class="broadcast-msg">${msg.message}</div>
            </div>
        `;
    }).join("");
}

// Render decision justification panel
function renderRationales() {
    const container = document.getElementById("decision-rationales");
    const countBadge = document.getElementById("decisions-count");
    
    countBadge.innerText = `${State.rationales.length} logged`;

    if (State.rationales.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-scroll text-muted"></i>
                <p>No dispatch rationales recorded yet. Waiting for AI decision tool call.</p>
            </div>`;
        return;
    }

    container.innerHTML = State.rationales.map(rat => {
        return `
            <div class="decision-card">
                <div class="decision-header"><i class="fa-solid fa-brain"></i> Rationale for ${rat.alert_id}</div>
                <div class="decision-reason">${rat.reason}</div>
            </div>
        `;
    }).join("");
}

// Render District Water Risk States on SVG Map
function renderMapState() {
    Object.entries(State.districts).forEach(([name, data]) => {
        const node = document.getElementById(`node-${name}`);
        const waterLbl = document.getElementById(`water-${name}`);
        if (node) {
            // Remove previous classes
            node.classList.remove("state-normal", "state-warning", "state-critical");
            
            // Add current risk class
            node.classList.add(`state-${data.risk}`);
        }
        if (waterLbl) {
            waterLbl.innerText = `${data.water_level.toFixed(1)}m`;
        }
    });

    // Populate existing pending citizen symbols on map
    const layer = document.getElementById("stranded-markers-layer");
    layer.innerHTML = "";
    
    State.sos_alerts.forEach(alert => {
        if (alert.status === "resolved") return;
        
        // Get district coordinate
        const coord = State.nodes[alert.district];
        if (!coord) return;
        
        // Offset coords slightly based on ID so they don't sit directly on the text label
        const offset = parseInt(alert.id.split("-")[1]) % 2 === 0 ? 15 : -15;
        const mx = coord.x + offset;
        const my = coord.y + offset + 10;
        
        // Generate SVG Group for stranded indicators
        const color = alert.severity === "critical" ? "#ef4444" : "#f59e0b";
        layer.innerHTML += `
            <g class="stranded-spot" transform="translate(${mx}, ${my})" data-id="${alert.id}">
                <circle r="6" fill="${color}" stroke="#fff" stroke-width="1.5" />
                <path d="M-3,-2 L3,4 M3,-2 L-3,4" stroke="#fff" stroke-width="1.2" />
            </g>
        `;
    });
}

// Draw Dispatch Route Path in SVG map
function renderDispatchPathOnMap(centerId, targetDistrict, isSafeRoute) {
    const routesLayer = document.getElementById("map-routes-layer");
    
    const center = State.depots[centerId];
    const district = State.nodes[targetDistrict];
    
    if (!center || !district) return;
    
    // Draw route path
    const pathId = `route-${centerId.replace(/ /g, "")}-${targetDistrict}`;
    
    // Clear existing path if matches
    const oldPath = document.getElementById(pathId);
    if (oldPath) oldPath.remove();
    
    // Calculate control points for a curved path
    const cx = (center.x + district.x) / 2;
    const cy = (center.y + district.y) / 2 - 40; // Curve upwards
    
    const d = `M ${center.x} ${center.y} Q ${cx} ${cy} ${district.x} ${district.y}`;
    const strokeColor = isSafeRoute ? "var(--color-green)" : "var(--color-red)";
    
    // Append SVG Path
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathElement.setAttribute("d", d);
    pathElement.setAttribute("id", pathId);
    pathElement.setAttribute("class", `dispatch-route-line ${isSafeRoute ? 'route-safe' : 'route-critical'}`);
    pathElement.setAttribute("stroke-width", "3");
    
    routesLayer.appendChild(pathElement);
    
    // Remove route visualization after 8 seconds (simulating delivery/enroute flow completion visual)
    setTimeout(() => {
        pathElement.style.transition = "opacity 1s";
        pathElement.style.opacity = 0;
        setTimeout(() => pathElement.remove(), 1000);
    }, 8000);
}

// --- Console Log / Telemetry ---
function logTelemetry(type, message) {
    const consoleContainer = document.getElementById("telemetry-log");
    if (!consoleContainer) return;
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let rowClass = "system-msg";
    let prefix = "[System]";

    if (type === "tool-call") {
        rowClass = "tool-call";
        prefix = "🤖 [Tool Call]";
    } else if (type === "tool-response") {
        rowClass = "tool-response";
        prefix = "↩️ [Response]";
    } else if (type === "tool-error") {
        rowClass = "tool-error";
        prefix = "❌ [Tool Error]";
    }

    consoleContainer.innerHTML += `<div class="tel-row ${rowClass}">${prefix} (${timestamp}) ${message}</div>`;
    consoleContainer.scrollTop = consoleContainer.scrollHeight;
}

// --- Crisis Auto-Simulator ---
const SOS_LOCATIONS = ["Kathmandu", "Lalitpur", "Sindhupalchok", "Rautahat", "Siraha", "Saptari"];
const NEEDS_COMBOS = [
    ["rescue"],
    ["medical"],
    ["food"],
    ["rescue", "food"],
    ["rescue", "medical"],
    ["medical", "food"],
    ["rescue", "medical", "food"]
];
let sosIdCounter = 104;

function triggerMockSOS() {
    const district = SOS_LOCATIONS[Math.floor(Math.random() * SOS_LOCATIONS.length)];
    const people = Math.floor(Math.random() * 15) + 3;
    const children = Math.floor(Math.random() * (people / 2));
    const elderly = Math.floor(Math.random() * (people / 4));
    const needs = NEEDS_COMBOS[Math.floor(Math.random() * NEEDS_COMBOS.length)];
    
    // Water level matches district risk levels
    let water_level_m = 0.5 + Math.random() * 2.5;
    let severity = "medium";
    if (water_level_m > 2.0 || people > 10 || children > 3) {
        severity = "critical";
    }

    const newAlert = {
        id: `SOS-${sosIdCounter++}`,
        district,
        people,
        children,
        elderly,
        severity,
        needs,
        water_level_m: parseFloat(water_level_m.toFixed(1)),
        status: "pending"
    };

    // Push into state
    State.sos_alerts.push(newAlert);
    
    // Update district water level & risk if water is higher
    if (State.districts[district].water_level < water_level_m) {
        State.districts[district].water_level = water_level_m;
        State.districts[district].risk = severity === "critical" ? "critical" : "warning";
    }

    logTelemetry("system", `New SOS Broadcast received: ${newAlert.id} at ${district} (${people} stranded, water level ${newAlert.water_level_m}m)`);
    renderAll();
}

function setupSimulation() {
    // Generate new SOS requests automatically every 50 seconds to keep screen alive
    setInterval(() => {
        triggerMockSOS();
    }, 50000);
}
