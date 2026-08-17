/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA State Management
 * Decentralized peer node local reactive state
 */

export const appState = {
  // Connected local physical device
  device: {
    id: "LKRK-001",
    name: "LOKRAKSHA Alpha",
    firmware: "v2.4.1-ESP32-LORA",
    status: "ONLINE", // ONLINE, WARNING, SOS, OFFLINE
    connectionType: "LOCAL_WIFI_DIRECT",
    ip: "192.168.4.1",
    publicKey: "0x4F9B...88A2",
    credentialStatus: "ACTIVE",
    isVerified: true
  },

  // Live real-time telemetry from ESP32
  telemetry: {
    battery: 84,
    batteryVoltage: 4.12,
    temperature: 31.4,
    humidity: 72,
    lat: 19.0760,
    lng: 72.8777,
    altitude: 14.2,
    hdop: 0.9,
    gpsFix: "3D_FIX",
    gpsStatus: "ACTIVE",
    loraStatus: "CONNECTED",
    loraFrequency: "868.1 MHz",
    loraRssi: -78,
    loraSnr: 9.2,
    lastUpdate: Date.now()
  },

  // Geo-fence zone state (computed on device)
  currentZone: {
    id: "ZONE-SAFE-01",
    name: "Campus Quad Safe Zone",
    type: "SAFE", // SAFE, CAUTION, RESTRICTED
    message: "You are currently inside an authorized safe zone.",
    distanceToBoundaryMeters: 145,
    recommendedAction: "Normal operation. Location beacon active."
  },

  // AI Risk Profile
  risk: {
    level: "LOW", // LOW, MEDIUM, HIGH, CRITICAL
    score: 12, // 0 - 100
    reasons: [
      "All sensors operating in nominal range",
      "Inside designated safe perimeter",
      "Stable peer heartbeat detected"
    ],
    timestamp: Date.now()
  },

  // Active & historic incidents
  incidents: [],

  // Known nearby decentralized peer nodes (NO master / central server)
  nodes: [],

  // Encrypted LoRa message queue & history
  messages: [],

  // WebSocket & physical ESP32 bridge connection status
  connection: {
    status: "disconnected", // 'connected', 'connecting', 'reconnecting', 'disconnected', 'mock_mode'
    mode: "live", // 'live' | 'mock'
    endpoint: "ws://192.168.4.1/ws",
    reconnectAttempts: 0,
    latencyMs: 18,
    lastPing: null,
    lastTelemetryTs: Date.now()
  },

  // Active UI View
  currentView: "dashboard",

  // Demo / Simulation mode active (when true and mock mode is active)
  demoMode: false,

  // Outgoing SOS Request tracking state
  sosRequest: {
    status: "IDLE", // IDLE, REQUESTING, CONFIRMED, FAILED, TIMEOUT
    timestamp: null,
    error: null
  },

  // Settings
  settings: {
    deviceName: "LOKRAKSHA Alpha",
    loraBand: "868.1 MHz",
    loraTxPower: "20 dBm",
    beaconIntervalSec: 15,
    audioAlerts: true,
    hapticFeedback: true,
    autoAcknowledgeLoRa: true,
    offlineTileSource: "local_cache"
  }
};

// Event listeners for state changes
const listeners = new Map();

/**
 * Subscribe to state changes on specific property or '*'
 * @param {string} key
 * @param {Function} callback
 */
export function subscribe(key, callback) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key).add(callback);

  return () => {
    listeners.get(key)?.delete(callback);
  };
}

/**
 * Notify subscribers of state mutation
 * @param {string} key
 * @param {any} value
 */
export function notify(key, value) {
  if (listeners.has(key)) {
    listeners.get(key).forEach((cb) => {
      try {
        cb(value, appState);
      } catch (err) {
        console.error(`[State] Error in subscriber for ${key}:`, err);
      }
    });
  }

  // Also notify wildcard subscribers
  if (listeners.has("*")) {
    listeners.get("*").forEach((cb) => {
      try {
        cb(key, value, appState);
      } catch (err) {
        console.error(`[State] Error in wildcard subscriber:`, err);
      }
    });
  }
}

/**
 * Update state safely and broadcast
 * @param {string} key
 * @param {any} partialOrValue
 */
export function updateState(key, partialOrValue) {
  if (typeof partialOrValue === "object" && !Array.isArray(partialOrValue) && partialOrValue !== null) {
    appState[key] = { ...appState[key], ...partialOrValue };
  } else {
    appState[key] = partialOrValue;
  }
  notify(key, appState[key]);
}
