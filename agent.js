/* ==========================================================================
   Nepal Disaster Watch - Sandbox AI Agent & Gemini Integrator
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    setupAgentUI();
});

// --- UI Binding ---
function setupAgentUI() {
    const aiWidget = document.getElementById("ai-widget");
    const toggleBtn = document.getElementById("btn-toggle-ai");
    const chatForm = document.getElementById("ai-chat-form");
    const userInput = document.getElementById("ai-user-input");
    const presetButtons = document.querySelectorAll(".btn-preset");

    // Toggle widget collapse
    toggleBtn.addEventListener("click", () => {
        aiWidget.classList.toggle("collapsed");
    });

    // Handle quick preset command runs
    presetButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const command = btn.getAttribute("data-command");
            runAgentInstruction(command);
        });
    });

    // Form submit
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const command = userInput.value.trim();
        if (command) {
            userInput.value = "";
            runAgentInstruction(command);
        }
    });
}

// --- Append Chat Bubble Helpers ---
function appendChatBubble(sender, text, isAi = false) {
    const messagesContainer = document.getElementById("ai-chat-messages");
    if (!messagesContainer) return;

    const msg = document.createElement("div");
    msg.className = `chat-msg ${isAi ? 'ai' : 'user'}`;
    
    msg.innerHTML = `
        <div class="msg-sender">${sender}</div>
        <div class="msg-text">${text}</div>
    `;

    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
}

// Remove element helper
function removeElement(el) {
    if (el && el.parentNode) {
        el.parentNode.removeChild(el);
    }
}

// Append "Thinking..." bubble
function appendThinkingBubble() {
    const messagesContainer = document.getElementById("ai-chat-messages");
    if (!messagesContainer) return null;

    const msg = document.createElement("div");
    msg.className = "chat-msg ai thinking-msg";
    msg.innerHTML = `
        <div class="msg-sender">Disaster Watch Agent</div>
        <div class="msg-text">
            <div class="thinking-bubble">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
}

// --- Agent Orchestration Router ---
async function runAgentInstruction(command) {
    appendChatBubble("Human Operator", command, false);
    
    // Check if key is available
    const apiKey = localStorage.getItem("gemini_api_key");
    const thinking = appendThinkingBubble();

    try {
        if (apiKey) {
            // Live Gemini Agent Execution
            await runLiveGeminiAgent(command, apiKey, thinking);
        } else {
            // Rule-Based Simulation Loop
            await runSimulatedAgent(command, thinking);
        }
    } catch (err) {
        console.error("Agent error:", err);
        removeElement(thinking);
        appendChatBubble("Disaster Watch Agent", `<span class="text-red">Error during execution: ${err.message}</span>`, true);
    }
}

// --- Mode A: Rule-Based Command Simulator (No API Key Required) ---
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSimulatedAgent(command, thinkingBubble) {
    removeElement(thinkingBubble);
    
    const cmd = command.toLowerCase();
    
    // Preset A: Auto Triage
    if (cmd.includes("triage") || cmd.includes("auto")) {
        appendChatBubble("Disaster Watch Agent", "Initiating crisis triage loop. Querying active alerts...", true);
        await sleep(1500);

        // Tool Call 1
        const alertsRes = await window.WebMCPRegistry.get_active_sos_alerts.execute({});
        const pending = alertsRes.alerts;

        if (pending.length === 0) {
            appendChatBubble("Disaster Watch Agent", "Analyzed alerts: 0 unresolved SOS queues found. Action halted.", true);
            return;
        }

        // Triage prioritization
        appendChatBubble("Disaster Watch Agent", `Found ${pending.length} pending distress signals. Prioritizing critical alerts with children.`, true);
        await sleep(1500);

        // Sorting by critical and children count
        const prioritized = [...pending].sort((a, b) => {
            if (a.severity === "critical" && b.severity !== "critical") return -1;
            if (a.severity !== "critical" && b.severity === "critical") return 1;
            return b.children - a.children;
        });

        const targetAlert = prioritized[0];
        appendChatBubble("Disaster Watch Agent", `Selected target: <strong>${targetAlert.id}</strong> in <strong>${targetAlert.district}</strong> (${targetAlert.people} people, ${targetAlert.children} children). Checking depot capacities...`, true);
        await sleep(1500);

        // Tool Call 2
        const resourceRes = await window.WebMCPRegistry.get_relief_resources.execute({});
        
        // Find nearest depot with boats
        let selectedDepot = "Biratnagar Center"; // default
        if (targetAlert.district === "Kathmandu" || targetAlert.district === "Lalitpur" || targetAlert.district === "Sindhupalchok") {
            selectedDepot = "Kathmandu Center";
        } else if (targetAlert.district === "Rautahat" || targetAlert.district === "Siraha") {
            selectedDepot = "Janakpur Center";
        }

        // Check route
        appendChatBubble("Disaster Watch Agent", `Assessing geographical transport routes from <strong>${selectedDepot}</strong> to ${targetAlert.district}...`, true);
        await sleep(1500);

        // Tool Call 3
        const routeRes = await window.WebMCPRegistry.get_safest_route.execute({ center_id: selectedDepot, alert_id: targetAlert.id });
        const recommendedRoute = routeRes.routes.find(r => r.recommended) || routeRes.routes[0];

        appendChatBubble("Disaster Watch Agent", `Route check complete. Recommended Path: <strong>${recommendedRoute.name}</strong> (Flood hazard risk: ${recommendedRoute.flood_risk}). Initiating resource allocation...`, true);
        await sleep(1500);

        // Determine resources
        const neededBoats = targetAlert.people > 8 ? 2 : 1;
        const neededMedics = targetAlert.needs.includes("medical") ? 1 : 0;
        
        // Tool Call 4: Dispatch
        const dispatchRes = await window.WebMCPRegistry.dispatch_relief.execute({
            alert_id: targetAlert.id,
            center_id: selectedDepot,
            resources: { boats: neededBoats, medical_teams: neededMedics, food_packs: targetAlert.people * 5 },
            priority: "critical",
            estimated_arrival: "25 minutes",
            route_name: recommendedRoute.name
        });

        // Tool Call 5: Decision Explanation
        await window.WebMCPRegistry.explain_dispatch_decision.execute({
            alert_id: targetAlert.id,
            reason: `Dispatched ${neededBoats} boat(s) and squads from ${selectedDepot} to ${targetAlert.id} via ${recommendedRoute.name} because it is the unblocked route bypassing active river flood lines.`
        });

        appendChatBubble("Disaster Watch Agent", `<strong>Dispatch complete.</strong> Dispatched assets from ${selectedDepot} to ${targetAlert.id}. Route drawn on map.`, true);
    } 
    // Preset B: Medical Route Lalitpur
    else if (cmd.includes("lalitpur") || cmd.includes("medical")) {
        appendChatBubble("Disaster Watch Agent", "Querying Lalitpur alerts...", true);
        await sleep(1200);

        const alert = State.sos_alerts.find(a => a.district === "Lalitpur" && a.status === "pending");
        if (!alert) {
            appendChatBubble("Disaster Watch Agent", "No pending Lalitpur SOS alerts found.", true);
            return;
        }

        // Assess routes
        const depot = "Kathmandu Center";
        const routeRes = await window.WebMCPRegistry.get_safest_route.execute({ center_id: depot, alert_id: alert.id });
        const recommendedRoute = routeRes.routes.find(r => r.recommended) || routeRes.routes[0];

        appendChatBubble("Disaster Watch Agent", `Selected Route: ${recommendedRoute.name}. Dispatching medical unit...`, true);
        await sleep(1200);

        await window.WebMCPRegistry.dispatch_relief.execute({
            alert_id: alert.id,
            center_id: depot,
            resources: { boats: 0, medical_teams: 1, food_packs: 10 },
            priority: "medium",
            estimated_arrival: "15 minutes",
            route_name: recommendedRoute.name
        });

        await window.WebMCPRegistry.explain_dispatch_decision.execute({
            alert_id: alert.id,
            reason: `Dispatched 1 medical team from Kathmandu Depot to Lalitpur ${alert.id} using recommended route ${recommendedRoute.name}.`
        });

        appendChatBubble("Disaster Watch Agent", "Medical team dispatched successfully.", true);
    } 
    // Preset C: Evacuation warning broadcasts
    else if (cmd.includes("broadcast") || cmd.includes("warning") || cmd.includes("evacuation")) {
        appendChatBubble("Disaster Watch Agent", "Scanning map for high flood risk districts...", true);
        await sleep(1500);

        // Find districts with high risk
        const highRiskDistricts = Object.entries(State.districts)
            .filter(([name, data]) => data.risk === "critical" || data.risk === "warning")
            .map(([name]) => name);

        if (highRiskDistricts.length === 0) {
            appendChatBubble("Disaster Watch Agent", "No districts currently in Warning/Critical state. Broadcast cancelled.", true);
            return;
        }

        appendChatBubble("Disaster Watch Agent", `Found risk zones: ${highRiskDistricts.join(", ")}. Transmitting emergency alerts...`, true);
        
        for (const dist of highRiskDistricts) {
            await sleep(1000);
            await window.WebMCPRegistry.broadcast_safety_message.execute({
                district: dist,
                message: `URGENT SMS: Saptakoshi/Bagmati river water level is critical in ${dist}. Residents in low-lying sectors should immediately evacuate to the designated shelters.`,
                urgency: "critical"
            });
        }

        appendChatBubble("Disaster Watch Agent", `Emergency broadcasts successfully sent to: ${highRiskDistricts.join(", ")}.`, true);
    } 
    // Default fallback
    else {
        appendChatBubble("Disaster Watch Agent", "I received your command. However, in Simulation Mode, please use one of the preset quick task buttons above. Enter your Gemini API Key in Settings to enable open-ended natural language control.", true);
    }
}

// --- Mode B: Live Client-Side Gemini Agent (Function Calling Loop) ---
async function runLiveGeminiAgent(command, apiKey, thinkingBubble) {
    // Generate Gemini Tool Declarations to match our WebMCP Registry tools
    const geminiTools = [
        {
            functionDeclarations: [
                {
                    name: "get_active_sos_alerts",
                    description: "Retrieves list of active unresolved citizen flood distress signals (SOS alerts). Use this to triage incoming requests.",
                    parameters: { type: "OBJECT", properties: {} }
                },
                {
                    name: "get_relief_resources",
                    description: "Retrieves available rescue supplies (boats, medical squads, food packs) at Kathmandu, Janakpur, and Biratnagar depots.",
                    parameters: { type: "OBJECT", properties: {} }
                },
                {
                    name: "get_safest_route",
                    description: "Checks safety routing alternatives between a chosen rescue depot center and a target SOS location. Highlights roadblocks.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            center_id: { type: "STRING", description: "The name of the rescue depot center" },
                            alert_id: { type: "STRING", description: "The target SOS alert ID" }
                        },
                        required: ["center_id", "alert_id"]
                    }
                },
                {
                    name: "dispatch_relief",
                    description: "Dispatches resource units to an SOS distress alert from a depot. This alters the page state and draws the route on the map.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            alert_id: { type: "STRING" },
                            center_id: { type: "STRING" },
                            resources: {
                                type: "OBJECT",
                                properties: {
                                    boats: { type: "INTEGER" },
                                    medical_teams: { type: "INTEGER" },
                                    food_packs: { type: "INTEGER" }
                                }
                            },
                            priority: { type: "STRING", enum: ["low", "medium", "critical"] },
                            estimated_arrival: { type: "STRING" },
                            route_name: { type: "STRING" }
                        },
                        required: ["alert_id", "center_id", "resources", "priority", "estimated_arrival", "route_name"]
                    }
                },
                {
                    name: "broadcast_safety_message",
                    description: "Sends an emergency safety or evacuation broadcast warning to all cellular terminals inside a district.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            district: { type: "STRING" },
                            message: { type: "STRING" },
                            urgency: { type: "STRING", enum: ["high", "critical"] }
                        },
                        required: ["district", "message", "urgency"]
                    }
                },
                {
                    name: "explain_dispatch_decision",
                    description: "Logs the detailed reasoning for your resource dispatch selections directly on the operator monitor.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            alert_id: { type: "STRING" },
                            reason: { type: "STRING" }
                        },
                        required: ["alert_id", "reason"]
                    }
                }
            ]
        }
    ];

    // Maintain chat history context
    const messages = [
        {
            role: "user",
            parts: [
                {
                    text: `You are the Nepal Disaster Watch Response Co-pilot, operating an emergency command center for Nepal Floods.
                    You have direct control of this page using the provided WebMCP tools.
                    
                    CRITICAL INSTRUCTION:
                    When coordinating a dispatch:
                    1. Query active alerts using get_active_sos_alerts().
                    2. Identify which alert needs focus (critical severity with children should be triaged first).
                    3. Query available resources using get_relief_resources().
                    4. Choose the closest center that has the required tools (e.g. boats, medical squads).
                    5. Call get_safest_route(center_id, alert_id) to verify if the route is unblocked or has high risks.
                    6. Execute the dispatch using dispatch_relief(...) choosing the recommended, unblocked route.
                    7. ALWAYS call explain_dispatch_decision(alert_id, reason) to log your dispatch justification.
                    
                    Here is the operator prompt: "${command}"`
                }
            ]
        }
    ];

    let loopActive = true;
    let iterations = 0;
    const maxIterations = 8; // prevent runaway loops

    while (loopActive && iterations < maxIterations) {
        iterations++;
        
        // Fetch Gemini response
        const apiResponse = await fetchGeminiAPI(messages, geminiTools, apiKey);
        
        if (apiResponse.candidates && apiResponse.candidates[0].content) {
            const content = apiResponse.candidates[0].content;
            
            // Append Gemini's message response context to the loop history
            messages.push(content);

            // Check if Gemini requested function calls
            if (content.parts && content.parts[0].functionCall) {
                const call = content.parts[0].functionCall;
                const toolName = call.name;
                const toolArgs = call.args;

                logTelemetry("system", `Gemini requested tool execution: ${toolName}`);

                // Execute the tool locally
                let toolResult;
                if (window.WebMCPRegistry[toolName]) {
                    try {
                        toolResult = await window.WebMCPRegistry[toolName].execute(toolArgs);
                    } catch (err) {
                        toolResult = { error: err.message };
                    }
                } else {
                    toolResult = { error: `Tool ${toolName} not registered.` };
                }

                // Append the function response block to messages for the next request in the loop
                messages.push({
                    role: "model",
                    parts: [
                        {
                            functionResponse: {
                                name: toolName,
                                response: toolResult
                            }
                        }
                    ]
                });
            } else {
                // Gemini responded with normal text, meaning the tool loop is complete
                removeElement(thinkingBubble);
                const replyText = content.parts[0].text;
                appendChatBubble("Disaster Watch Agent", replyText, true);
                loopActive = false;
            }
        } else {
            throw new Error(apiResponse.error?.message || "Invalid API response from Gemini.");
        }
    }

    if (iterations >= maxIterations) {
        removeElement(thinkingBubble);
        appendChatBubble("Disaster Watch Agent", "AI operation loop exceeded maximum step limits. Action suspended.", true);
    }
}

// API Fetch helper
async function fetchGeminiAPI(contents, tools, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
        contents: contents
    };
    if (tools) {
        requestBody.tools = tools;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP ${response.status} Error`);
    }

    return await response.json();
}
