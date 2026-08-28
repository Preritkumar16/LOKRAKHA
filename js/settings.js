/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Settings & Local Storage Manager
 * Hardware parameters, alert toggles, and offline database management
 */

import { appState, updateState, subscribe } from "./state.js";
import { clearAllLocalData, saveSetting } from "./storage.js";
import { connectEsp32 } from "./websocket.js";

/**
 * Initialize Settings View
 */
export function initSettings() {
  const container = document.getElementById("view-settings");
  if (!container) return;

  renderSettings();
  subscribe("connection", () => {
    const badge = document.getElementById("setting-conn-badge");
    if (badge) {
      const status = appState.connection.status;
      badge.className = `tag-badge ${status === 'connected' ? 'tag-live' : (status === 'connecting' || status === 'mock_mode' ? 'tag-lora' : '')}`;
      badge.textContent = status.toUpperCase();
    }
  });
}

/**
 * Render Settings View
 */
export function renderSettings() {
  const container = document.getElementById("view-settings");
  if (!container) return;

  const { settings, device, connection } = appState;

  container.innerHTML = `
    <div class="settings-section" style="margin: 0 auto;">
      
      <div>
        <h2 style="font-size:1.3rem; font-weight:800; color:var(--text-primary);">Node & Dashboard Settings</h2>
        <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">
          Configure local device behavior, radio parameters, and offline storage.
        </p>
      </div>

      <!-- Node Hardware Configuration -->
      <div class="lok-card">
        <div class="lok-card-header">
          <div class="lok-card-title">Node Configuration</div>
        </div>

        <div style="display:flex; flex-direction:column; gap:0.85rem;">
          <div class="setting-row">
            <div class="setting-info">
              <h4>Device Name</h4>
              <p>Identifier transmitted in peer beacon mesh packets</p>
            </div>
            <input type="text" id="setting-device-name" class="chat-input" style="max-width:180px; font-size:0.82rem;" value="${device.name}" />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <h4>LoRa Frequency Band</h4>
              <p>Regional ISM Sub-GHz frequency channel</p>
            </div>
            <select id="setting-lora-band" style="background:var(--bg-surface); border:1px solid var(--border-medium); color:var(--text-primary); border-radius:var(--radius-md); padding:0.4rem 0.75rem; font-size:0.82rem;">
              <option value="868.1 MHz" ${settings.loraBand === '868.1 MHz' ? 'selected' : ''}>868.1 MHz (EU/India ISM)</option>
              <option value="915.0 MHz" ${settings.loraBand === '915.0 MHz' ? 'selected' : ''}>915.0 MHz (US ISM)</option>
              <option value="433.0 MHz" ${settings.loraBand === '433.0 MHz' ? 'selected' : ''}>433.0 MHz</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Alert & Notification Preferences -->
      <div class="lok-card">
        <div class="lok-card-header">
          <div class="lok-card-title">Alert & Sensory Preferences</div>
        </div>

        <div style="display:flex; flex-direction:column; gap:0.85rem;">
          <div class="setting-row">
            <div class="setting-info">
              <h4>Audio Warning Tones</h4>
              <p>Play browser synthesized audio alarms when SOS or caution alerts arrive</p>
            </div>
            <label class="switch">
              <input type="checkbox" id="setting-audio" ${settings.audioAlerts ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <h4>Haptic Feedback</h4>
              <p>Vibrate compatible handheld devices during SOS hold interaction</p>
            </div>
            <label class="switch">
              <input type="checkbox" id="setting-haptic" ${settings.hapticFeedback ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Local WebSocket Physical Gateway -->
      <div class="lok-card">
        <div class="lok-card-header">
          <div class="lok-card-title">Local Wi-Fi Hardware Gateway</div>
          <span class="tag-badge ${connection.status === 'connected' ? 'tag-live' : 'tag-lora'}" id="setting-conn-badge">${connection.status.toUpperCase()}</span>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <h4>ESP32 WebSocket Address</h4>
            <p>Target endpoint for physical LOKRAKSHA Wi-Fi Access Point</p>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <input type="text" id="setting-ws-url" class="chat-input" style="max-width:180px; font-size:0.82rem;" value="${connection.endpoint}" />
            <button id="setting-ws-connect-btn" class="btn-primary" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
              Connect
            </button>
          </div>
        </div>
      </div>

      <!-- Local Storage & Offline Data Management -->
      <div class="lok-card">
        <div class="lok-card-header">
          <div class="lok-card-title">Local Data & IndexedDB Persistence</div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <h4>Export Local Incident & Telemetry Archive</h4>
            <p>Download JSON snapshot of stored peer logs and sensor telemetries</p>
          </div>
          <button id="setting-export-btn" class="btn-secondary" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
            Export JSON
          </button>
        </div>

        <div class="setting-row" style="border-color: rgba(239, 68, 68, 0.3);">
          <div class="setting-info">
            <h4 style="color:var(--color-restricted)">Clear All Local Stored Data</h4>
            <p>Erase locally cached messages, incidents, and peer nodes from IndexedDB</p>
          </div>
          <button id="setting-clear-data-btn" class="btn-danger" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
            Clear Local Data
          </button>
        </div>
      </div>

    </div>
  `;

  // Attach event listeners
  document.getElementById("setting-device-name")?.addEventListener("change", (e) => {
    const val = e.target.value.trim();
    if (val) {
      updateState("device", { ...appState.device, name: val });
      saveSetting("deviceName", val);
    }
  });

  document.getElementById("setting-audio")?.addEventListener("change", (e) => {
    appState.settings.audioAlerts = e.target.checked;
    saveSetting("audioAlerts", e.target.checked);
  });

  document.getElementById("setting-haptic")?.addEventListener("change", (e) => {
    appState.settings.hapticFeedback = e.target.checked;
    saveSetting("hapticFeedback", e.target.checked);
  });

  document.getElementById("setting-ws-connect-btn")?.addEventListener("click", () => {
    const input = document.getElementById("setting-ws-url");
    if (input) connectEsp32(input.value);
  });

  document.getElementById("setting-export-btn")?.addEventListener("click", exportLocalDataJson);
  document.getElementById("setting-clear-data-btn")?.addEventListener("click", confirmClearData);
}

function exportLocalDataJson() {
  const data = {
    exportedAt: new Date().toISOString(),
    device: appState.device,
    telemetry: appState.telemetry,
    incidents: appState.incidents,
    messages: appState.messages,
    nodes: appState.nodes
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lokraksha_export_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function confirmClearData() {
  const modal = document.getElementById("confirm-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const confirmBtn = document.getElementById("modal-confirm-btn");
  const cancelBtn = document.getElementById("modal-cancel-btn");

  if (!modal || !modalTitle || !modalBody || !confirmBtn) return;

  modalTitle.textContent = "Clear All Local Data?";
  modalBody.textContent = "This will permanently erase all cached messages, incident histories, and peer node entries stored in IndexedDB. Are you sure?";
  modal.classList.add("open");

  const onConfirm = async () => {
    await clearAllLocalData();
    modal.classList.remove("open");
    window.location.reload();
  };

  const onCancel = () => {
    modal.classList.remove("open");
    confirmBtn.removeEventListener("click", onConfirm);
    cancelBtn?.removeEventListener("click", onCancel);
  };

  confirmBtn.onclick = onConfirm;
  if (cancelBtn) cancelBtn.onclick = onCancel;
}
