/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Client View Router
 * Lightweight modular tab navigation without external frameworks
 */

import { updateState } from "./state.js";
import { initSafetyMap } from "./safety-map.js";

const routes = ["dashboard", "map", "incidents", "messages", "nodes", "identity", "settings"];

/**
 * Initialize Routing handlers
 */
export function initRouter() {
  // Navigation items click
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const target = item.getAttribute("data-view");
      if (target) navigateTo(target);

      // Close mobile sidebar if open
      document.getElementById("sidebar")?.classList.remove("mobile-open");
      document.getElementById("sidebar-backdrop")?.classList.remove("active");
    });
  });

  // Global navigation function
  window.navigateTo = navigateTo;

  // Respect a URL hash like #map or #incidents on initial load.
  const initialView = window.location.hash ? window.location.hash.replace("#", "") : "dashboard";
  window.addEventListener("hashchange", () => {
    const nextView = window.location.hash ? window.location.hash.replace("#", "") : "dashboard";
    if (routes.includes(nextView)) {
      navigateTo(nextView);
    }
  });

  // Initialize starting view
  navigateTo(routes.includes(initialView) ? initialView : "dashboard");
}

/**
 * Switch active view
 * @param {string} viewName
 */
export function navigateTo(viewName) {
  if (!routes.includes(viewName)) viewName = "dashboard";

  // Keep the URL and the active view in sync.
  const nextHash = viewName === "dashboard" ? "" : `#${viewName}`;
  if (window.location.hash !== nextHash) {
    if (nextHash) {
      window.history.replaceState(null, "", nextHash);
    } else {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  // 1. Update Navigation Menu highlight
  document.querySelectorAll(".nav-item").forEach(item => {
    if (item.getAttribute("data-view") === viewName) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // 2. Switch active DOM view section
  document.querySelectorAll(".view-section").forEach(sec => {
    sec.classList.remove("active");
  });

  const targetViewEl = document.getElementById(`view-${viewName}`);
  if (targetViewEl) {
    targetViewEl.classList.add("active");
  }

  // 3. Update Page Title
  const titleEl = document.getElementById("header-page-title");
  if (titleEl) {
    titleEl.textContent = getPageTitle(viewName);
  }

  // 4. Trigger view-specific re-renders / resizes
  if (viewName === "map") {
    // Initialize once if needed, otherwise just recalculate Leaflet's dimensions.
    requestAnimationFrame(() => {
      initSafetyMap();
      window.dispatchEvent(new Event("resize"));
    });
  }

  updateState("currentView", viewName);
}

function getPageTitle(viewName) {
  switch (viewName) {
    case "dashboard": return "Device Telemetry & Status";
    case "map": return "Safety Map & Geo-Perimeter";
    case "incidents": return "Incidents & SOS Distress";
    case "messages": return "Encrypted LoRa Messaging";
    case "nodes": return "Nearby Peer Mesh Nodes";
    case "identity": return "Digital Identity & Binding";
    case "settings": return "Device & Storage Settings";
    default: return "LOKRAKSHA Dashboard";
  }
}
