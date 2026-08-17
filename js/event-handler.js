/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Event Handler
 * The central dispatcher that processes standard hardware events from WebSocket or Simulator
 */

import { appState, updateState, notify } from "./state.js";
import { saveIncident, saveMessage, saveNode, saveTelemetry } from "./storage.js";
import { clearSosRequestTimeout } from "./websocket.js";

/**
 * Handle incoming standard LOKRAKSHA protocol event
 * @param {Object} eventPayload
 * @param {string} eventPayload.event
 * @param {number} eventPayload.timestamp
 * @param {Object} eventPayload.data
 */
export async function handleEvent(eventPayload) {
  if (!eventPayload || !eventPayload.event) {
    console.warn("[EventHandler] Invalid event received:", eventPayload);
    return;
  }

  const { event, timestamp = Date.now(), data = {} } = eventPayload;
  console.log(`[EventHandler] Processing ${event}:`, data);

  switch (event) {
    case "TELEMETRY_UPDATE":
      await handleTelemetryUpdate(data, timestamp);
      break;

    case "GEOFENCE_ALERT":
      await handleGeofenceAlert(data, timestamp);
      break;

    case "RISK_UPDATE":
      await handleRiskUpdate(data, timestamp);
      break;

    case "SOS_RECEIVED":
      await handleSosReceived(data, timestamp);
      break;

    case "MESSAGE_RECEIVED":
      await handleMessageReceived(data, timestamp);
      break;

    case "MESSAGE_STATUS":
      handleMessageStatus(data, timestamp);
      break;

    case "NODE_JOINED":
    case "NODE_UPDATED":
      await handleNodeUpdate(data, timestamp);
      break;

    case "NODE_LEFT":
      handleNodeLeft(data, timestamp);
      break;

    default:
      console.warn(`[EventHandler] Unrecognized event: ${event}`);
  }

  // Notify generic event listener
  notify("event_processed", { event, timestamp, data });
}

// ----------------- Event Handlers -----------------

async function handleTelemetryUpdate(data, timestamp) {
  if (!data || typeof data !== "object") return;

  // Normalize timestamp (handle Unix epoch seconds vs milliseconds)
  const normalizedTs = (typeof timestamp === "number" && timestamp < 10000000000)
    ? timestamp * 1000
    : (timestamp || Date.now());

  // 1. Synchronize Device ID & Identity if provided in envelope
  const deviceId = data.device_id || data.deviceId || data.id;
  if (deviceId && deviceId !== appState.device.id) {
    updateState("device", {
      ...appState.device,
      id: deviceId,
      name: data.device_name || appState.device.name || `LOKRAKSHA ${deviceId}`
    });
  }

  // 2. Normalize telemetry values supporting snake_case and camelCase
  const batteryVal = data.battery !== undefined ? Number(data.battery) : appState.telemetry.battery;
  const batteryVolt = data.battery_voltage !== undefined
    ? Number(data.battery_voltage)
    : (data.batteryVoltage !== undefined ? Number(data.batteryVoltage) : +(3.3 + (batteryVal / 100) * 0.9).toFixed(2));

  const gpsStatusVal = data.gps_status || data.gpsStatus || appState.telemetry.gpsStatus || "ACTIVE";
  const gpsFixVal = data.gps_fix || data.gpsFix || (gpsStatusVal === "ACTIVE" ? "3D_FIX" : appState.telemetry.gpsFix);
  const loraStatusVal = data.lora_status || data.loraStatus || appState.telemetry.loraStatus || "CONNECTED";

  const updatedTelemetry = {
    ...appState.telemetry,
    battery: batteryVal,
    batteryVoltage: batteryVolt,
    temperature: data.temperature !== undefined ? Number(data.temperature) : appState.telemetry.temperature,
    humidity: data.humidity !== undefined ? Number(data.humidity) : appState.telemetry.humidity,
    gpsStatus: gpsStatusVal,
    gpsFix: gpsFixVal,
    loraStatus: loraStatusVal,
    lat: data.lat !== undefined ? Number(data.lat) : appState.telemetry.lat,
    lng: data.lng !== undefined ? Number(data.lng) : appState.telemetry.lng,
    altitude: data.altitude !== undefined ? Number(data.altitude) : appState.telemetry.altitude,
    hdop: data.hdop !== undefined ? Number(data.hdop) : appState.telemetry.hdop,
    loraRssi: data.lora_rssi !== undefined ? Number(data.lora_rssi) : (data.loraRssi !== undefined ? Number(data.loraRssi) : appState.telemetry.loraRssi),
    loraSnr: data.lora_snr !== undefined ? Number(data.lora_snr) : (data.loraSnr !== undefined ? Number(data.loraSnr) : appState.telemetry.loraSnr),
    lastUpdate: normalizedTs
  };

  updateState("telemetry", updatedTelemetry);
  updateState("connection", {
    lastTelemetryTs: normalizedTs,
    lastPing: Date.now()
  });

  await saveTelemetry(updatedTelemetry);
}

