/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Application Bootstrap
 * Offline-first, decentralized safety dashboard orchestrator
 */

import { appState, updateState, subscribe } from "./state.js";
import { initStorage, getIncidents, getMessages, getNodes, getSettings, saveIncident, saveNode, saveMessage } from "./storage.js";
import { initialMockData } from "./mock-data.js";
import { initDashboard } from "./dashboard.js";
import { initSafetyMap } from "./safety-map.js";
import { initIncidents } from "./incidents.js";
import { initNodes } from "./nodes.js";
import { initMessages } from "./messages.js";
import { initIdentity } from "./identity.js";
import { initSettings } from "./settings.js";
import { initRouter } from "./router.js";
import { initWebSocket, simulateEvent, sendSosRequest } from "./websocket.js";

async function registerOfflineServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[LOKRAKSHA] Offline Service Worker:", registration.scope);
  } catch (error) {
    console.warn("[LOKRAKSHA] Service Worker registration failed:", error);
  }
}

/**
 * Main application initialization sequence
 */
async function bootstrapApp() {
  console.log("[LOKRAKSHA] Starting offline-first decentralized safety client...");

  // 1. Initialize IndexedDB Storage
  await initStorage();

  // 2. Load stored records or seed from initial mock data
  await loadOrSeedData();

  // 3. Initialize View Components
  initDashboard();
  // Safety Map DOM is prepared here, but Leaflet itself initializes when
  // the router activates the map view. This avoids hidden-container sizing bugs.
  initSafetyMap();
  initIncidents();
  initNodes();
  initMessages();
  initIdentity();
  initSettings();
  initRouter();

  // 4. Setup Simulation Toolbar & Floating Demo Controls
  setupDemoDrawer();

  // 5. Setup Header & UI Shell Listeners
  setupShellInteractions();

  // 6. Register the local offline application shell.
  await registerOfflineServiceWorker();

  // 7. Connect to local device WebSocket (with auto-fallback to mock engine)
  initWebSocket();

  console.log("[LOKRAKSHA] Initialization complete. Node ready.");
}

/**
 * Load stored records from IndexedDB or seed defaults
 */
async function loadOrSeedData() {
  const [storedIncidents, storedMessages, storedNodes, storedSettings] = await Promise.all([
    getIncidents(),
    getMessages(),
    getNodes(),
    getSettings()
  ]);

  // Incidents
  if (storedIncidents && storedIncidents.length > 0) {
    updateState("incidents", storedIncidents);
  } else {
    updateState("incidents", initialMockData.incidents);
    for (const inc of initialMockData.incidents) {
      await saveIncident(inc);
    }
  }

  // Messages
  if (storedMessages && storedMessages.length > 0) {
    updateState("messages", storedMessages);
  } else {
    updateState("messages", initialMockData.messages);
    for (const msg of initialMockData.messages) {
      await saveMessage(msg);
    }
  }

  // Nearby Nodes
  if (storedNodes && storedNodes.length > 0) {
    updateState("nodes", storedNodes);
  } else {
    updateState("nodes", initialMockData.nodes);
    for (const node of initialMockData.nodes) {
      await saveNode(node);
    }
  }

  // Settings
  if (storedSettings && Object.keys(storedSettings).length > 0) {
    updateState("settings", { ...appState.settings, ...storedSettings });
  }
}

/**
 * Setup Mobile Menu & Global Alert Banner Interactions
 */
