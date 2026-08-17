/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Incident Management Module
 * Comprehensive timeline tracking, status workflow, and peer distress management
 */

import { appState, subscribe, updateState } from "./state.js";
import { saveIncident } from "./storage.js";
import { simulateEvent } from "./websocket.js";

let selectedFilter = "ALL"; // ALL, ACTIVE, RESOLVED

/**
 * Initialize Incidents Screen
 */
export function initIncidents() {
  const container = document.getElementById("view-incidents");
  if (!container) return;

  renderIncidents();
  subscribe("incidents", () => renderIncidents());
}

/**
 * Render Incidents UI
 */
export function renderIncidents() {
  const container = document.getElementById("view-incidents");
  if (!container) return;

  const incidents = appState.incidents;
  const filtered = selectedFilter === "ALL" 
    ? incidents 
    : selectedFilter === "ACTIVE" 
    ? incidents.filter(i => i.status === "ACTIVE" || i.status === "RESPONDING" || i.status === "ACKNOWLEDGED")
    : incidents.filter(i => i.status === "RESOLVED");

  const activeCount = incidents.filter(i => i.status === "ACTIVE" || i.status === "RESPONDING").length;

  container.innerHTML = `
    <div style="max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem;">
      
      <!-- Top Status Header -->
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
        <div>
          <h2 style="font-size:1.3rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:0.5rem;">
            <span>Incidents & Emergency Distress Log</span>
            ${activeCount > 0 ? `<span class="nav-badge badge-danger">${activeCount} ACTIVE</span>` : ''}
          </h2>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">
            Decentralized peer incident telemetry and autonomous risk event logs.
          </p>
        </div>

        <div style="display:flex; gap:0.5rem;">
          <button class="btn-secondary filter-btn ${selectedFilter === 'ALL' ? 'active' : ''}" data-filter="ALL" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
            All (${incidents.length})
          </button>
          <button class="btn-secondary filter-btn ${selectedFilter === 'ACTIVE' ? 'active' : ''}" data-filter="ACTIVE" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
            Active (${activeCount})
          </button>
          <button class="btn-secondary filter-btn ${selectedFilter === 'RESOLVED' ? 'active' : ''}" data-filter="RESOLVED" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
            Resolved (${incidents.length - activeCount})
          </button>
        </div>
      </div>

      <!-- Incidents List -->
      <div id="incidents-list-container">
        ${filtered.length === 0 ? `
          <div class="lok-card" style="text-align:center; padding:3rem 1.5rem;">
            <div style="font-size:2rem; margin-bottom:0.5rem;">🛡️</div>
            <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-primary);">No Incidents in this category</h3>
            <p style="font-size:0.82rem; color:var(--text-muted); margin-top:0.35rem;">All peer nodes reporting nominal status. Trigger SOS or a simulation to test.</p>
          </div>
        ` : filtered.map(inc => renderIncidentCard(inc)).join('')}
      </div>

    </div>
  `;

  // Attach filter buttons
  container.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedFilter = btn.getAttribute("data-filter");
      renderIncidents();
    });
  });

  // Attach workflow buttons
  container.querySelectorAll(".btn-incident-action").forEach(btn => {
    btn.addEventListener("click", async () => {
      const incId = btn.getAttribute("data-inc-id");
      const nextStatus = btn.getAttribute("data-next-status");
      await updateIncidentWorkflow(incId, nextStatus);
    });
  });
}

/**
 * Render single incident card with complete visual timeline
 */
