/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA WebSocket Client & ESP32 Hardware Bridge Interface
 * Direct local connection to physical ESP32 Access Point (ws://192.168.4.1/ws)
 * with robust auto-reconnection and distinct Mock Simulator fallback.
 */

import { appState, updateState } from "./state.js";
import { handleEvent } from "./event-handler.js";

// Configurable constants
export const DEFAULT_ESP32_WS_URL = "ws://192.168.4.1/ws";
export const RECONNECT_DELAY = 3000;
export const CONNECTION_TIMEOUT = 5000;
export const TELEMETRY_TIMEOUT = 10000;
export const MOCK_INTERVAL_MS = 3000;

// Aliases for backwards-compatibility
export const RECONNECT_INTERVAL_MS = RECONNECT_DELAY;
export const CONNECTION_TIMEOUT_MS = CONNECTION_TIMEOUT;
export const TELEMETRY_TIMEOUT_MS = TELEMETRY_TIMEOUT;

let socket = null;
let reconnectTimer = null;
let connectionTimeoutTimer = null;
let telemetryTimeoutTimer = null;
let mockInterval = null;
let isExplicitDisconnect = true; // Initial state is disconnected until explicitly connected
let reconnectAttempts = 0;
let sosTimeoutTimer = null;
let activeTargetUrl = DEFAULT_ESP32_WS_URL;

/**
 * Set connection state and notify subscribers
 * @param {string} status - 'disconnected' | 'connecting' | 'connected' | 'mock_mode'
 * @param {Object} extraProps
 */
export function setConnectionState(status, extraProps = {}) {
  updateState("connection", {
    status: status,
    ...extraProps
  });
}

/**
 * Initialize local WebSocket manager (starts in clean DISCONNECTED state on fresh load)
 * @param {string} url - e.g. "ws://192.168.4.1/ws"
 */
export function initWebSocket(url = DEFAULT_ESP32_WS_URL) {
  activeTargetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : DEFAULT_ESP32_WS_URL;
  isExplicitDisconnect = true;
  reconnectAttempts = 0;

  clearAllTimers();
  cleanupSocket();

  setConnectionState("disconnected", {
    mode: "live",
    endpoint: activeTargetUrl,
    reconnectAttempts: 0
  });

  console.log(`[ESP32 WS] Initialized connection manager in DISCONNECTED state (${activeTargetUrl})`);
}

/**
 * Connect directly to the physical ESP32 Access Point over WebSocket
 * @param {string} url - Target WebSocket URL (default: ws://192.168.4.1/ws)
 */
export function connectESP32(url = DEFAULT_ESP32_WS_URL) {
  const targetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : (activeTargetUrl || DEFAULT_ESP32_WS_URL);
  activeTargetUrl = targetUrl;
  isExplicitDisconnect = false;

  stopMockTelemetryEngine();
  clearAllTimers();
  cleanupSocket();

  setConnectionState("connecting", {
    mode: "live",
    endpoint: targetUrl,
    reconnectAttempts: reconnectAttempts
  });

  console.log(`[ESP32 WS] Connecting to ${targetUrl} (Attempt: ${reconnectAttempts + 1})...`);

  try {
    const currentSocket = new WebSocket(targetUrl);
    socket = currentSocket;

    // Start connection timeout watchdog (5000ms)
    startConnectionTimeout(targetUrl, currentSocket);

    currentSocket.onopen = (event) => {
      if (socket !== currentSocket) return;
      handleWebSocketOpen(event, targetUrl);
    };

    currentSocket.onmessage = (event) => {
      if (socket !== currentSocket) return;
      handleWebSocketMessage(event);
    };

    currentSocket.onerror = (err) => {
      if (socket !== currentSocket) return;
      handleWebSocketError(err, targetUrl);
    };

    currentSocket.onclose = (event) => {
      if (socket !== currentSocket && socket !== null) return;
      handleWebSocketClose(event, targetUrl);
    };
  } catch (err) {
    console.error("[ESP32 WS] Failed to instantiate WebSocket:", err);
    handleWebSocketClose({ code: 1006, reason: "Instantiation Error" }, targetUrl);
  }
}

// Alias with camelCase
export const connectEsp32 = connectESP32;

/**
 * Handle successful WebSocket open event
 * @param {Event} event
 * @param {string} targetUrl
 */
export function handleWebSocketOpen(event, targetUrl) {
  console.log(`[ESP32 WS] Successfully connected to physical LOKRAKSHA ESP32 at ${targetUrl}`);
  clearConnectionTimeout();
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopMockTelemetryEngine();

  setConnectionState("connected", {
    mode: "live",
    endpoint: targetUrl,
    reconnectAttempts: 0,
    lastPing: Date.now()
  });

  updateState("device", {
    ...appState.device,
    status: appState.device.status === "SOS" ? "SOS" : "ONLINE"
  });

  // Start telemetry freshness watchdog (10000ms)
  startTelemetryTimeout();
}

/**
 * Handle incoming WebSocket message
 * @param {MessageEvent} event
 */
export function handleWebSocketMessage(event) {
  try {
    const payload = JSON.parse(event.data);
    updateState("connection", {
      lastPing: Date.now()
    });
    handleEvent(payload);
  } catch (err) {
    console.error("[ESP32 WS] Failed to parse JSON message envelope:", event.data, err);
  }
}

/**
 * Handle WebSocket error event
 * @param {Event} err
 * @param {string} targetUrl
 */
export function handleWebSocketError(err, targetUrl) {
  console.warn(`[ESP32 WS] Connection error on ${targetUrl}:`, err);
  // Note: onclose will follow onerror in standard WebSocket lifecycle
}

/**
 * Handle WebSocket close event
 * @param {CloseEvent|Object} event
 * @param {string} targetUrl
 */
export function handleWebSocketClose(event, targetUrl) {
  console.log(`[ESP32 WS] Socket closed (code: ${event?.code}, reason: ${event?.reason || "none"}).`);

  clearConnectionTimeout();
  clearTelemetryTimeout();
  cleanupSocket();

  // If user explicitly switched to mock mode or explicitly disconnected, do not reconnect
  if (isExplicitDisconnect || appState.connection.mode !== "live") {
    setConnectionState("disconnected", {
      mode: appState.connection.mode,
      endpoint: targetUrl,
      reconnectAttempts: 0
    });
    return;
  }

  // Set state immediately to DISCONNECTED
  reconnectAttempts++;
  setConnectionState("disconnected", {
    mode: "live",
    endpoint: targetUrl,
    reconnectAttempts: reconnectAttempts
  });

  // Mark device as OFFLINE if it wasn't in active SOS
  if (appState.device.status !== "SOS") {
    updateState("device", {
      ...appState.device,
      status: "OFFLINE"
    });
  }

  // Schedule automatic reconnection after delay
  scheduleReconnect(targetUrl);
}

/**
 * Schedule automatic reconnection attempt (State stays DISCONNECTED during delay)
 * @param {string} url
 */
export function scheduleReconnect(url = activeTargetUrl) {
  const targetUrl = (typeof url === "string" && url.startsWith("ws")) ? url : (activeTargetUrl || DEFAULT_ESP32_WS_URL);
  if (reconnectTimer || isExplicitDisconnect || appState.connection.mode !== "live") return;

  console.log(`[ESP32 WS] Scheduling automatic reconnection in ${RECONNECT_DELAY / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isExplicitDisconnect && appState.connection.mode === "live") {
      connectESP32(targetUrl);
    }
  }, RECONNECT_DELAY);
}

/**
 * Start connection timeout timer (5000ms)
 * @param {string} targetUrl
 * @param {WebSocket} targetSocket
 */
export function startConnectionTimeout(targetUrl, targetSocket) {
  clearConnectionTimeout();
  connectionTimeoutTimer = setTimeout(() => {
    if (socket === targetSocket && socket.readyState === WebSocket.CONNECTING) {
      console.warn(`[ESP32 WS] Connection attempt to ${targetUrl} timed out after ${CONNECTION_TIMEOUT}ms`);
      cleanupSocket();
      handleWebSocketClose({ code: 4008, reason: "Connection Timeout" }, targetUrl);
    }
  }, CONNECTION_TIMEOUT);
}

/**
 * Clear connection timeout timer
 */
export function clearConnectionTimeout() {
  if (connectionTimeoutTimer) {
    clearTimeout(connectionTimeoutTimer);
    connectionTimeoutTimer = null;
  }
}

/**
 * Start or restart telemetry freshness watchdog (10000ms)
 */
export function startTelemetryTimeout() {
  clearTelemetryTimeout();
  telemetryTimeoutTimer = setTimeout(() => {
    if (appState.connection.status === "connected" && appState.connection.mode === "live") {
      console.warn(`[ESP32 WS] Telemetry timeout: No TELEMETRY_UPDATE received for ${TELEMETRY_TIMEOUT / 1000}s. Marking device as unreachable.`);
      if (socket) {
        try {
          socket.close(4000, "Telemetry timeout / Device unreachable");
        } catch (e) {}
      } else {
        handleWebSocketClose({ code: 4000, reason: "Telemetry timeout" }, activeTargetUrl);
      }
    }
  }, TELEMETRY_TIMEOUT);
}

/**
 * Reset telemetry timeout watchdog upon receiving valid TELEMETRY_UPDATE
 */
export function resetTelemetryTimeout() {
  if (appState.connection.status === "connected" && appState.connection.mode === "live") {
    startTelemetryTimeout();
  }
}

/**
 * Clear telemetry timeout watchdog
 */
export function clearTelemetryTimeout() {
  if (telemetryTimeoutTimer) {
    clearTimeout(telemetryTimeoutTimer);
    telemetryTimeoutTimer = null;
  }
}

/**
 * Explicitly disconnect from the physical ESP32 and stop auto-reconnect
 */
export function disconnectESP32() {
  console.log("[ESP32 WS] User triggered explicit disconnect.");
  isExplicitDisconnect = true;
  reconnectAttempts = 0;

  clearAllTimers();
  cleanupSocket();

  setConnectionState("disconnected", {
    mode: "live",
    reconnectAttempts: 0
  });

  if (appState.device.status !== "SOS") {
    updateState("device", {
      ...appState.device,
      status: "OFFLINE"
    });
  }
}

// Alias with camelCase
export const disconnectEsp32 = disconnectESP32;

/**
 * Toggle ESP32 connection state
 * @param {string} url
 */
export function toggleESP32Connection(url = DEFAULT_ESP32_WS_URL) {
  if (appState.connection.status === "connected") {
    disconnectESP32();
  } else {
    connectESP32(url);
  }
}

// Alias with camelCase
export const toggleEsp32Connection = toggleESP32Connection;

/**
 * Helper to close and cleanup socket instance
 */
function cleanupSocket() {
  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    } catch (e) {}
    socket = null;
  }
}

/**
 * Helper to clear all scheduled timers
 */
function clearAllTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearConnectionTimeout();
  clearTelemetryTimeout();
}

/**
 * Switch from Live ESP32 mode to offline Mock Simulator mode
 */
export function switchToMockMode() {
  console.log("[ESP32 WS] Switching to Mock Simulator mode.");
  isExplicitDisconnect = true;
  reconnectAttempts = 0;

  clearAllTimers();
  cleanupSocket();

  setConnectionState("mock_mode", {
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
  connectESP32(targetUrl);
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

if (typeof window !== "undefined") {
  window.simulateEvent = simulateEvent;
  window.appState = appState;
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