async function handleGeofenceAlert(data, timestamp) {
  const zoneType = data.zone_type || data.type || "SAFE";
  const zoneName = data.zone_name || data.name || "Perimeter Area";
  const message = data.message || (
    zoneType === "SAFE" ? "You are currently inside an authorized safe zone." :
    zoneType === "CAUTION" ? "Exercise increased awareness in this zone." :
    "Safety warning triggered: Prohibited restricted boundary breached."
  );

  const newZone = {
    id: data.zone_id || "ZONE-" + zoneType,
    name: zoneName,
    type: zoneType,
    message: message,
    distanceToBoundaryMeters: data.distance || 0,
    recommendedAction: data.recommended_action || (
      zoneType === "SAFE" ? "Normal peer beacon operation." :
      zoneType === "CAUTION" ? "Maintain close radio contact with nearby peers." :
      "Immediate exit recommended. Distress alert broadcast prepared."
    )
  };

  updateState("currentZone", newZone);

  // If entering restricted zone and not already high risk, escalate risk
  if (zoneType === "RESTRICTED" && appState.risk.level !== "CRITICAL") {
    await handleRiskUpdate({
      level: "HIGH",
      score: 78,
      reasons: [
        "Restricted zone boundary breached",
        "Elevated perimeter hazard profile",
        "LoRa beacon high-frequency burst"
      ]
    }, timestamp);
  } else if (zoneType === "CAUTION" && appState.risk.level === "LOW") {
    await handleRiskUpdate({
      level: "MEDIUM",
      score: 45,
      reasons: [
        "Entered caution corridor",
        "Reduced line-of-sight visibility",
        "Peer telemetry ping active"
      ]
    }, timestamp);
  } else if (zoneType === "SAFE" && appState.risk.level === "MEDIUM") {
    await handleRiskUpdate({
      level: "LOW",
      score: 12,
      reasons: [
        "Inside designated safe perimeter",
        "Stable peer heartbeat detected",
        "Sensors nominal"
      ]
    }, timestamp);
  }
}

async function handleRiskUpdate(data, timestamp) {
  const newRisk = {
    level: data.level || "LOW",
    score: data.score !== undefined ? data.score : 15,
    reasons: data.reasons || ["Routine telemetry nominal"],
    timestamp: timestamp
  };

  updateState("risk", newRisk);
}

async function handleSosReceived(data, timestamp) {
  if (!data || typeof data !== "object") {
    console.warn("[EventHandler] Malformed SOS_RECEIVED payload:", data);
    data = {};
  }

  const sourceId = data.device_id || data.id || "LKRK-001";
  const isLocalDevice = sourceId === appState.device.id;
  const lat = typeof data.lat === "number" && isFinite(data.lat) ? data.lat : (isLocalDevice ? appState.telemetry.lat : 19.0760);
  const lng = typeof data.lng === "number" && isFinite(data.lng) ? data.lng : (isLocalDevice ? appState.telemetry.lng : 72.8777);

  // 1. Confirm SOS Request state if this was from local device
  if (isLocalDevice) {
    clearSosRequestTimeout();
    updateState("sosRequest", {
      status: "CONFIRMED",
      timestamp: timestamp,
      error: null
    });
  }

  // 2. Escalate Risk to CRITICAL
  await handleRiskUpdate({
    level: "CRITICAL",
    score: 95,
    reasons: [
      `Emergency SOS signal triggered (${sourceId})`,
      "Autonomous distress beacon broadcasting on LoRa 868.1 MHz",
      "Real-time GPS coordinate lock broadcast to all nearby peers",
      "Immediate peer response required"
    ]
  }, timestamp);

  // 3. Update local device or peer node status
  if (isLocalDevice) {
    updateState("device", { ...appState.device, status: "SOS" });
  } else {
    // Update peer in nodes list
    const updatedNodes = appState.nodes.map(n => {
      if (n.id === sourceId) {
        return { ...n, status: "SOS", isSos: true, riskState: "CRITICAL", lastSeen: timestamp };
      }
      return n;
    });
    updateState("nodes", updatedNodes);
    const targetNode = updatedNodes.find(n => n.id === sourceId);
    if (targetNode) await saveNode(targetNode);
  }

  // 4. Create active Incident in state & IndexedDB
  const newIncident = {
    id: "INC-" + Date.now().toString().slice(-6),
    sourceDevice: sourceId,
    sourceName: isLocalDevice ? appState.device.name : (data.device_name || `Peer ${sourceId}`),
    type: data.incident_type || "SOS",
    title: `Emergency Distress Broadcast (${sourceId})`,
    lat: lat,
    lng: lng,
    zone: appState.currentZone.name,
    temperature: data.temperature || appState.telemetry.temperature,
    humidity: data.humidity || appState.telemetry.humidity,
    battery: data.battery || appState.telemetry.battery,
    riskLevel: "CRITICAL",
    riskScore: 95,
    timestamp: timestamp,
    status: "ACTIVE",
    timeline: [
      { stage: "INCIDENT DETECTED", time: timestamp, completed: true },
      { stage: "RISK ASSESSED", time: timestamp + 200, completed: true },
      { stage: "ALERT GENERATED", time: timestamp + 400, completed: true },
      { stage: "PEER NETWORK NOTIFIED", time: timestamp + 800, completed: true },
      { stage: "RESPONSE", time: 0, completed: false }
    ]
  };

  const incidents = [newIncident, ...appState.incidents.filter(i => i.id !== newIncident.id)];
  updateState("incidents", incidents);
  await saveIncident(newIncident);

  // 5. Create an automated SOS system message
  const sosMessage = {
    id: "msg_sos_" + timestamp,
    from: sourceId,
    to: "BROADCAST",
    type: "SOS",
    text: `⚠️ [EMERGENCY DISTRESS BEACON] Active SOS from ${sourceId} at (${lat.toFixed(4)}, ${lng.toFixed(4)}). Risk: CRITICAL.`,
    priority: "SOS",
    timestamp: timestamp,
    status: "DELIVERED"
  };

  const messages = [...appState.messages, sosMessage];
  updateState("messages", messages);
  await saveMessage(sosMessage);

  // 6. Trigger audio / visual alert in browser
  playAlertTone("sos");
  showEmergencyAlertBanner(`ACTIVE SOS ALERT: Distress beacon emitted by ${sourceId}`);
}