function renderIncidentCard(inc) {
  const isActive = inc.status === "ACTIVE" || inc.status === "RESPONDING";
  const dateStr = new Date(inc.timestamp).toLocaleString();

  return `
    <div class="lok-card incident-item-card ${isActive ? 'is-active-sos' : ''}" id="card-${inc.id}">
      
      <!-- Top Row -->
      <div class="incident-top-row">
        <div class="incident-title">
          <span>${isActive ? '🚨' : '✓'}</span>
          <span>${inc.title}</span>
          <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--color-cyan);">${inc.id}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span class="incident-badge-type" style="background:${getStatusBg(inc.status)}; color:${getStatusColor(inc.status)}">
            ${inc.status}
          </span>
          <span class="risk-level-pill risk-level-${inc.riskLevel.toLowerCase()}" style="font-size:0.7rem; padding:0.15rem 0.5rem;">
            ${inc.riskLevel} (${inc.riskScore}/100)
          </span>
        </div>
      </div>

      <!-- Telemetry Meta Details -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.6rem; padding:0.75rem; background-color:var(--bg-surface); border-radius:var(--radius-sm); border:1px solid var(--border-subtle); font-size:0.78rem;">
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.68rem; text-transform:uppercase;">Source Node</span>
          <strong style="font-family:var(--font-mono); color:var(--text-primary);">${inc.sourceDevice}</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.68rem; text-transform:uppercase;">Zone</span>
          <strong style="color:var(--text-primary);">${inc.zone || 'Campus Area'}</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.68rem; text-transform:uppercase;">GPS Location</span>
          <strong style="font-family:var(--font-mono); color:var(--text-primary);">${inc.lat.toFixed(4)}, ${inc.lng.toFixed(4)}</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.68rem; text-transform:uppercase;">Sensors</span>
          <strong style="font-family:var(--font-mono); color:var(--text-primary);">${inc.temperature}°C • ${inc.humidity}% RH</strong>
        </div>
        <div>
          <span style="color:var(--text-muted); display:block; font-size:0.68rem; text-transform:uppercase;">Timestamp</span>
          <strong style="color:var(--text-primary);">${dateStr}</strong>
        </div>
      </div>

      <!-- Visual Stage Progression Timeline -->
      <div class="incident-timeline">
        <div class="timeline-step completed">
          <div class="timeline-dot"></div>
          <span class="timeline-label">DETECTED</span>
        </div>
        <div class="timeline-step completed">
          <div class="timeline-dot"></div>
          <span class="timeline-label">RISK ASSESSED</span>
        </div>
        <div class="timeline-step completed">
          <div class="timeline-dot"></div>
          <span class="timeline-label">ALERT GENERATED</span>
        </div>
        <div class="timeline-step ${inc.status !== 'ACTIVE' ? 'completed' : 'current'}">
          <div class="timeline-dot"></div>
          <span class="timeline-label">PEER NOTIFIED</span>
        </div>
        <div class="timeline-step ${inc.status === 'RESOLVED' ? 'completed' : inc.status === 'RESPONDING' ? 'current' : ''}">
          <div class="timeline-dot"></div>
          <span class="timeline-label">RESPONSE</span>
        </div>
      </div>

      <!-- Action Workflow Controls -->
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.6rem; border-top:1px solid var(--border-subtle); padding-top:0.75rem;">
        ${inc.status === 'ACTIVE' ? `
          <button class="btn-secondary btn-incident-action" data-inc-id="${inc.id}" data-next-status="ACKNOWLEDGED" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
            Acknowledge
          </button>
          <button class="btn-primary btn-incident-action" data-inc-id="${inc.id}" data-next-status="RESPONDING" style="font-size:0.78rem; padding:0.4rem 0.8rem;">
            Mark Responding
          </button>
        ` : inc.status === 'ACKNOWLEDGED' || inc.status === 'RESPONDING' ? `
          <button class="btn-primary btn-incident-action" data-inc-id="${inc.id}" data-next-status="RESOLVED" style="font-size:0.78rem; padding:0.4rem 0.8rem; background:linear-gradient(135deg, #10b981 0%, #059669 100%);">
            ✓ Mark Resolved
          </button>
        ` : `
          <span style="font-size:0.75rem; color:var(--color-safe); font-weight:700;">✓ Incident Resolved & Logged</span>
        `}
      </div>

    </div>
  `;
}

/**
 * Handle progression of incident status
 */
async function updateIncidentWorkflow(incidentId, newStatus) {
  const updated = appState.incidents.map(inc => {
    if (inc.id === incidentId) {
      const isResolved = newStatus === "RESOLVED";
      return {
        ...inc,
        status: newStatus,
        riskLevel: isResolved ? "LOW" : inc.riskLevel,
        timeline: inc.timeline.map((step, idx) => {
          if (idx === 4 && isResolved) return { ...step, completed: true, time: Date.now() };
          return step;
        })
      };
    }
    return inc;
  });

  updateState("incidents", updated);

  const currentInc = updated.find(i => i.id === incidentId);
  if (currentInc) {
    await saveIncident(currentInc);

    // If resolving local device SOS, restore nominal state
    if (newStatus === "RESOLVED" && currentInc.sourceDevice === appState.device.id) {
      updateState("device", { ...appState.device, status: "ONLINE" });
      updateState("risk", {
        level: "LOW",
        score: 12,
        reasons: ["Incident resolved", "Nominal perimeter verified"],
        timestamp: Date.now()
      });
      const banner = document.getElementById("emergency-banner");
      if (banner) banner.classList.remove("visible");
    }
  }
}

function getStatusBg(status) {
  switch (status) {
    case "ACTIVE": return "var(--color-restricted-bg)";
    case "ACKNOWLEDGED": return "var(--color-caution-bg)";
    case "RESPONDING": return "var(--color-cyan-bg)";
    case "RESOLVED": return "var(--color-safe-bg)";
    default: return "var(--bg-surface-raised)";
  }
}

function getStatusColor(status) {
  switch (status) {
    case "ACTIVE": return "var(--color-restricted)";
    case "ACKNOWLEDGED": return "var(--color-caution)";
    case "RESPONDING": return "var(--color-cyan)";
    case "RESOLVED": return "var(--color-safe)";
    default: return "var(--text-primary)";
  }
}
