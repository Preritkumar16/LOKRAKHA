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

  window.simulateEvent = simulateEvent;
  window.appState = appState;

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
  if (storedIncidents && storedIncidents.length > 0 && storedIncidents.some(i => i.lat > 19.15)) {
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
  if (storedNodes && storedNodes.length > 0 && storedNodes.some(n => n.lat > 19.15)) {
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

  // Update header connection & telemetry tags
  const updateHeaderTags = () => {
    const conn = appState.connection;
    const t = appState.telemetry;
    const isLiveConnected = conn.mode === "live" && conn.status === "connected";
    const isMockMode = conn.mode === "mock" || conn.status === "mock_mode";

    const headerConnTag = document.getElementById("header-connection-tag");
    if (headerConnTag) {
      if (isLiveConnected) {
        headerConnTag.className = "tag-badge tag-live";
        headerConnTag.textContent = "● LIVE ESP32 LINK";
      } else if (conn.status === "connecting" || conn.status === "reconnecting") {
        headerConnTag.className = "tag-badge tag-warning";
        headerConnTag.textContent = "◌ CONNECTING...";
      } else if (isMockMode) {
        headerConnTag.className = "tag-badge tag-lora";
        headerConnTag.textContent = "● MOCK SIMULATOR";
      } else {
        headerConnTag.className = "tag-badge tag-offline";
        headerConnTag.textContent = "○ ESP32 OFFLINE";
      }
    }

    const loraTag = document.getElementById("header-lora-tag");
    if (loraTag) {
      if (isLiveConnected) {
        loraTag.className = "tag-badge tag-lora";
        loraTag.textContent = `LoRa: ${t.loraStatus || 'CONNECTED'}`;
      } else if (isMockMode) {
        loraTag.className = "tag-badge tag-lora";
        loraTag.textContent = "LoRa: SIMULATED";
      } else {
        loraTag.className = "tag-badge tag-offline";
        loraTag.textContent = "LoRa: OFFLINE";
      }
    }

    const gpsTag = document.getElementById("header-gps-tag");
    if (gpsTag) {
      if (isLiveConnected) {
        const isGpsNoFix = t.gpsFix === "NO_FIX" || t.gpsStatus === "NO_FIX" || t.gpsValid === false;
        gpsTag.className = isGpsNoFix ? "tag-badge tag-warning" : "tag-badge tag-live";
        gpsTag.textContent = isGpsNoFix ? "GPS: UNAVAILABLE" : `GPS: ${t.gpsFix || 'ACTIVE'}`;
      } else if (isMockMode) {
        gpsTag.className = "tag-badge tag-lora";
        gpsTag.textContent = "GPS: SIMULATED";
      } else {
        gpsTag.className = "tag-badge tag-warning";
        gpsTag.textContent = "GPS: LAST KNOWN";
      }
    }

    const sidebarMode = document.getElementById("sidebar-peer-mode");
    if (sidebarMode) {
      sidebarMode.textContent = isLiveConnected
        ? "LOCAL WI-FI DIRECT"
        : (isMockMode ? "MOCK SIMULATOR" : "DISCONNECTED");
    }

    const sidebarDot = document.getElementById("sidebar-status-dot");
    if (sidebarDot) {
      sidebarDot.className = isLiveConnected
        ? "status-dot status-safe"
        : (conn.status === "connecting" || conn.status === "reconnecting" ? "status-dot status-caution" : "status-dot status-offline");
    }
  };

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
  subscribe("connection", () => updateHeaderTags());

  // Subscribe to telemetry for header status tags
  subscribe("telemetry", () => updateHeaderTags());
  subscribe("lastKnownLocation", () => updateHeaderTags());

  // Subscribe to device identity for sidebar
  subscribe("device", (dev) => {
    const sidebarName = document.getElementById("sidebar-peer-name");
    if (sidebarName) sidebarName.textContent = `${dev.id} (${dev.name.replace("LOKRAKSHA ", "")})`;
  });

  // Initial sync
  updateHeaderTags();
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
      zone_name: "TCET Campus Quad Safe Zone",
      zone_type: "SAFE",
      message: "You are currently inside an authorized TCET campus safe zone.",
      distance: 145,
      recommended_action: "Normal operation. Location beacon active."
    });
    showToast("Simulated Entry: TCET SAFE ZONE", "safe");
  });

  // 2. Simulate Caution Zone
  document.getElementById("sim-caution-btn")?.addEventListener("click", () => {
    simulateEvent("GEOFENCE_ALERT", {
      zone_id: "ZONE-CAUTION-01",
      zone_name: "Thakur Village Transit Corridor",
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
      zone_name: "Western Express Highway Boundary Hazard",
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
      lat: 19.2078,
      lng: 72.8740,
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
      lat: 19.2060 + (Math.random() - 0.5) * 0.006,
      lng: 72.8746 + (Math.random() - 0.5) * 0.006,
      battery: 88,
      temperature: 30.5,
      humidity: 71
    });
    showToast(`Peer Node Discovered: ${randomId}`, "safe");
  });

  // 7. Simulate Live ESP32 Connected at New GPS coordinates
  document.getElementById("sim-gps-move-btn")?.addEventListener("click", () => {
    updateState("connection", {
      status: "connected",
      mode: "live"
    });
    simulateEvent("TELEMETRY_UPDATE", {
      device_id: appState.device.id,
      lat: 19.208500,
      lng: 72.876000,
      gps_status: "ACTIVE",
      gps_fix: "3D_FIX",
      gps_valid: true,
      battery: 92,
      temperature: 31.8,
      humidity: 70
    });
    showToast("Simulated Live ESP32: New GPS Fix (19.2085, 72.8760)", "safe");
  });

  // 8. Simulate GPS Signal Loss while connected
  document.getElementById("sim-gps-loss-btn")?.addEventListener("click", () => {
    updateState("connection", {
      status: "connected",
      mode: "live"
    });
    simulateEvent("TELEMETRY_UPDATE", {
      device_id: appState.device.id,
      gps_status: "NO_FIX",
      gps_fix: "NO_FIX",
      gps_valid: false,
      battery: 91
    });
    showToast("Simulated GPS Signal Loss (Last Known Preserved)", "caution");
  });

  // 9. Reset State
  document.getElementById("sim-reset-btn")?.addEventListener("click", () => {
    updateState("device", { ...appState.device, status: "ONLINE" });
    updateState("sosRequest", { status: "IDLE", timestamp: null, error: null });
    updateState("currentZone", {
      id: "ZONE-SAFE-01",
      name: "TCET Campus Quad Safe Zone",
      type: "SAFE",
      message: "You are currently inside an authorized TCET campus safe zone.",
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