async function handleMessageReceived(data, timestamp) {
  const newMsg = {
    id: data.id || "msg_" + timestamp + "_" + Math.random().toString(36).substr(2, 5),
    from: data.from || "LKRK-UNKNOWN",
    to: data.to || "BROADCAST",
    type: data.type || (data.to === "BROADCAST" ? "BROADCAST" : "DIRECT"),
    text: data.text || data.message || "",
    priority: data.priority || "NORMAL",
    timestamp: timestamp,
    status: "DELIVERED"
  };

  const updatedMessages = [...appState.messages, newMsg];
  updateState("messages", updatedMessages);
  await saveMessage(newMsg);

  if (newMsg.priority === "SOS" || newMsg.type === "SOS") {
    playAlertTone("warning");
  }
}

function handleMessageStatus(data, timestamp) {
  const { id, status } = data;
  const updatedMessages = appState.messages.map(m => {
    if (m.id === id) {
      return { ...m, status: status };
    }
    return m;
  });
  updateState("messages", updatedMessages);
}

async function handleNodeUpdate(data, timestamp) {
  const nodeId = data.id || data.device_id;
  if (!nodeId) return;

  const existingIndex = appState.nodes.findIndex(n => n.id === nodeId);
  let updatedNode;

  if (existingIndex >= 0) {
    updatedNode = {
      ...appState.nodes[existingIndex],
      ...data,
      lastSeen: timestamp
    };
    const nodes = [...appState.nodes];
    nodes[existingIndex] = updatedNode;
    updateState("nodes", nodes);
  } else {
    updatedNode = {
      id: nodeId,
      name: data.name || `Peer ${nodeId}`,
      status: data.status || "ONLINE",
      riskState: data.risk || "LOW",
      isSos: data.isSos || false,
      rssi: data.rssi || -75,
      snr: data.snr || 8.0,
      battery: data.battery || 80,
      lat: data.lat || 19.0760,
      lng: data.lng || 72.8777,
      temperature: data.temperature || 31.0,
      humidity: data.humidity || 70,
      lastSeen: timestamp,
      locationSharing: true,
      publicKey: data.publicKey || "0x98A1...43F1"
    };
    updateState("nodes", [...appState.nodes, updatedNode]);
  }

  await saveNode(updatedNode);
}

function handleNodeLeft(data, timestamp) {
  const nodeId = data.id || data.device_id;
  const updatedNodes = appState.nodes.map(n => {
    if (n.id === nodeId) {
      return { ...n, status: "OFFLINE", lastSeen: timestamp };
    }
    return n;
  });
  updateState("nodes", updatedNodes);
}

// ----------------- Helpers -----------------

function playAlertTone(type = "warning") {
  if (!appState.settings.audioAlerts) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "sos") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    }
  } catch (err) {
    // AudioContext blocked by browser policy until gesture
  }
}

function showEmergencyAlertBanner(text) {
  const banner = document.getElementById("emergency-banner");
  const bannerText = document.getElementById("emergency-banner-text");
  if (banner && bannerText) {
    bannerText.textContent = text;
    banner.classList.add("visible");
  }
}
