import { appState, subscribe, updateState } from "./state.js";
import { connectEsp32, disconnectEsp32, toggleEsp32Connection, switchToMockMode, switchToLiveMode, sendSosRequest } from "./websocket.js";
import { showToast } from "./app.js";

let sosHoldTimer = null;
let sosHoldProgress = 0;
let sosInterval = null;
let relativeTimeTicker = null;
const HOLD_DURATION_MS = 2500;

/**
 * Initialize Dashboard DOM interactions and state listeners
 */
export function initDashboard() {
  const container = document.getElementById("view-dashboard");
  if (!container) return;

  renderDashboard();
  updateDashboardConnection();
  updateDashboardTelemetry();

  // Subscribe to reactive state changes
  subscribe("telemetry", () => updateDashboardTelemetry());
  subscribe("device", () => {
    updateDashboardDevice();
    updateDashboardSosButton();
  });
  subscribe("connection", () => updateDashboardConnection());
  subscribe("sosRequest", () => updateDashboardSosButton());
  subscribe("currentZone", () => updateDashboardZone());
  subscribe("risk", () => updateDashboardRisk());
  subscribe("incidents", () => updateDashboardIncidents());
  subscribe("nodes", () => updateDashboardNodes());

  setupSosButton();
  setupEspControls();

  // Relative timestamp live ticker (runs every 1 second)
  if (relativeTimeTicker) clearInterval(relativeTimeTicker);
  relativeTimeTicker = setInterval(updateRelativeTimestamp, 1000);
}

/**
 * Render initial Dashboard HTML structure
 */
