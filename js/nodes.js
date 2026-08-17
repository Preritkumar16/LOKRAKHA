/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Decentralized Nearby Nodes Module
 * Peer-to-peer mesh node discovery, LoRa signal monitoring, and direct telemetry inspection
 */

import { appState, subscribe } from "./state.js";

/**
 * Initialize Nearby Nodes Screen
 */
export function initNodes() {
  const container = document.getElementById("view-nodes");
  if (!container) return;

  renderNodes();
  subscribe("nodes", () => renderNodes());
}

/**
 * Render Nearby Nodes View
 */
export function renderNodes() {
  const container = document.getElementById("view-nodes");
  if (!container) return;

  const nodes = appState.nodes;
  const onlineCount = nodes.filter(n => n.status === "ONLINE").length;
  const sosCount = nodes.filter(n => n.isSos || n.status === "SOS").length;

  container.innerHTML = `
    <div style="max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem;">
      
      <!-- Screen Header -->
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
        <div>
          <h2 style="font-size:1.3rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:0.5rem;">
            <span>Decentralized Peer Network</span>
            <span class="nav-badge badge-cyan">${nodes.length} DISCOVERED</span>
          </h2>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">
            Autonomous peer mesh. No central server or master coordinator.
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:0.6rem;">
          <span class="tag-badge tag-live">🟢 ${onlineCount} ONLINE</span>
          ${sosCount > 0 ? `<span class="tag-badge" style="background:var(--color-restricted-bg); color:var(--color-restricted); border-color:var(--color-restricted-border);">🚨 ${sosCount} SOS</span>` : ''}
          <button id="nodes-refresh-mesh-btn" class="btn-secondary" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
            ↻ Ping Mesh Peers
          </button>
        </div>
      </div>

      <!-- Peer Cards Grid -->
      <div class="nodes-grid">
        ${nodes.map(node => renderNodeCard(node)).join('')}
      </div>

      <!-- Mesh Architecture Architecture Clarification Note -->
      <div class="lok-card" style="background:rgba(0,0,0,0.2); border-style:dashed;">
        <div style="display:flex; align-items:center; gap:0.6rem; font-size:0.8rem; color:var(--text-secondary);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" stroke-width="2" style="flex-shrink:0;">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
          <div>
            <strong>Decentralized Ad-Hoc Mesh:</strong> Each LOKRAKSHA node independently routes LoRa packets across the peer graph without relying on cellular towers or cloud relays.
          </div>
        </div>
      </div>

    </div>
  `;

  document.getElementById("nodes-refresh-mesh-btn")?.addEventListener("click", () => {
    container.querySelectorAll(".node-card").forEach(el => {
      el.style.opacity = "0.7";
      setTimeout(() => { el.style.opacity = "1"; }, 300);
    });
  });

  // Attach direct messaging click handlers
  container.querySelectorAll(".btn-msg-peer").forEach(btn => {
    btn.addEventListener("click", () => {
      const peerId = btn.getAttribute("data-peer-id");
      if (window.startDirectMessage) {
        window.startDirectMessage(peerId);
      }
    });
  });
}

function renderNodeCard(node) {
  const isSos = node.isSos || node.status === "SOS";
  const rssiVal = node.rssi || -75;
  const bars = getSignalBars(rssiVal);
  const timeAgo = formatTimeAgo(node.lastSeen);

  return `
    <div class="node-card ${isSos ? 'node-sos-active' : ''}">
      
      <!-- Card Top -->
      <div class="node-header-row">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <div class="status-dot ${isSos ? 'status-restricted' : node.status === 'ONLINE' ? 'status-safe' : 'status-caution'}"></div>
          <span class="node-id">${node.id}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <div class="signal-bar-wrap" title="LoRa RSSI: ${rssiVal} dBm">
            <div class="sig-bar ${bars >= 1 ? 'active' : ''}" style="height:4px;"></div>
            <div class="sig-bar ${bars >= 2 ? 'active' : ''}" style="height:7px;"></div>
            <div class="sig-bar ${bars >= 3 ? 'active' : ''}" style="height:10px;"></div>
            <div class="sig-bar ${bars >= 4 ? 'active' : ''}" style="height:14px;"></div>
          </div>
          <span style="font-family:var(--font-mono); font-size:0.72rem; color:var(--text-secondary);">${rssiVal} dBm</span>
        </div>
      </div>

      <!-- Node Name & Status -->
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:0.92rem; font-weight:700; color:var(--text-primary);">${node.name}</span>
        <span style="font-size:0.72rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:var(--radius-sm); background:${isSos ? 'var(--color-restricted-bg)' : 'var(--color-safe-bg)'}; color:${isSos ? 'var(--color-restricted)' : 'var(--color-safe)'}">
          ${isSos ? 'SOS DISTRESS' : node.status}
        </span>
      </div>

      <!-- Telemetry Specs Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.4rem; font-size:0.75rem; background-color:var(--bg-surface-raised); padding:0.6rem; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.65rem;">BATTERY</span>
          <strong style="color:var(--text-primary); font-family:var(--font-mono);">${node.battery}%</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.65rem;">TEMPERATURE</span>
          <strong style="color:var(--text-primary); font-family:var(--font-mono);">${node.temperature}°C</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.65rem;">GPS COORDINATES</span>
          <strong style="color:var(--text-primary); font-family:var(--font-mono); font-size:0.7rem;">${node.lat.toFixed(4)}, ${node.lng.toFixed(4)}</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.65rem;">LAST BEACON</span>
          <strong style="color:var(--text-secondary);">${timeAgo}</strong>
        </div>
      </div>

      <!-- Card Action -->
      <button class="btn-secondary btn-msg-peer" data-peer-id="${node.id}" style="width:100%; font-size:0.78rem; padding:0.45rem; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Send Encrypted Message
      </button>

    </div>
  `;
}

function getSignalBars(rssi) {
  if (rssi >= -70) return 4;
  if (rssi >= -80) return 3;
  if (rssi >= -90) return 2;
  return 1;
}

function formatTimeAgo(ts) {
  if (!ts) return "Just now";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  return `${Math.floor(diffSec / 60)}m ago`;
}