function setupShellInteractions() {
  const menuToggle = document.getElementById("menu-toggle-btn");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  menuToggle?.addEventListener("click", () => {
    sidebar?.classList.toggle("mobile-open");
    backdrop?.classList.toggle("active");
  });

  backdrop?.addEventListener("click", () => {
    sidebar?.classList.remove("mobile-open");
    backdrop?.classList.remove("active");
  });

  // Emergency banner dismiss
  document.getElementById("banner-dismiss-btn")?.addEventListener("click", () => {
    document.getElementById("emergency-banner")?.classList.remove("visible");
  });

  // Subscribe to incidents badge update in sidebar
  subscribe("incidents", (incidents) => {
    const badge = document.getElementById("sidebar-incident-badge");
    const activeCount = incidents.filter(i => i.status === "ACTIVE" || i.status === "RESPONDING").length;
    if (badge) {
      if (activeCount > 0) {
        badge.style.display = "inline-block";
        badge.textContent = activeCount;
      } else {
        badge.style.display = "none";
      }
    }
  });

  // Subscribe to peer count badge
  subscribe("nodes", (nodes) => {
    const badge = document.getElementById("sidebar-nodes-badge");
    if (badge) badge.textContent = nodes.length;
  });

  // Subscribe to connection state for universal header and sidebar status
  subscribe("connection", (conn) => {
    const headerConnTag = document.getElementById("header-connection-tag");
    if (headerConnTag) {
      if (conn.status === "connected") {
        headerConnTag.className = "tag-badge tag-live";
        headerConnTag.textContent = "● LIVE ESP32 LINK";
      } else if (conn.status === "connecting" || conn.status === "reconnecting") {
        headerConnTag.className = "tag-badge tag-lora";
        headerConnTag.textContent = "◌ CONNECTING...";
      } else if (conn.status === "mock_mode") {
        headerConnTag.className = "tag-badge tag-lora";
        headerConnTag.textContent = "● MOCK SIMULATOR";
      } else {
        headerConnTag.className = "tag-badge";
        headerConnTag.textContent = "○ ESP32 OFFLINE";
      }
    }

    const sidebarMode = document.getElementById("sidebar-peer-mode");
    if (sidebarMode) {
      sidebarMode.textContent = conn.status === "connected"
        ? "LOCAL WI-FI DIRECT"
        : (conn.mode === "mock" ? "MOCK SIMULATOR" : "DISCONNECTED");
    }

    const sidebarDot = document.getElementById("sidebar-status-dot");
    if (sidebarDot) {
      sidebarDot.className = conn.status === "connected"
        ? "status-dot status-safe"
        : (conn.status === "connecting" || conn.status === "reconnecting" ? "status-dot status-caution" : "status-dot status-restricted");
    }
  });

  // Subscribe to telemetry for header status tags
  subscribe("telemetry", (t) => {
    const loraTag = document.getElementById("header-lora-tag");
    if (loraTag) loraTag.textContent = `LoRa: ${t.loraStatus || 'CONNECTED'}`;

    const gpsTag = document.getElementById("header-gps-tag");
    if (gpsTag) gpsTag.textContent = `GPS: ${t.gpsStatus || 'ACTIVE'}`;
  });

  // Subscribe to device identity for sidebar
  subscribe("device", (dev) => {
    const sidebarName = document.getElementById("sidebar-peer-name");
    if (sidebarName) sidebarName.textContent = `${dev.id} (${dev.name.replace("LOKRAKSHA ", "")})`;
  });
}

/**
 * Setup Demo Simulation Drawer for Presentations and Testing
 */