export function renderDashboard() {
  const container = document.getElementById("view-dashboard");
  if (!container) return;

  const { device, telemetry, connection, currentZone, risk, incidents, nodes } = appState;
  const latestIncident = incidents[0] || null;

  container.innerHTML = `
    <!-- Top Hero Banner: Local Node Identity & Hold-To-Trigger SOS -->
    <div class="lok-card device-hero-card" style="margin-bottom: 1rem;" id="dash-hero-card">
      <div class="device-hero-left">
        <div class="device-avatar-badge" id="dash-device-avatar">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="device-hero-meta">
          <h1>
            <span id="dash-device-name">${device.name}</span>
            <span class="device-id-tag" id="dash-device-id">${device.id}</span>
          </h1>
          <div class="device-hero-sub">
            <span><strong style="color:var(--color-cyan)">PEER NODE</strong> • STANDALONE</span>
            <span>STATUS: <span id="dash-device-status" style="font-weight:700; color:${device.status === 'SOS' ? 'var(--color-restricted)' : 'var(--color-safe)'}">${device.status}</span></span>
            <span>FW: <span style="font-family:var(--font-mono)">${device.firmware}</span></span>
          </div>
        </div>
      </div>

      <!-- Critical SOS Action Trigger with Press & Hold -->
      <div class="sos-action-card">
        <button id="sos-trigger-btn" class="sos-hold-btn" aria-label="Hold to broadcast emergency SOS">
          <div id="sos-progress-fill" class="sos-progress-fill"></div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <span id="sos-btn-label">HOLD FOR SOS</span>
        </button>
        <div class="sos-hint">
          <strong>Press & hold (2.5s)</strong> to broadcast emergency LoRa distress beacon.
        </div>
      </div>
    </div>

    <!-- Dedicated ESP32 Hardware Connection Control Bar -->
    <div class="lok-card esp-connection-card esp-${connection.status}" style="margin-bottom: 1.25rem;" id="dash-esp-card">
      <div class="esp-conn-left">
        <div class="esp-status-indicator">
          <div class="status-pulse-dot dot-${connection.status}" id="esp-status-dot"></div>
          <div class="esp-status-text-wrap">
            <span class="esp-status-title" id="esp-status-title">
              ${getConnectionStatusText(connection)}
            </span>
            <span class="esp-status-sub" id="esp-status-endpoint">Endpoint: ${connection.endpoint}</span>
          </div>
        </div>

        <div class="esp-mode-pill mode-${connection.mode}" id="esp-mode-badge">
          <span class="esp-mode-dot"></span>
          <span id="esp-mode-text">${connection.mode === 'live' ? 'LIVE ESP32' : 'MOCK SIMULATOR'}</span>
        </div>
      </div>

      <div class="esp-conn-center">
        <div class="esp-telemetry-timestamp-box">
          <span class="esp-ts-label">Latest Telemetry:</span>
          <span class="esp-ts-val" id="dash-telemetry-timestamp">
            ${telemetry.lastUpdate ? new Date(telemetry.lastUpdate).toLocaleTimeString() : 'Waiting for packet...'}
          </span>
          <span class="esp-ts-relative" id="dash-telemetry-relative">(Just now)</span>
        </div>
      </div>

      <div class="esp-conn-actions">
        <button id="esp-connect-toggle-btn" class="${getConnectButtonClass(connection)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span id="esp-btn-label">${getConnectButtonText(connection)}</span>
        </button>

        <button id="esp-mode-toggle-btn" class="btn-esp-mode" title="Toggle between Physical ESP32 and Mock Simulator">
          <span id="esp-mode-btn-label">${connection.mode === 'live' ? 'Switch to Mock' : 'Switch to Live ESP32'}</span>
        </button>
      </div>
    </div>

    <!-- Main Dashboard Grid -->
    <div class="dashboard-grid">

      <!-- Column 1: Core Live Sensor Telemetry (Span 8) -->
      <div class="col-8">
        <div class="lok-card" id="dash-telemetry-card">
          <div class="lok-card-header">
            <div class="lok-card-title" id="dash-telemetry-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" stroke-width="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              <span id="dash-telemetry-title-text">Live Sensor Telemetry</span>
              <span id="dash-telemetry-title-status" class="telemetry-title-offline" style="display:none;">— OFFLINE</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="tag-badge tag-live" id="dash-telemetry-badge">GPS: ${telemetry.gpsStatus || 'ACTIVE'} • ${telemetry.gpsFix || '3D FIX'} • ${telemetry.hdop} HDOP</span>
            </div>
          </div>

          <!-- Offline Telemetry Warning Banner -->
          <div id="dash-telemetry-offline-banner" class="telemetry-offline-banner" style="display:none;">
            <div class="telemetry-offline-banner-content">
              <div class="telemetry-offline-banner-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>ESP32 DISCONNECTED</span>
              </div>
              <div class="telemetry-offline-banner-desc">
                Unable to fetch live sensor data. Connect the ESP32 to resume real-time telemetry.
              </div>
            </div>
          </div>

          <div class="metric-grid">
            <!-- Battery -->
            <div class="metric-item" id="dash-card-battery">
              <div class="metric-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="11" x2="23" y2="13"/>
                </svg>
                Battery
              </div>
              <div class="metric-value" id="dash-metric-battery">${telemetry.battery}%</div>
              <div class="metric-sub" id="dash-metric-voltage">${telemetry.batteryVoltage} V (LiPo)</div>
            </div>

            <!-- Temperature -->
            <div class="metric-item" id="dash-card-temp">
              <div class="metric-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
                </svg>
                Temperature
              </div>
              <div class="metric-value" id="dash-metric-temp">${telemetry.temperature}°C</div>
              <div class="metric-sub" id="dash-metric-temp-sub">Ambient SHT40</div>
            </div>

            <!-- Humidity -->
            <div class="metric-item" id="dash-card-humidity">
              <div class="metric-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                </svg>
                Humidity
              </div>
              <div class="metric-value" id="dash-metric-humidity">${telemetry.humidity}%</div>
              <div class="metric-sub" id="dash-metric-humidity-sub">Relative RH</div>
            </div>

            <!-- LoRa Mesh -->
            <div class="metric-item" id="dash-card-lora">
              <div class="metric-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
                </svg>
                LoRa Mesh
              </div>
              <div class="metric-value" id="dash-metric-lora" style="font-size:1.1rem; color:var(--color-cyan)">${telemetry.loraStatus}</div>
              <div class="metric-sub" id="dash-metric-rssi">RSSI: ${telemetry.loraRssi} dBm</div>
            </div>
          </div>

          <!-- Location Coordinates Bar -->
          <div id="dash-coords-box" style="margin-top: 1rem; padding: 0.75rem 1rem; background-color: var(--bg-surface-raised); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase; font-weight:600;">GPS Location:</span>
              <span id="dash-coords" style="font-family:var(--font-mono); font-size:0.85rem; font-weight:700; color:var(--text-primary);">
                ${telemetry.lat.toFixed(6)}, ${telemetry.lng.toFixed(6)}
              </span>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);" id="dash-alt-hdop">
              ALT: ${telemetry.altitude}m • HDOP: ${telemetry.hdop}
            </div>
          </div>
        </div>

        <!-- Geo-Fence Zone Card -->
        <div class="lok-card zone-card zone-${currentZone.type.toLowerCase()}" style="margin-top: 1.25rem;" id="dash-zone-card">
          <div class="lok-card-header" style="margin-bottom:0.5rem;">
            <div class="zone-badge" id="dash-zone-badge">
              <span>${currentZone.type === 'SAFE' ? '🟢' : currentZone.type === 'CAUTION' ? '🟡' : '🔴'}</span>
              <span>${currentZone.type} ZONE</span>
            </div>
            <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-secondary);">${currentZone.id}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:700; color:var(--text-primary);" id="dash-zone-name">${currentZone.name}</div>
          <div class="zone-desc" id="dash-zone-msg">${currentZone.message}</div>
          <div class="zone-action-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span id="dash-zone-action"><strong>Recommended:</strong> ${currentZone.recommendedAction}</span>
          </div>
        </div>
      </div>

      <!-- Column 2: AI Risk Profile & Nearby Peers Summary (Span 4) -->
      <div class="col-4" style="display:flex; flex-direction:column; gap:1.25rem;">
        
        <!-- Risk Profile Card -->
        <div class="lok-card risk-card">
          <div class="lok-card-header">
            <div class="lok-card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Risk Assessment
            </div>
            <span class="risk-level-pill risk-level-${risk.level.toLowerCase()}" id="dash-risk-pill">${risk.level}</span>
          </div>

          <div class="risk-display-row">
            <div class="risk-gauge-box">
              <div class="risk-score-num" id="dash-risk-score" style="color: ${getRiskColor(risk.level)}">${risk.score}</div>
              <div class="risk-score-total">RISK INDEX / 100</div>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); text-align:right;">
              Dynamic Multi-Sensor<br>Anomaly Score
            </div>
          </div>

          <div class="risk-progress-bar">
            <div class="risk-progress-val" id="dash-risk-bar" style="width: ${risk.score}%; background-color: ${getRiskColor(risk.level)};"></div>
          </div>

          <div style="margin-top:0.25rem;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:0.4rem;">
              Contributing Conditions:
            </div>
            <ul class="risk-reasons-list" id="dash-risk-reasons">
              ${risk.reasons.map(r => `
                <li class="risk-reason-item">
                  <span style="color:var(--color-cyan)">•</span>
                  <span>${r}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>

        <!-- Nearby Peer Summary Card -->
        <div class="lok-card">
          <div class="lok-card-header">
            <div class="lok-card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
              </svg>
              Nearby Peer Mesh
            </div>
            <span class="nav-badge badge-cyan" id="dash-peer-count">${nodes.length} NODES</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:0.5rem;" id="dash-nodes-mini-list">
            ${nodes.slice(0, 3).map(n => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.75rem; background-color:var(--bg-surface-raised); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <div class="status-dot ${n.isSos ? 'status-restricted' : 'status-safe'}"></div>
                  <strong style="font-family:var(--font-mono); font-size:0.82rem;">${n.id}</strong>
                </div>
                <div style="font-size:0.72rem; color:var(--text-secondary); font-family:var(--font-mono);">
                  ${n.rssi} dBm
                </div>
              </div>
            `).join('')}
          </div>

          <button id="dash-view-nodes-btn" class="btn-secondary" style="width:100%; margin-top:0.75rem; font-size:0.78rem; padding:0.45rem;">
            View All ${nodes.length} Peer Nodes →
          </button>
        </div>

      </div>

      <!-- Column 3: Active Incident Alert Banner / Summary (Span 12) -->
      <div class="col-12">
        <div class="lok-card" style="border-left: 4px solid ${latestIncident && latestIncident.status === 'ACTIVE' ? 'var(--color-restricted)' : 'var(--color-cyan)'};">
          <div class="lok-card-header">
            <div class="lok-card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Latest Peer Incident Status
            </div>
            <button id="dash-view-incidents-btn" class="btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.65rem;">
              Incident Log (${incidents.length}) →
            </button>
          </div>

          <div id="dash-incident-detail">
            ${latestIncident ? `
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
                <div>
                  <div style="font-weight:700; font-size:0.95rem; color:var(--text-primary);">
                    ${latestIncident.title} (${latestIncident.id})
                  </div>
                  <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
                    Source: <strong style="font-family:var(--font-mono)">${latestIncident.sourceDevice}</strong> • Zone: ${latestIncident.zone} • ${new Date(latestIncident.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <span class="incident-badge-type" style="background:${latestIncident.riskLevel === 'CRITICAL' ? 'var(--color-restricted-bg)' : 'var(--color-caution-bg)'}; color:${latestIncident.riskLevel === 'CRITICAL' ? 'var(--color-restricted)' : 'var(--color-caution)'}">
                    ${latestIncident.status}
                  </span>
                </div>
              </div>
            ` : `
              <div style="font-size:0.85rem; color:var(--text-muted); padding:0.5rem 0;">
                No active incidents recorded. Peer network operational.
              </div>
            `}
          </div>
        </div>
      </div>

    </div>
  `;

  // Quick navigation handlers
  document.getElementById("dash-view-nodes-btn")?.addEventListener("click", () => {
    window.navigateTo?.("nodes");
  });

  document.getElementById("dash-view-incidents-btn")?.addEventListener("click", () => {
    window.navigateTo?.("incidents");
  });
}

/**
 * Setup ESP32 connection buttons & mode toggle handlers
 */
function setupEspControls() {
  const connectBtn = document.getElementById("esp-connect-toggle-btn");
  const modeBtn = document.getElementById("esp-mode-toggle-btn");

  connectBtn?.addEventListener("click", () => {
    const conn = appState.connection;
    if (conn.status === "connected") {
      disconnectEsp32();
      showToast("ESP32 Disconnected", "caution");
    } else {
      const endpoint = (conn.endpoint && conn.endpoint.startsWith("ws")) ? conn.endpoint : "ws://192.168.4.1/ws";
      connectEsp32(endpoint);
      showToast(`Connecting to ESP32 at ${endpoint}...`, "safe");
    }
  });

  modeBtn?.addEventListener("click", () => {
    if (appState.connection.mode === "live") {
      switchToMockMode();
      showToast("Switched to Offline Mock Simulator Mode", "safe");
    } else {
      const endpoint = (appState.connection.endpoint && appState.connection.endpoint.startsWith("ws"))
        ? appState.connection.endpoint
        : "ws://192.168.4.1/ws";
      switchToLiveMode(endpoint);
      showToast(`Connecting to Live ESP32 (${endpoint})...`, "safe");
    }
  });
}

/**
 * Setup Press-and-Hold SOS Interaction
 */
function setupSosButton() {
  const btn = document.getElementById("sos-trigger-btn");
  const fill = document.getElementById("sos-progress-fill");
  const label = document.getElementById("sos-btn-label");
  if (!btn || !fill || !label) return;

  updateDashboardSosButton();

  const startHold = (e) => {
    e.preventDefault();
    if (appState.sosRequest?.status === "REQUESTING") {
      return;
    }
    if (appState.device.status === "SOS") {
      return;
    }

    sosHoldProgress = 0;
    fill.style.width = "0%";
    label.textContent = "HOLDING...";

    const startTime = Date.now();
    sosInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      sosHoldProgress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
      fill.style.width = `${sosHoldProgress}%`;

      if (sosHoldProgress >= 100) {
        clearInterval(sosInterval);
        sosInterval = null;
        triggerSosRequest();
      }
    }, 40);
  };

  const cancelHold = () => {
    if (sosInterval) {
      clearInterval(sosInterval);
      sosInterval = null;
    }
    if (appState.sosRequest?.status !== "REQUESTING") {
      sosHoldProgress = 0;
      fill.style.width = "0%";
      updateDashboardSosButton();
    }
  };

  btn.addEventListener("mousedown", startHold);
  btn.addEventListener("touchstart", startHold, { passive: false });

  window.addEventListener("mouseup", cancelHold);
  window.addEventListener("touchend", cancelHold);
  window.addEventListener("touchcancel", cancelHold);
}

/**
 * Trigger Outgoing SOS Request via WebSocket layer
 */
async function triggerSosRequest() {
  console.log("[Dashboard] Hold complete: Emitting SOS_REQUEST...");
  
  const fill = document.getElementById("sos-progress-fill");
  const label = document.getElementById("sos-btn-label");
  if (fill) fill.style.width = "100%";
  if (label) label.textContent = "REQUESTING SOS...";

  const res = await sendSosRequest(appState.device.id);

  if (!res.success) {
    if (label) label.textContent = "SOS REQUEST FAILED ✕";
    if (fill) fill.style.width = "0%";
    showToast(res.error || "LOCAL DEVICE OFFLINE: SOS REQUEST CANNOT BE SENT", "danger");
    setTimeout(() => {
      updateState("sosRequest", { status: "IDLE", timestamp: null, error: null });
    }, 2500);
  }
}

function updateDashboardSosButton() {
  const fill = document.getElementById("sos-progress-fill");
  const label = document.getElementById("sos-btn-label");
  if (!label) return;

  const reqStatus = appState.sosRequest?.status || "IDLE";
  const devStatus = appState.device?.status || "ONLINE";

  if (reqStatus === "REQUESTING") {
    label.textContent = "REQUESTING SOS...";
    if (fill) fill.style.width = "100%";
  } else if (reqStatus === "CONFIRMED") {
    label.textContent = "SOS CONFIRMED ✓";
    if (fill) fill.style.width = "100%";
    setTimeout(() => {
      if (appState.device.status === "SOS") {
        label.textContent = "SOS ACTIVE ⚠️";
      }
    }, 1200);
  } else if (reqStatus === "FAILED") {
    label.textContent = "SOS REQUEST FAILED ✕";
    if (fill) fill.style.width = "0%";
  } else if (reqStatus === "TIMEOUT") {
    label.textContent = "NO CONFIRMATION ✕";
    if (fill) fill.style.width = "0%";
    showToast("NO CONFIRMATION RECEIVED FROM HARDWARE", "danger");
    setTimeout(() => {
      updateState("sosRequest", { status: "IDLE", timestamp: null, error: null });
    }, 2500);
  } else {
    label.textContent = devStatus === "SOS" ? "SOS BROADCASTING ⚠️" : "HOLD FOR SOS";
    if (fill && devStatus !== "SOS") fill.style.width = "0%";
  }
}

/**
 * Update the ESP32 Hardware Connection Control Bar
 */
export function updateDashboardConnection() {
  const conn = appState.connection;

  const card = document.getElementById("dash-esp-card");
  if (card) {
    card.className = `lok-card esp-connection-card esp-${conn.status}`;
  }

  const dot = document.getElementById("esp-status-dot");
  if (dot) {
    dot.className = `status-pulse-dot dot-${conn.status}`;
  }

  const title = document.getElementById("esp-status-title");
  if (title) {
    title.textContent = getConnectionStatusText(conn);
  }

  const endpointEl = document.getElementById("esp-status-endpoint");
  if (endpointEl) {
    endpointEl.textContent = `Endpoint: ${conn.endpoint}`;
  }

  const modeBadge = document.getElementById("esp-mode-badge");
  const modeText = document.getElementById("esp-mode-text");
  if (modeBadge && modeText) {
    modeBadge.className = `esp-mode-pill mode-${conn.mode}`;
    modeText.textContent = conn.mode === 'live' ? 'LIVE ESP32' : 'MOCK SIMULATOR';
  }

  const connectBtn = document.getElementById("esp-connect-toggle-btn");
  const btnLabel = document.getElementById("esp-btn-label");
  if (connectBtn && btnLabel) {
    connectBtn.className = getConnectButtonClass(conn);
    btnLabel.textContent = getConnectButtonText(conn);
  }

  const modeBtnLabel = document.getElementById("esp-mode-btn-label");
  if (modeBtnLabel) {
    modeBtnLabel.textContent = conn.mode === 'live' ? 'Switch to Mock' : 'Switch to Live ESP32';
  }

  updateDashboardTelemetry();
}

function getConnectionStatusText(conn) {
  switch (conn.status) {
    case "connected":
      return "ESP32 CONNECTED";
    case "connecting":
      return "CONNECTING...";
    case "mock_mode":
      return "MOCK SIMULATOR ACTIVE";
    case "disconnected":
    default:
      return "ESP32 DISCONNECTED";
  }
}

function getConnectButtonText(conn) {
  switch (conn.status) {
    case "connected":
      return "Disconnect ESP32";
    case "connecting":
      return "Connecting...";
    case "mock_mode":
    case "disconnected":
    default:
      return "Connect ESP32";
  }
}

function getConnectButtonClass(conn) {
  switch (conn.status) {
    case "connected":
      return "btn-esp-disconnect";
    case "connecting":
      return "btn-esp-connecting";
    case "mock_mode":
    case "disconnected":
    default:
      return "btn-esp-connect";
  }
}

/**
 * Update Dashboard Telemetry Metric Cards & Timestamp
 */
export function updateDashboardTelemetry() {
  const t = appState.telemetry;
  const d = appState.device;
  const conn = appState.connection;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // Device ID & Identity
  setEl("dash-device-id", d.id);
  setEl("dash-device-name", d.name);

  const isLiveConnected = conn.mode === "live" && conn.status === "connected";
  const isMockMode = conn.mode === "mock" || conn.status === "mock_mode";
  const isDisconnected = !isLiveConnected && !isMockMode;

  const offlineBanner = document.getElementById("dash-telemetry-offline-banner");
  const titleStatus = document.getElementById("dash-telemetry-title-status");
  const titleText = document.getElementById("dash-telemetry-title-text");
  const gpsBadge = document.getElementById("dash-telemetry-badge");
  const coordsBox = document.getElementById("dash-coords-box");
  const loraValue = document.getElementById("dash-metric-lora");
  const metricCards = ["dash-card-battery", "dash-card-temp", "dash-card-humidity", "dash-card-lora"];

  if (isDisconnected) {
    // 1. OFFLINE / DISCONNECTED State: Display clear placeholders & warning banner
    if (offlineBanner) offlineBanner.style.display = "flex";
    if (titleStatus) titleStatus.style.display = "inline";
    if (titleText) titleText.textContent = "Live Sensor Telemetry";

    if (gpsBadge) {
      gpsBadge.className = "tag-badge tag-offline";
      gpsBadge.textContent = "⚠ OFFLINE • NO TELEMETRY";
    }

    metricCards.forEach(id => {
      document.getElementById(id)?.classList.add("metric-unavailable");
    });
    coordsBox?.classList.add("coords-box-offline");

    // Clear and set offline placeholder values
    setEl("dash-metric-battery", "--");
    setEl("dash-metric-voltage", "Data unavailable");
    setEl("dash-metric-temp", "-- °C");
    setEl("dash-metric-temp-sub", "Data unavailable");
    setEl("dash-metric-humidity", "-- %");
    setEl("dash-metric-humidity-sub", "Data unavailable");
    setEl("dash-metric-lora", "OFFLINE");
    if (loraValue) loraValue.style.color = "var(--color-restricted)";
    setEl("dash-metric-rssi", "ESP32 disconnected");

    setEl("dash-coords", "Location unavailable");
    setEl("dash-alt-hdop", "Waiting for ESP32 connection");

    const tsEl = document.getElementById("dash-telemetry-timestamp");
    if (tsEl) tsEl.textContent = "Telemetry Offline";

    const relEl = document.getElementById("dash-telemetry-relative");
    if (relEl) relEl.textContent = "(ESP32 disconnected)";

  } else if (isLiveConnected) {
    // 2. LIVE ESP32 Connected State: Display real live sensor values
    if (offlineBanner) offlineBanner.style.display = "none";
    if (titleStatus) titleStatus.style.display = "none";
    if (titleText) titleText.textContent = "Live Sensor Telemetry";

    metricCards.forEach(id => {
      document.getElementById(id)?.classList.remove("metric-unavailable");
    });
    coordsBox?.classList.remove("coords-box-offline");

    const isGpsNoFix = t.gpsFix === "NO_FIX" || t.gpsStatus === "NO_FIX" || t.gpsValid === false;
    if (gpsBadge) {
      if (isGpsNoFix) {
        gpsBadge.className = "tag-badge tag-warning";
        gpsBadge.textContent = "GPS: NO FIX (Last Known Position)";
      } else {
        gpsBadge.className = "tag-badge tag-live";
        gpsBadge.textContent = `GPS: ${t.gpsStatus || 'ACTIVE'} • ${t.gpsFix || '3D FIX'} • ${t.hdop || '0.9'} HDOP`;
      }
    }

    setEl("dash-metric-battery", `${t.battery}%`);
    setEl("dash-metric-voltage", t.batteryVoltage ? `${t.batteryVoltage} V (LiPo)` : `${(3.3 + (t.battery / 100) * 0.9).toFixed(2)} V (LiPo)`);
    setEl("dash-metric-temp", `${t.temperature}°C`);
    setEl("dash-metric-temp-sub", "Ambient SHT40");
    setEl("dash-metric-humidity", `${t.humidity}%`);
    setEl("dash-metric-humidity-sub", "Relative RH");
    setEl("dash-metric-lora", t.loraStatus || "CONNECTED");
    if (loraValue) loraValue.style.color = "var(--color-cyan)";
    setEl("dash-metric-rssi", `RSSI: ${t.loraRssi} dBm`);

    setEl("dash-coords", isGpsNoFix ? `${t.lat.toFixed(6)}, ${t.lng.toFixed(6)} (Last Known)` : `${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}`);
    setEl("dash-alt-hdop", `ALT: ${t.altitude ? t.altitude + 'm' : '--'} • HDOP: ${t.hdop ? t.hdop : (isGpsNoFix ? 'NO FIX' : '0.9')}`);

    const tsEl = document.getElementById("dash-telemetry-timestamp");
    if (tsEl) {
      tsEl.textContent = t.lastUpdate ? new Date(t.lastUpdate).toLocaleTimeString() : 'Waiting for packet...';
    }

    updateRelativeTimestamp();

  } else {
    // 3. MOCK SIMULATOR Active State: Display simulated telemetry with clear labels
    if (offlineBanner) offlineBanner.style.display = "none";
    if (titleStatus) titleStatus.style.display = "none";
    if (titleText) titleText.textContent = "Live Sensor Telemetry (Simulated)";

    metricCards.forEach(id => {
      document.getElementById(id)?.classList.remove("metric-unavailable");
    });
    coordsBox?.classList.remove("coords-box-offline");

    if (gpsBadge) {
      gpsBadge.className = "tag-badge tag-lora";
      gpsBadge.textContent = `SIMULATED • GPS: ${t.gpsStatus || 'ACTIVE'} • ${t.gpsFix || '3D FIX'}`;
    }

    setEl("dash-metric-battery", `${t.battery}%`);
    setEl("dash-metric-voltage", t.batteryVoltage ? `${t.batteryVoltage} V (Simulated)` : "4.12 V (Simulated)");
    setEl("dash-metric-temp", `${t.temperature}°C`);
    setEl("dash-metric-temp-sub", "Ambient SHT40 (Simulated)");
    setEl("dash-metric-humidity", `${t.humidity}%`);
    setEl("dash-metric-humidity-sub", "Relative RH (Simulated)");
    setEl("dash-metric-lora", "SIMULATED");
    if (loraValue) loraValue.style.color = "var(--color-cyan)";
    setEl("dash-metric-rssi", `RSSI: ${t.loraRssi} dBm (Mock)`);

    setEl("dash-coords", `${t.lat.toFixed(6)}, ${t.lng.toFixed(6)}`);
    setEl("dash-alt-hdop", `ALT: ${t.altitude ? t.altitude + 'm' : '--'} • HDOP: ${t.hdop ? t.hdop : '0.9'} (Mock)`);

    const tsEl = document.getElementById("dash-telemetry-timestamp");
    if (tsEl) {
      tsEl.textContent = t.lastUpdate ? new Date(t.lastUpdate).toLocaleTimeString() : 'Waiting for packet...';
    }

    updateRelativeTimestamp();
  }
}

function updateRelativeTimestamp() {
  const relEl = document.getElementById("dash-telemetry-relative");
  if (!relEl) return;

  const conn = appState.connection;
  const isLiveConnected = conn.mode === "live" && conn.status === "connected";
  const isMockMode = conn.mode === "mock" || conn.status === "mock_mode";

  if (!isLiveConnected && !isMockMode) {
    relEl.textContent = "(ESP32 disconnected)";
    return;
  }

  const lastUpdate = appState.telemetry.lastUpdate;
  if (!lastUpdate) {
    relEl.textContent = "(No data)";
    return;
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000));

  if (isLiveConnected) {
    if (elapsedSec <= 1) {
      relEl.textContent = "(Just now)";
    } else if (elapsedSec < 60) {
      relEl.textContent = `(${elapsedSec}s ago)`;
    } else {
      const mins = Math.floor(elapsedSec / 60);
      relEl.textContent = `(${mins}m ago)`;
    }
  } else {
    // Mock mode
    relEl.textContent = elapsedSec <= 1 ? "(Simulated: Just now)" : `(Simulated: ${elapsedSec}s ago)`;
  }
}

export function updateDashboardDevice() {
  const d = appState.device;
  const statusEl = document.getElementById("dash-device-status");
  if (statusEl) {
    statusEl.textContent = d.status;
    statusEl.style.color = d.status === "SOS" ? "var(--color-restricted)" : "var(--color-safe)";
  }
  const idEl = document.getElementById("dash-device-id");
  if (idEl) idEl.textContent = d.id;
  const nameEl = document.getElementById("dash-device-name");
  if (nameEl) nameEl.textContent = d.name;
}

function updateDashboardZone() {
  const z = appState.currentZone;
  const card = document.getElementById("dash-zone-card");
  if (card) {
    card.className = `lok-card zone-card zone-${z.type.toLowerCase()}`;
  }
  const badge = document.getElementById("dash-zone-badge");
  if (badge) {
    const icon = z.type === 'SAFE' ? '🟢' : z.type === 'CAUTION' ? '🟡' : '🔴';
    badge.innerHTML = `<span>${icon}</span> <span>${z.type} ZONE</span>`;
  }
  const name = document.getElementById("dash-zone-name");
  if (name) name.textContent = z.name;
  const msg = document.getElementById("dash-zone-msg");
  if (msg) msg.textContent = z.message;
  const action = document.getElementById("dash-zone-action");
  if (action) action.innerHTML = `<strong>Recommended:</strong> ${z.recommendedAction}`;
}

function updateDashboardRisk() {
  const r = appState.risk;
  const scoreEl = document.getElementById("dash-risk-score");
  if (scoreEl) {
    scoreEl.textContent = r.score;
    scoreEl.style.color = getRiskColor(r.level);
  }
  const pillEl = document.getElementById("dash-risk-pill");
  if (pillEl) {
    pillEl.className = `risk-level-pill risk-level-${r.level.toLowerCase()}`;
    pillEl.textContent = r.level;
  }
  const barEl = document.getElementById("dash-risk-bar");
  if (barEl) {
    barEl.style.width = `${r.score}%`;
    barEl.style.backgroundColor = getRiskColor(r.level);
  }
  const reasonsEl = document.getElementById("dash-risk-reasons");
  if (reasonsEl) {
    reasonsEl.innerHTML = r.reasons.map(reason => `
      <li class="risk-reason-item">
        <span style="color:var(--color-cyan)">•</span>
        <span>${reason}</span>
      </li>
    `).join('');
  }
}

function updateDashboardIncidents() {
  const incDetail = document.getElementById("dash-incident-detail");
  const latest = appState.incidents[0];
  if (!incDetail) return;

  if (latest) {
    incDetail.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <div style="font-weight:700; font-size:0.95rem; color:var(--text-primary);">
            ${latest.title} (${latest.id})
          </div>
          <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
            Source: <strong style="font-family:var(--font-mono)">${latest.sourceDevice}</strong> • Zone: ${latest.zone} • ${new Date(latest.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span class="incident-badge-type" style="background:${latest.riskLevel === 'CRITICAL' ? 'var(--color-restricted-bg)' : 'var(--color-caution-bg)'}; color:${latest.riskLevel === 'CRITICAL' ? 'var(--color-restricted)' : 'var(--color-caution)'}">
            ${latest.status}
          </span>
        </div>
      </div>
    `;
  }
}

function updateDashboardNodes() {
  const nodes = appState.nodes;
  const countEl = document.getElementById("dash-peer-count");
  if (countEl) countEl.textContent = `${nodes.length} NODES`;

  const listEl = document.getElementById("dash-nodes-mini-list");
  if (listEl) {
    listEl.innerHTML = nodes.slice(0, 3).map(n => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem 0.75rem; background-color:var(--bg-surface-raised); border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <div class="status-dot ${n.isSos ? 'status-restricted' : 'status-safe'}"></div>
          <strong style="font-family:var(--font-mono); font-size:0.82rem;">${n.id}</strong>
        </div>
        <div style="font-size:0.72rem; color:var(--text-secondary); font-family:var(--font-mono);">
          ${n.rssi} dBm
        </div>
      </div>
    `).join('');
  }
}

function getRiskColor(level) {
  switch (level) {
    case "LOW": return "var(--color-safe)";
    case "MEDIUM": return "var(--color-caution)";
    case "HIGH": return "#f97316";
    case "CRITICAL": return "var(--color-restricted)";
    default: return "var(--color-safe)";
  }
}

