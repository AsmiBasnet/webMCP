/* ==========================================================================
   SankatSathi - WebMCP Tool Registry & Bridge Layer
   ========================================================================== */

// Local registry so that the embedded local sandbox agent can inspect 
// and invoke tools in the exact same format as native WebMCP clients.
window.WebMCPRegistry = {};

// Helper to check for WebMCP capability
function isWebMCPAvailable() {
    return (
        typeof document.modelContext !== "undefined" &&
        typeof document.modelContext.registerTool === "function"
    );
}

// Register all command tools
async function registerAllTools() {
    const tools = [
        // 1. get_active_sos_alerts
        {
            name: "get_active_sos_alerts",
            description: "Fetches the current list of unresolved (pending) citizen SOS distress signals. Returns demographics, water levels, and needs.",
            inputSchema: {
                type: "object",
                properties: {}
            },
            execute: async (args) => {
                logTelemetry("tool-call", "get_active_sos_alerts()");
                const pendingAlerts = State.sos_alerts.filter(a => a.status === "pending");
                logTelemetry("tool-response", `Found ${pendingAlerts.length} pending alerts.`);
                return { alerts: pendingAlerts };
            }
        },

        // 2. get_relief_resources
        {
            name: "get_relief_resources",
            description: "Retrieves current inventory of rescue assets (boats, medical squads, food packs) at each of the 3 rescue depots in Nepal (Kathmandu, Janakpur, Biratnagar).",
            inputSchema: {
                type: "object",
                properties: {}
            },
            execute: async (args) => {
                logTelemetry("tool-call", "get_relief_resources()");
                logTelemetry("tool-response", `Returned inventories for Kathmandu Center, Janakpur Center, and Biratnagar Center.`);
                return { resources: State.depots };
            }
        },

        // 3. get_safest_route
        {
            name: "get_safest_route",
            description: "Evaluates route alternatives from a specific rescue depot center to an SOS alert destination, returning distances, road conditions, and flood hazard levels.",
            inputSchema: {
                type: "object",
                properties: {
                    center_id: {
                        type: "string",
                        description: "The name of the rescue center depot (e.g. 'Kathmandu Center', 'Biratnagar Center', 'Janakpur Center')."
                    },
                    alert_id: {
                        type: "string",
                        description: "The ID of the target emergency alert (e.g. 'SOS-101', 'SOS-102')."
                    }
                },
                required: ["center_id", "alert_id"]
            },
            execute: async (args) => {
                const { center_id, alert_id } = args;
                logTelemetry("tool-call", `get_safest_route({ center_id: "${center_id}", alert_id: "${alert_id}" })`);
                
                // Find alert district
                const alert = State.sos_alerts.find(a => a.id === alert_id);
                if (!alert) {
                    const err = `Alert ${alert_id} not found.`;
                    logTelemetry("tool-error", err);
                    return { error: err };
                }

                const district = alert.district;
                
                // Fetch routes from RoutingDB
                let routes = [];
                if (RoutingDB[center_id] && RoutingDB[center_id][district]) {
                    routes = RoutingDB[center_id][district];
                } else {
                    // Generate fallback default route
                    routes = [
                        { name: "Generic Local Highway", distance_km: 25, flood_risk: "warning", blocked_road: false, recommended: true }
                    ];
                }

                logTelemetry("tool-response", `Found ${routes.length} route options to ${district}.`);
                return { routes };
            }
        },

        // 4. dispatch_relief
        {
            name: "dispatch_relief",
            description: "Dispatches rescue assets (boats, medical squads, food packs) from a center depot to an active SOS alert using a specific route. Decrements inventory, updates status, and animates routing on map.",
            inputSchema: {
                type: "object",
                properties: {
                    alert_id: {
                        type: "string",
                        description: "The ID of the emergency alert being resolved."
                    },
                    center_id: {
                        type: "string",
                        description: "The source rescue center depot."
                    },
                    resources: {
                        type: "object",
                        description: "Object specifying quantity of assets to send.",
                        properties: {
                            boats: { type: "integer", default: 0 },
                            medical_teams: { type: "integer", default: 0 },
                            food_packs: { type: "integer", default: 0 }
                        }
                    },
                    priority: {
                        type: "string",
                        enum: ["low", "medium", "critical"],
                        description: "Urgency classification of the dispatch."
                    },
                    estimated_arrival: {
                        type: "string",
                        description: "Estimated duration of travel (e.g. '20 mins', '1.5 hours')."
                    },
                    route_name: {
                        type: "string",
                        description: "The name of the selected highway or bypass route."
                    }
                },
                required: ["alert_id", "center_id", "resources", "priority", "estimated_arrival", "route_name"]
            },
            execute: async (args) => {
                const { alert_id, center_id, resources, priority, estimated_arrival, route_name } = args;
                logTelemetry("tool-call", `dispatch_relief({ alert_id: "${alert_id}", center_id: "${center_id}", resources: ${JSON.stringify(resources)}, route: "${route_name}" })`);

                const alert = State.sos_alerts.find(a => a.id === alert_id);
                const depot = State.depots[center_id];

                if (!alert) {
                    const err = `SOS alert ${alert_id} not found.`;
                    logTelemetry("tool-error", err);
                    return { status: "error", error: err };
                }
                if (alert.status !== "pending" && alert.status !== "en route") {
                    const err = `Alert ${alert_id} is already in status: ${alert.status}.`;
                    logTelemetry("tool-error", err);
                    return { status: "error", error: err };
                }
                if (!depot) {
                    const err = `Rescue center ${center_id} not found.`;
                    logTelemetry("tool-error", err);
                    return { status: "error", error: err };
                }

                // Check and decrement inventory
                const missing = [];
                if (resources.boats && depot.boats < resources.boats) missing.push("boats");
                if (resources.medical_teams && depot.medical_teams < resources.medical_teams) missing.push("medical_teams");
                if (resources.food_packs && depot.food_packs < resources.food_packs) missing.push("food_packs");

                if (missing.length > 0) {
                    const err = `Insufficient stock in ${center_id} for resource types: ${missing.join(", ")}.`;
                    logTelemetry("tool-error", err);
                    return { status: "error", error: err };
                }

                // Deduct stock
                if (resources.boats) depot.boats -= resources.boats;
                if (resources.medical_teams) depot.medical_teams -= resources.medical_teams;
                if (resources.food_packs) depot.food_packs -= resources.food_packs;

                // Update alert status
                alert.status = "en route";
                alert.dispatched_from = center_id;
                alert.dispatched_resources = resources;
                alert.estimated_arrival = estimated_arrival;
                alert.route = route_name;

                // Query route risk to color code map path
                let isSafeRoute = true;
                if (RoutingDB[center_id] && RoutingDB[center_id][alert.district]) {
                    const rt = RoutingDB[center_id][alert.district].find(r => r.name === route_name);
                    if (rt && (rt.flood_risk === "critical" || rt.blocked_road)) {
                        isSafeRoute = false;
                    }
                }

                // Trigger map rendering
                renderDispatchPathOnMap(center_id, alert.district, isSafeRoute);
                
                // Refresh UI Panels
                renderAll();

                // Mock resolving the SOS alert after 10 seconds of travel
                setTimeout(() => {
                    alert.status = "resolved";
                    logTelemetry("system", `Rescue operation completed: Stranded citizens at ${alert.district} (${alert_id}) are safe.`);
                    renderAll();
                }, 10000);

                const responseMsg = `Successfully dispatched resources from ${center_id} to ${alert_id}. ETA: ${estimated_arrival}.`;
                logTelemetry("tool-response", responseMsg);
                return { status: "success", message: responseMsg };
            }
        },

        // 5. broadcast_safety_message
        {
            name: "broadcast_safety_message",
            description: "Transmits safety warnings and evacuation orders via SMS broadcast to all mobile nodes inside a specific district.",
            inputSchema: {
                type: "object",
                properties: {
                    district: {
                        type: "string",
                        description: "Name of the target district (e.g. 'Rautahat', 'Saptari')."
                    },
                    message: {
                        type: "string",
                        description: "The emergency warning text contents."
                    },
                    urgency: {
                        type: "string",
                        enum: ["high", "critical"],
                        description: "Urgency level of the warning."
                    }
                },
                required: ["district", "message", "urgency"]
            },
            execute: async (args) => {
                const { district, message, urgency } = args;
                logTelemetry("tool-call", `broadcast_safety_message({ district: "${district}", urgency: "${urgency}" })`);

                if (!State.districts[district]) {
                    const err = `Target district ${district} not registered in command map.`;
                    logTelemetry("tool-error", err);
                    return { status: "error", error: err };
                }

                const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                State.broadcasts.unshift({
                    district,
                    message,
                    urgency,
                    time: timestamp
                });

                renderAll();
                
                const responseMsg = `Broadcast warning successfully delivered to cellular receivers in ${district}.`;
                logTelemetry("tool-response", responseMsg);
                return { status: "success", message: responseMsg };
            }
        },

        // 6. explain_dispatch_decision
        {
            name: "explain_dispatch_decision",
            description: "Logs the agent's logical rationale for selecting a specific depot or route, displayable directly on the human operator console.",
            inputSchema: {
                type: "object",
                properties: {
                    alert_id: {
                        type: "string",
                        description: "The SOS alert ID."
                    },
                    reason: {
                        type: "string",
                        description: "Detailed justification details for this resource mapping."
                    }
                },
                required: ["alert_id", "reason"]
            },
            execute: async (args) => {
                const { alert_id, reason } = args;
                logTelemetry("tool-call", `explain_dispatch_decision({ alert_id: "${alert_id}" })`);

                State.rationales.unshift({
                    alert_id,
                    reason,
                    timestamp: new Date().toLocaleTimeString()
                });

                renderAll();
                logTelemetry("tool-response", `Rationale logged for ${alert_id}.`);
                return { status: "success", message: "Decision logged." };
            }
        }
    ];

    // Check if browser has native WebMCP API available
    const nativeSupport = isWebMCPAvailable();
    const dot = document.getElementById("webmcp-dot");
    const label = document.getElementById("webmcp-label");

    if (nativeSupport) {
        dot.className = "pulse-dot green";
        label.innerText = "WEBMCP NATIVE ACTIVE";
        logTelemetry("system", "Native WebMCP environment detected! Registering tools on browser modelContext...");
    } else {
        dot.className = "pulse-dot amber";
        label.innerText = "WEBMCP SIMULATED";
        logTelemetry("system", "Native browser WebMCP not detected. Injecting local simulator bridge on `window.WebMCPRegistry`.");
    }

    // Register each tool
    for (const tool of tools) {
        // Expose to local sandbox agent registry
        window.WebMCPRegistry[tool.name] = tool;

        if (nativeSupport) {
            try {
                // Register on browser's modelContext
                await document.modelContext.registerTool({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    execute: tool.execute
                });
            } catch (err) {
                console.error(`Failed to register native tool ${tool.name}:`, err);
            }
        }
    }
}

// Initiate registration on load
document.addEventListener("DOMContentLoaded", () => {
    registerAllTools().catch(err => {
        console.error("WebMCP setup error:", err);
    });
});
