/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA WebSocket Client & ESP32 Hardware Bridge Interface
 * Direct local connection to physical ESP32 Access Point (ws://192.168.4.1/ws)
 * with robust auto-reconnection and distinct Mock Simulator fallback.
 */

import { appState, updateState } from "./state.js";
import { handleEvent } from "./event-handler.js";

export const DEFAULT_ESP32_WS_URL = "ws://192.168.4.1/ws";
const RECONNECT_INTERVAL_MS = 3000;
const MOCK_INTERVAL_MS = 3000;

let socket = null;
let reconnectTimer = null;
let mockInterval = null;
let isExplicitDisconnect = false;
let reconnectAttempts = 0;
let sosTimeoutTimer = null;

/**
 * Initialize local WebSocket connection to physical LOKRAKSHA ESP32
 * @param {string} url - e.g. "ws://192.168.4.1/ws"
 */
export function initWebSocket(url = DEFAULT_ESP32_WS_URL) {
  return connectEsp32(url);
}

/**
 * Connect directly to the physical ESP32 Access Point over WebSocket
 * @param {string} url - Target WebSocket URL (default: ws://192.168.4.1/ws)
 */
export function connectEsp32(url = DEFAULT_ESP32_WS_URL) {
  const targetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : DEFAULT_ESP32_WS_URL;
  isExplicitDisconnect = false;
  stopMockTelemetryEngine();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (e) {
      // Ignore close errors on stale socket
    }
    socket = null;
  }

  updateState("connection", {
    status: reconnectAttempts > 0 ? "reconnecting" : "connecting",
    mode: "live",
    endpoint: targetUrl,
    reconnectAttempts: reconnectAttempts
  });

  try {
    console.log(`[ESP32 WS] Connecting to ${targetUrl} (Attempt: ${reconnectAttempts + 1})...`);
    const currentSocket = new WebSocket(targetUrl);
    socket = currentSocket;

    currentSocket.onopen = () => {
      if (socket !== currentSocket) return;
      console.log(`[ESP32 WS] Successfully connected to physical LOKRAKSHA ESP32 at ${targetUrl}`);
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopMockTelemetryEngine();

      updateState("connection", {
        status: "connected",
        mode: "live",
        endpoint: targetUrl,
        reconnectAttempts: 0,
        lastPing: Date.now()
      });

      updateState("device", {
        ...appState.device,
        status: appState.device.status === "SOS" ? "SOS" : "ONLINE"
      });
    };

    currentSocket.onmessage = (event) => {
      if (socket !== currentSocket) return;
      try {
        const payload = JSON.parse(event.data);
        updateState("connection", {
          lastPing: Date.now()
        });
        handleEvent(payload);
      } catch (err) {
        console.error("[ESP32 WS] Failed to parse JSON message envelope:", event.data, err);
      }
    };

    currentSocket.onerror = (err) => {
      if (socket !== currentSocket) return;
      console.warn(`[ESP32 WS] Connection error on ${targetUrl}:`, err);
    };

    currentSocket.onclose = (event) => {
      console.log(`[ESP32 WS] Socket closed (code: ${event.code}, reason: ${event.reason || "none"}).`);
      if (socket === currentSocket) {
        socket = null;
      }

      // If user switched to mock mode, disconnected, or socket is superseded, ignore
      if (isExplicitDisconnect || appState.connection.mode !== "live" || socket !== null) {
        return;
      }

      reconnectAttempts++;
      updateState("connection", {
        status: "reconnecting",
        mode: "live",
        endpoint: targetUrl,
        reconnectAttempts: reconnectAttempts
      });
      scheduleAutoReconnect(targetUrl);
    };
  } catch (err) {
    console.error("[ESP32 WS] Initialization error:", err);
    if (!isExplicitDisconnect && appState.connection.mode === "live") {
      reconnectAttempts++;
      updateState("connection", {
        status: "reconnecting",
        mode: "live",
        endpoint: targetUrl,
        reconnectAttempts: reconnectAttempts
      });
      scheduleAutoReconnect(targetUrl);
    }
  }
}

/**
 * Schedule automatic reconnection attempt
 * @param {string} url
 */
