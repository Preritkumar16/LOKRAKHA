/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Decentralized LoRa Messaging Module
 * Direct peer-to-peer and emergency broadcast communications
 */

import { appState, subscribe } from "./state.js";
import { simulateEvent } from "./websocket.js";

let currentSelectedRecipient = "BROADCAST"; // BROADCAST or specific Node ID

/**
 * Initialize Messaging Interface
 */
export function initMessages() {
  const container = document.getElementById("view-messages");
  if (!container) return;

  // Make helper globally accessible for cross-view navigation
  window.startDirectMessage = (nodeId) => {
    currentSelectedRecipient = nodeId;
    window.navigateTo?.("messages");
    renderMessages();
  };

  renderMessages();
  subscribe("messages", () => updateChatScroll());
}

/**
 * Render Messaging Interface
 */
export function renderMessages() {
  const container = document.getElementById("view-messages");
  if (!container) return;

  const { messages, nodes, device } = appState;
  const filteredMessages = currentSelectedRecipient === "BROADCAST"
    ? messages.filter(m => m.type === "BROADCAST" || m.to === "BROADCAST" || m.priority === "SOS")
    : messages.filter(m => (m.from === currentSelectedRecipient && m.to === device.id) || (m.from === device.id && m.to === currentSelectedRecipient));

  container.innerHTML = `
    <div class="messaging-container">
      
      <!-- Left Sidebar: Channels & Peer Threads -->
      <div class="chat-sidebar">
        <div class="chat-search-header">
          <div style="font-size:0.75rem; font-weight:800; color:var(--color-cyan); text-transform:uppercase; letter-spacing:0.5px;">
            LORA CHANNELS
          </div>
        </div>

        <div class="chat-peer-list">
          <!-- Broadcast Channel -->
          <div class="chat-peer-item ${currentSelectedRecipient === 'BROADCAST' ? 'active' : ''}" data-recipient="BROADCAST">
            <div style="display:flex; align-items:center; gap:0.6rem;">
              <span style="font-size:1.1rem;">📢</span>
              <div>
                <strong style="font-size:0.85rem; color:var(--text-primary);">All Nearby Peers</strong>
                <div style="font-size:0.68rem; color:var(--color-cyan);">BROADCAST (868.1 MHz)</div>
              </div>
            </div>
          </div>

          <!-- Peer List Header -->
          <div style="padding:0.6rem 0.85rem 0.2rem; font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">
            Direct Nodes (${nodes.length})
          </div>

          <!-- Individual Peers -->
          ${nodes.map(node => `
            <div class="chat-peer-item ${currentSelectedRecipient === node.id ? 'active' : ''}" data-recipient="${node.id}">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <div class="status-dot ${node.isSos ? 'status-restricted' : 'status-safe'}"></div>
                <div>
                  <strong style="font-family:var(--font-mono); font-size:0.82rem; color:var(--text-primary);">${node.id}</strong>
                  <div style="font-size:0.68rem; color:var(--text-secondary);">${node.name}</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Right Main Chat Area -->
      <div class="chat-main">
        
        <!-- Header -->
        <div class="chat-main-header">
          <div>
            <h3 style="font-size:0.95rem; font-weight:800; color:var(--text-primary);">
              ${currentSelectedRecipient === 'BROADCAST' ? '📢 LoRa Mesh Broadcast Channel' : `🔒 Direct Peer Session: ${currentSelectedRecipient}`}
            </h3>
            <div style="font-size:0.7rem; color:var(--text-secondary);">
              Transmitting from: <strong style="font-family:var(--font-mono)">${device.id}</strong> • LoRa SF7 / BW 125kHz
            </div>
          </div>
          <span class="tag-badge tag-lora">ECC-256 HARDWARE SIGNED</span>
        </div>

        <!-- Messages Scroll Container -->
        <div class="chat-messages-scroll" id="chat-messages-scroll">
          ${filteredMessages.length === 0 ? `
            <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.82rem;">
              No messages exchanged on this channel yet.<br>Send a packet to initiate peer mesh communication.
            </div>
          ` : filteredMessages.map(msg => renderMessageBubble(msg, device.id)).join('')}
        </div>

        <!-- Chat Input Row -->
        <div class="chat-input-row">
          <form class="chat-form" id="chat-send-form">
            <input 
              type="text" 
              class="chat-input" 
              id="chat-text-input" 
              placeholder="${currentSelectedRecipient === 'BROADCAST' ? 'Type broadcast to all nearby nodes...' : `Send direct message to ${currentSelectedRecipient}...`}"
              autocomplete="off"
              required
            />
            <select id="chat-priority-select" style="background:var(--bg-surface-raised); border:1px solid var(--border-medium); color:var(--text-primary); border-radius:var(--radius-md); padding:0 0.5rem; font-size:0.75rem;">
              <option value="NORMAL">Normal</option>
              <option value="URGENT">Urgent</option>
              <option value="SOS">SOS Distress</option>
            </select>
            <button type="submit" class="chat-send-btn">
              Send LoRa
            </button>
          </form>

          <div class="chat-security-disclaimer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Encrypted by LOKRAKSHA device before LoRa transmission.</span>
          </div>
        </div>

      </div>

    </div>
  `;

  // Attach channel switches
  container.querySelectorAll(".chat-peer-item").forEach(item => {
    item.addEventListener("click", () => {
      currentSelectedRecipient = item.getAttribute("data-recipient");
      renderMessages();
    });
  });

  // Attach submit handler
  document.getElementById("chat-send-form")?.addEventListener("submit", handleSendMessage);

  updateChatScroll();
}

function renderMessageBubble(msg, localDeviceId) {
  const isSent = msg.from === localDeviceId;
  const isSos = msg.priority === "SOS" || msg.type === "SOS";
  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return `
    <div class="chat-bubble ${isSos ? 'msg-sos' : isSent ? 'msg-sent' : 'msg-received'}">
      <div style="font-size:0.72rem; font-weight:700; color:${isSos ? '#ffdddd' : isSent ? 'var(--color-cyan)' : 'var(--text-secondary)'}; font-family:var(--font-mono);">
        ${isSent ? `YOU (${localDeviceId}) → ${msg.to}` : `FROM: ${msg.from}`}
      </div>
      <div style="font-size:0.88rem; line-height:1.4;">
        ${msg.text}
      </div>
      <div class="msg-meta">
        <span>${timeStr}</span>
        <span>${isSent ? `✓ ${msg.status || 'DELIVERED'}` : 'VERIFIED'}</span>
      </div>
    </div>
  `;
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById("chat-text-input");
  const prioritySel = document.getElementById("chat-priority-select");
  if (!input || !input.value.trim()) return;

  const text = input.value.trim();
  const priority = prioritySel ? prioritySel.value : "NORMAL";
  const to = currentSelectedRecipient;

  // Trigger event through simulator / WebSocket architecture
  simulateEvent("MESSAGE_RECEIVED", {
    id: "msg_" + Date.now(),
    from: appState.device.id,
    to: to,
    type: to === "BROADCAST" ? "BROADCAST" : "DIRECT",
    text: text,
    priority: priority
  });

  input.value = "";
  renderMessages();
}

function updateChatScroll() {
  const scrollContainer = document.getElementById("chat-messages-scroll");
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
}
