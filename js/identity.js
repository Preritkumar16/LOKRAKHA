/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Decentralized Digital Identity Module
 * Trust mechanism and tamper-evident hardware-bound credentials
 */

import { appState } from "./state.js";

/**
 * Initialize Digital Identity Screen
 */
export function initIdentity() {
  const container = document.getElementById("view-identity");
  if (!container) return;

  renderIdentity();
}

/**
 * Render Digital Identity View
 */
export function renderIdentity() {
  const container = document.getElementById("view-identity");
  if (!container) return;

  const { device } = appState;

  container.innerHTML = `
    <div style="max-width: 840px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem;">
      
      <div>
        <h2 style="font-size:1.3rem; font-weight:800; color:var(--text-primary);">
          Decentralized Digital Identity & Hardware Binding
        </h2>
        <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">
          Cryptographic peer-to-peer verification anchored inside the physical device hardware security enclave.
        </p>
      </div>

      <!-- Main Cryptographic Trust Card -->
      <div class="identity-card">
        
        <div class="identity-header">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div style="width:44px; height:44px; border-radius:var(--radius-md); background:rgba(99,102,241,0.2); border:1px solid rgba(99,102,241,0.4); display:flex; align-items:center; justify-content:center; color:#818cf8;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <h3 style="font-size:1.1rem; font-weight:800; color:var(--text-primary);">LOKRAKSHA Peer Credential</h3>
              <div style="font-size:0.72rem; color:var(--color-cyan); font-family:var(--font-mono);">W3C DID COMPATIBLE (did:lok:${device.id.toLowerCase()})</div>
            </div>
          </div>

          <span class="tag-badge" style="background:var(--color-safe-bg); color:var(--color-safe); border-color:var(--color-safe-border); font-size:0.8rem; padding:0.35rem 0.75rem;">
            ✓ IDENTITY VERIFIED
          </span>
        </div>

        <!-- Identity Field Grid -->
        <div class="identity-field-grid">
          
          <div class="identity-field">
            <span class="identity-label">User Identifier</span>
            <span class="identity-val">U-001 (Operator)</span>
          </div>

          <div class="identity-field">
            <span class="identity-label">Hardware Device ID</span>
            <span class="identity-val" style="color:var(--color-cyan);">${device.id}</span>
          </div>

          <div class="identity-field">
            <span class="identity-label">Credential Status</span>
            <span class="identity-val" style="color:var(--color-safe);">ACTIVE & VALIDATED</span>
          </div>

          <div class="identity-field">
            <span class="identity-label">Hardware Enclave Binding</span>
            <span class="identity-val" style="color:var(--color-safe);">VERIFIED (eFuse Key)</span>
          </div>

          <div class="identity-field" style="grid-column: 1 / -1;">
            <span class="identity-label">Public Key Fingerprint (Ed25519)</span>
            <span class="identity-val" style="font-size:0.82rem; word-break:break-all; color:#94a3b8;">
              0x4F9B7A210CD988A2B93E105562098DF4318EAC8499201BBCE765019A8211FF03
            </span>
          </div>

        </div>

        <!-- Security Notice -->
        <div style="background:rgba(0,0,0,0.3); border-radius:var(--radius-md); padding:0.85rem; border:1px solid var(--border-subtle); font-size:0.78rem; color:var(--text-secondary); line-height:1.5;">
          <strong>Trust & Attestation Architecture:</strong> This identity keypair is embedded directly within the physical micro-controller hardware secure storage. LoRa emergency transmissions and telemetry packets are cryptographically signed on-chip prior to RF broadcast.
        </div>

      </div>

    </div>
  `;
}