function scheduleAutoReconnect(url = DEFAULT_ESP32_WS_URL) {
  const targetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : DEFAULT_ESP32_WS_URL;
  if (reconnectTimer || isExplicitDisconnect || appState.connection.mode !== "live") return;

  console.log(`[ESP32 WS] Scheduling automatic reconnection in ${RECONNECT_INTERVAL_MS / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isExplicitDisconnect && appState.connection.mode === "live") {
      connectEsp32(targetUrl);
    }
  }, RECONNECT_INTERVAL_MS);
}

/**
 * Explicitly disconnect from the physical ESP32 and stop auto-reconnect
 */
export function disconnectEsp32() {
  console.log("[ESP32 WS] User triggered explicit disconnect.");
  isExplicitDisconnect = true;
  reconnectAttempts = 0;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (e) {}
    socket = null;
  }

  updateState("connection", {
    status: "disconnected",
    mode: "live",
    reconnectAttempts: 0
  });
}

/**
 * Toggle ESP32 connection state
 * @param {string} url
 */
export function toggleEsp32Connection(url = DEFAULT_ESP32_WS_URL) {
  if (appState.connection.status === "connected") {
    disconnectEsp32();
  } else {
    connectEsp32(url);
  }
}

/**
 * Switch from Live ESP32 mode to offline Mock Simulator mode
 */
export function switchToMockMode() {
  console.log("[ESP32 WS] Switching to Mock Simulator mode.");
  isExplicitDisconnect = true;
  reconnectAttempts = 0;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (e) {}
    socket = null;
  }

  updateState("connection", {
    status: "mock_mode",
    mode: "mock",
    endpoint: "LOCAL_SIMULATOR",
    reconnectAttempts: 0
  });

  updateState("demoMode", true);
  startMockTelemetryEngine();
}

/**
 * Switch from Mock Simulator mode to Live physical ESP32 mode
 * @param {string} url
 */
export function switchToLiveMode(url = DEFAULT_ESP32_WS_URL) {
  console.log("[ESP32 WS] Switching to Live ESP32 mode.");
  const targetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : DEFAULT_ESP32_WS_URL;
  stopMockTelemetryEngine();
  updateState("demoMode", false);
  connectEsp32(targetUrl);
}

/**
 * Send outgoing command/message to local ESP32
 * @param {string} eventName
 * @param {Object} data
 */
export function sendWebSocketMessage(eventName, data = {}) {
  const payload = {
    event: eventName,
    timestamp: Math.floor(Date.now() / 1000),
    data: data
  };

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  } else {
    console.log("[WebSocket Outgoing (Local/Mock)]:", payload);
  }

  return payload;
}

/**
 * Send an SOS_REQUEST from the browser dashboard to the LOKRAKSHA ESP32 hardware
 * Follows the proper request-response lifecycle:
 * Dashboard (SOS_REQUEST) -> ESP32 / Demo ESP32 -> LoRa / Network -> Dashboard (SOS_RECEIVED)
 * @param {string} deviceId
 * @returns {Promise<Object>}
 */
export async function sendSosRequest(deviceId = appState.device.id) {
  const timestamp = Date.now();
  const payload = {
    event: "SOS_REQUEST",
    timestamp: Math.floor(timestamp / 1000),
    data: {
      device_id: deviceId,
      source: "WEB_DASHBOARD"
    }
  };

  console.log("[WebSocket] Dispatching SOS_REQUEST:", payload);

  if (sosTimeoutTimer) {
    clearTimeout(sosTimeoutTimer);
    sosTimeoutTimer = null;
  }

  // 1. Check if real WebSocket connection is active
  if (socket && socket.readyState === WebSocket.OPEN) {
    updateState("sosRequest", {
      status: "REQUESTING",
      timestamp: timestamp,
      error: null
    });

    socket.send(JSON.stringify(payload));

    // Setup an 8000ms response timeout for real hardware mode
    sosTimeoutTimer = setTimeout(() => {
      if (appState.sosRequest.status === "REQUESTING") {
        console.warn("[WebSocket] Timeout waiting for SOS_RECEIVED confirmation from hardware.");
        updateState("sosRequest", {
          status: "TIMEOUT",
          timestamp: Date.now(),
          error: "NO CONFIRMATION RECEIVED"
        });
      }
    }, 8000);

    return { success: true, mode: "REAL_HARDWARE", payload };
  }

  // 2. Demo Mode simulation (or mock fallback when demoMode is active)
  if (appState.demoMode || appState.connection.status === "mock_mode") {
    updateState("sosRequest", {
      status: "REQUESTING",
      timestamp: timestamp,
      error: null
    });

    console.log("[WebSocket Demo] Simulating ESP32 processing SOS_REQUEST (750ms response delay)...");

    // Simulate realistic hardware processing delay (750ms)
    setTimeout(() => {
      if (appState.sosRequest.status === "REQUESTING") {
        console.log("[WebSocket Demo] Simulated ESP32 emitting confirmed SOS_RECEIVED!");

        const responsePayload = {
          event: "SOS_RECEIVED",
          timestamp: Math.floor(Date.now() / 1000),
          data: {
            device_id: deviceId,
            device_name: appState.device.name,
            lat: appState.telemetry.lat,
            lng: appState.telemetry.lng,
            risk: "CRITICAL",
            source: "LOCAL_DEVICE",
            temperature: appState.telemetry.temperature,
            humidity: appState.telemetry.humidity,
            battery: appState.telemetry.battery
          }
        };

        handleEvent(responsePayload);
      }
    }, 750);

    return { success: true, mode: "DEMO_SIMULATION", payload };
  }

  // 3. Real mode but WebSocket is disconnected
  console.warn("[WebSocket] Cannot send SOS_REQUEST: Local ESP32 is disconnected.");
  updateState("sosRequest", {
    status: "FAILED",
    timestamp: timestamp,
    error: "ESP32 DISCONNECTED"
  });

  return { success: false, mode: "OFFLINE", error: "ESP32 DISCONNECTED" };
}

export function clearSosRequestTimeout() {
  if (sosTimeoutTimer) {
    clearTimeout(sosTimeoutTimer);
    sosTimeoutTimer = null;
  }
}

/**
 * Direct simulator trigger - feeds directly into the EXACT same event-handling pipeline
 * @param {string} eventName
 * @param {Object} data
 */
export function simulateEvent(eventName, data = {}) {
  const payload = {
    event: eventName,
    timestamp: Math.floor(Date.now() / 1000),
    data: data
  };
  return handleEvent(payload);
}

/**
 * Background realistic telemetry jitter generator for offline prototype demonstration
 */
export function startMockTelemetryEngine() {
  if (mockInterval) return;

  console.log("[ESP32 WS] Starting Mock Telemetry Engine.");
  mockInterval = setInterval(() => {
    // Only generate gentle sensor jitter if no active SOS
    if (appState.device.status === "SOS") return;

    const cur = appState.telemetry;
    const tempDelta = (Math.random() - 0.5) * 0.2;
    const humDelta = (Math.random() - 0.5) * 0.4;
    const latDelta = (Math.random() - 0.5) * 0.00003;
    const lngDelta = (Math.random() - 0.5) * 0.00003;

    simulateEvent("TELEMETRY_UPDATE", {
      device_id: appState.device.id,
      temperature: +(cur.temperature + tempDelta).toFixed(1),
      humidity: Math.min(100, Math.max(20, +(cur.humidity + humDelta).toFixed(0))),
      battery: cur.battery,
      battery_voltage: cur.batteryVoltage,
      gps_status: cur.gpsStatus || "ACTIVE",
      lora_status: cur.loraStatus || "CONNECTED",
      lat: +(cur.lat + latDelta).toFixed(6),
      lng: +(cur.lng + lngDelta).toFixed(6),
      lora_rssi: Math.min(-65, Math.max(-95, cur.loraRssi + Math.floor((Math.random() - 0.5) * 3)))
    });
  }, MOCK_INTERVAL_MS);
}

/**
 * Stop mock telemetry generator
 */
export function stopMockTelemetryEngine() {
  if (mockInterval) {
    console.log("[ESP32 WS] Stopping Mock Telemetry Engine.");
    clearInterval(mockInterval);
    mockInterval = null;
  }
}