function setupDemoDrawer() {
  const drawer = document.getElementById("demo-drawer");
  const toggleBtn = document.getElementById("demo-toggle-btn");
  const closeBtn = document.getElementById("demo-close-btn");

  toggleBtn?.addEventListener("click", () => {
    drawer?.classList.toggle("open");
  });

  closeBtn?.addEventListener("click", () => {
    drawer?.classList.remove("open");
  });

  // 1. Simulate Safe Zone
  document.getElementById("sim-safe-btn")?.addEventListener("click", () => {
    simulateEvent("GEOFENCE_ALERT", {
      zone_id: "ZONE-SAFE-01",
      zone_name: "Campus Quad Safe Zone",
      zone_type: "SAFE",
      message: "You are currently inside an authorized safe zone.",
      distance: 145,
      recommended_action: "Normal operation. Location beacon active."
    });
    showToast("Simulated Entry: SAFE ZONE", "safe");
  });

  // 2. Simulate Caution Zone
  document.getElementById("sim-caution-btn")?.addEventListener("click", () => {
    simulateEvent("GEOFENCE_ALERT", {
      zone_id: "ZONE-CAUTION-01",
      zone_name: "North Perimeter Corridor",
      zone_type: "CAUTION",
      message: "Exercise increased awareness in this zone.",
      distance: 35,
      recommended_action: "Maintain radio contact with nearby peers."
    });
    showToast("Simulated Entry: CAUTION ZONE", "caution");
  });

  // 3. Simulate Restricted Zone
  document.getElementById("sim-restricted-btn")?.addEventListener("click", () => {
    simulateEvent("GEOFENCE_ALERT", {
      zone_id: "ZONE-RESTRICTED-01",
      zone_name: "Hazardous Chemical / Sump Zone",
      zone_type: "RESTRICTED",
      message: "Safety warning triggered: Prohibited restricted boundary breached.",
      distance: 0,
      recommended_action: "Immediate exit recommended. Distress alert broadcast prepared."
    });
    showToast("WARNING: Entered RESTRICTED ZONE", "danger");
  });

  // 4. Simulate SOS Trigger (via proper SOS_REQUEST -> ESP32 / Simulator -> SOS_RECEIVED flow)
  document.getElementById("sim-sos-btn")?.addEventListener("click", async () => {
    await sendSosRequest(appState.device.id);
  });

  // 5. Simulate Peer Node Distress (e.g. LKRK-004 incoming LoRa broadcast)
  document.getElementById("sim-peer-sos-btn")?.addEventListener("click", () => {
    simulateEvent("SOS_RECEIVED", {
      device_id: "LKRK-004",
      device_name: "LOKRAKSHA Delta",
      lat: 19.0785,
      lng: 72.8745,
      risk: "CRITICAL",
      incident_type: "SOS",
      temperature: 33.0,
      humidity: 68,
      battery: 48
    });
    showToast("🚨 Incoming Distress from Peer LKRK-004", "danger");
  });

  // 6. Simulate New Node Joined
  document.getElementById("sim-node-join-btn")?.addEventListener("click", () => {
    const randomId = "LKRK-00" + (appState.nodes.length + 2);
    simulateEvent("NODE_JOINED", {
      id: randomId,
      name: `LOKRAKSHA ${String.fromCharCode(65 + appState.nodes.length + 1)}`,
      status: "ONLINE",
      risk: "LOW",
      rssi: -72,
      lat: 19.0760 + (Math.random() - 0.5) * 0.01,
      lng: 72.8777 + (Math.random() - 0.5) * 0.01,
      battery: 88,
      temperature: 30.5,
      humidity: 71
    });
    showToast(`Peer Node Discovered: ${randomId}`, "safe");
  });

  // 7. Reset State
  document.getElementById("sim-reset-btn")?.addEventListener("click", () => {
    updateState("device", { ...appState.device, status: "ONLINE" });
    updateState("sosRequest", { status: "IDLE", timestamp: null, error: null });
    updateState("currentZone", {
      id: "ZONE-SAFE-01",
      name: "Campus Quad Safe Zone",
      type: "SAFE",
      message: "You are currently inside an authorized safe zone.",
      distanceToBoundaryMeters: 145,
      recommendedAction: "Normal operation. Location beacon active."
    });
    updateState("risk", {
      level: "LOW",
      score: 12,
      reasons: [
        "All sensors operating in nominal range",
        "Inside designated safe perimeter",
        "Stable peer heartbeat detected"
      ],
      timestamp: Date.now()
    });
    document.getElementById("emergency-banner")?.classList.remove("visible");
    showToast("Simulation Reset to Nominal State", "safe");
  });
}

export function showToast(message, type = "safe") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'danger' ? '🚨' : type === 'caution' ? '⚠️' : '✓'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Start application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapApp);
} else {
  bootstrapApp();
}
