/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Safety Map Module
 * Offline-architected Leaflet geospatial visualization for peers, zones, and SOS beacons
 */

import { appState, subscribe } from "./state.js";
import { initialMockData } from "./mock-data.js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import vectorTileLayer from "leaflet-vector-tile-layer";
import { createOfflineVectorLabelLayer } from "./map-labels.js";

let mapInstance = null;
let currentDeviceMarker = null;
let nodeMarkersMap = new Map();
let zoneLayersGroup = null;
let nodeMarkersGroup = null;
let incidentMarkersGroup = null;
let labelLayerInstance = null;
let mapLayoutRendered = false;
let mapSubscriptionsBound = false;
let mapControlsBound = false;

/**
 * Tile Layer Abstraction
 * Allows seamless offline substitution: Carto/OSM -> Local Cache Tiles -> Canvas Grid
 */
export function createMapTileLayer() {
  const tileUrl = "/assets/maps/mumbai/{z}/{x}/{y}.pbf";

  const layer = vectorTileLayer(tileUrl, {
    minZoom: 10,
    maxZoom: 14,
    minDetailZoom: 10,
    maxDetailZoom: 14,
    layers: [
      "water",
      "landcover",
      "landuse",
      "park",
      "building",
      "waterway",
      "transportation",
      "boundary",
      "aeroway",
      "place",
      "transportation_name",
      "water_name",
      "poi",
      "aerodrome_label",
      "housenumber"
    ],
    style: (feature, layerName, zoom) => {
      const p = feature?.properties || {};

      if (layerName === "water" || layerName === "waterway" || layerName === "water_name") {
        return {
          color: "#2563eb",
          weight: layerName === "waterway" ? (zoom >= 13 ? 2.0 : 1.2) : 0.8,
          opacity: 0.9,
          fillColor: "#0b2942",
          fillOpacity: 0.95
        };
      }

      if (layerName === "landcover" || layerName === "landuse" || layerName === "park") {
        return {
          color: "#1f3a35",
          weight: 0.4,
          opacity: 0.7,
          fillColor: layerName === "park" ? "#12352b" : "#172c2b",
          fillOpacity: 0.85
        };
      }

      if (layerName === "building") {
        return {
          color: zoom >= 14 ? "#475569" : "#334155",
          weight: zoom >= 14 ? 0.6 : 0.35,
          opacity: 0.85,
          fillColor: "#1e293b",
          fillOpacity: zoom >= 14 ? 0.75 : 0.6
        };
      }

      if (layerName === "transportation") {
        const roadClass = p.class || p.subclass;
        const major = ["motorway", "trunk", "primary"].includes(roadClass);
        const secondary = ["secondary", "tertiary"].includes(roadClass);
        const weight = major
          ? (zoom >= 13 ? 3.5 : 2.2)
          : secondary
          ? (zoom >= 13 ? 2.2 : 1.2)
          : (zoom >= 14 ? 1.4 : 0.8);
        return {
          color: major ? "#cbd5e1" : secondary ? "#94a3b8" : "#64748b",
          weight: weight,
          opacity: major ? 0.95 : secondary ? 0.85 : 0.65,
          fillOpacity: 0
        };
      }

      if (layerName === "boundary") {
        return {
          color: "#475569",
          weight: 0.7,
          opacity: 0.65,
          dashArray: "4 4",
          fillOpacity: 0
        };
      }

      if (layerName === "place" || layerName === "poi" || layerName === "aerodrome_label") {
        return {
          color: "#94a3b8",
          weight: 1,
          opacity: 0.9,
          fillColor: "#94a3b8",
          fillOpacity: 0.35,
          radius: zoom >= 13 ? 3 : 2
        };
      }

      return {
        color: "#64748b",
        weight: 0.7,
        opacity: 0.55,
        fillColor: "#334155",
        fillOpacity: 0.2
      };
    }
  });

  layer.on("tileerror", (event) => {
    console.warn("[LOKRAKSHA] Local vector tile unavailable:", event?.coords);
    updateOfflineMapStatus();
  });

  layer.on("load", () => {
    updateOfflineMapStatus(true);
  });

  return layer;
}

let offlineStatusBound = false;

function updateOfflineMapStatus(ready = null) {
  const badge = document.getElementById("offline-map-status");
  if (!badge) return;

  const offline = !navigator.onLine;
  if (ready === false) {
    badge.textContent = "⚠️ Offline Map Data Missing";
    badge.dataset.state = "error";
    return;
  }

  if (offline) {
    badge.textContent = "📴 Offline Mode";
    badge.dataset.state = "offline";
  } else {
    badge.textContent = "🟢 Offline Map Ready";
    badge.dataset.state = "ready";
  }
}

function bindOfflineStatus() {
  if (offlineStatusBound) return;
  window.addEventListener("online", () => updateOfflineMapStatus());
  window.addEventListener("offline", () => updateOfflineMapStatus());
  offlineStatusBound = true;
  updateOfflineMapStatus();
}

/**
 * Initialize Safety Map view
 */
export function initSafetyMap() {
  const container = document.getElementById("view-map");
  if (!container) return;

  // Render the map DOM only once. Re-rendering the view would destroy
  // Leaflet's existing container and cause marker/layer references to break.
  if (!mapLayoutRendered) {
    renderMapLayout();
    mapLayoutRendered = true;
  }

  // Leaflet should only be initialized when the map view is visible.
  // When returning to the map, reuse the same instance and recalculate size.
  if (container.classList.contains("active")) {
    if (!mapInstance) {
      setupLeafletMap();
    } else {
      requestAnimationFrame(() => {
        mapInstance.invalidateSize();
      });
    }
  }

  // State subscriptions must be registered exactly once.
  if (!mapSubscriptionsBound) {
    subscribe("telemetry", () => updateCurrentDeviceLocation());
    subscribe("nodes", () => updatePeerNodeMarkers());
    subscribe("incidents", () => updateIncidentMarkers());
    mapSubscriptionsBound = true;
  }
}

/**
 * Render Map DOM container & Floating Controls
 */
export function renderMapLayout() {
  const container = document.getElementById("view-map");
  if (!container) return;

  container.innerHTML = `
    <div class="map-view-wrapper">
      <div id="map"></div>

      <!-- Floating Map Layer & Info Control Panel -->
      <div class="map-floating-panel">
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:0.4rem;">
          <div style="font-size:0.85rem; font-weight:800; color:var(--color-cyan); display:flex; align-items:center; gap:0.4rem;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
            MAP LAYERS
          </div>
          <button id="map-recenter-btn" class="btn-secondary" style="font-size:0.7rem; padding:0.2rem 0.5rem;" title="Recenter on Local Node">
            ⊙ Recenter
          </button>
        </div>

        <div id="offline-map-status" class="map-offline-status" data-state="ready">🟢 Offline Map Ready</div>

        <label class="map-layer-toggle">
          <span>Map Name Labels</span>
          <input type="checkbox" id="layer-toggle-labels" checked>
        </label>
        <label class="map-layer-toggle">
          <span>Safety Geo-Zones</span>
          <input type="checkbox" id="layer-toggle-zones" checked>
        </label>
        <label class="map-layer-toggle">
          <span>Nearby Peer Nodes</span>
          <input type="checkbox" id="layer-toggle-nodes" checked>
        </label>
        <label class="map-layer-toggle">
          <span>Distress / SOS Markers</span>
          <input type="checkbox" id="layer-toggle-incidents" checked>
        </label>

        <!-- Visual Legend -->
        <div class="map-legend">
          <div class="legend-item">
            <div class="legend-dot" style="background:#06b6d4; box-shadow:0 0 6px #06b6d4;"></div>
            <span>Local Device (LKRK-001)</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--color-safe);"></div>
            <span>Safe Peer Node / Zone</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--color-caution);"></div>
            <span>Caution Zone / Warning</span>
          </div>
          <div class="legend-item">
            <div class="legend-dot" style="background:var(--color-restricted);"></div>
            <span>Restricted Zone / SOS Alert</span>
          </div>
        </div>
      </div>
    </div>
  `;

  bindOfflineStatus();

  document.getElementById("map-recenter-btn")?.addEventListener("click", () => {
    if (mapInstance && appState.telemetry) {
      mapInstance.setView([appState.telemetry.lat, appState.telemetry.lng], 14);
    }
  });
}

/**
 * Setup Leaflet Map Instance
 */
function setupLeafletMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  // Never create a second Leaflet instance for the same application view.
  if (mapInstance) {
    requestAnimationFrame(() => mapInstance.invalidateSize());
    return;
  }

  const initialLat = Number(appState.telemetry?.lat) || 19.0760;
  const initialLng = Number(appState.telemetry?.lng) || 72.8777;

  mapInstance = L.map(mapEl, {
    center: [initialLat, initialLng],
    zoom: 12,
    minZoom: 10,
    maxZoom: 14,
    maxBounds: [[18.75, 72.65], [19.4, 73.15]],
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    attributionControl: false
  });

  L.control.zoom({ position: "topleft" }).addTo(mapInstance);

  const tileLayer = createMapTileLayer();
  tileLayer.addTo(mapInstance);

  // Offline Vector Label Layer (sits in labelsPane zIndex 250 above base tiles and below safety overlays)
  labelLayerInstance = createOfflineVectorLabelLayer();
  labelLayerInstance.addTo(mapInstance);

  // Keep each logical layer in its own group so visibility toggles are reliable.
  zoneLayersGroup = L.layerGroup().addTo(mapInstance);
  nodeMarkersGroup = L.layerGroup().addTo(mapInstance);
  incidentMarkersGroup = L.layerGroup().addTo(mapInstance);

  drawSafetyZones();
  updateCurrentDeviceLocation();
  updatePeerNodeMarkers();
  updateIncidentMarkers();

  if (!mapControlsBound) {
    document.getElementById("layer-toggle-labels")?.addEventListener("change", (e) => {
      if (!mapInstance || !labelLayerInstance) return;
      if (e.target.checked) mapInstance.addLayer(labelLayerInstance);
      else mapInstance.removeLayer(labelLayerInstance);
    });

    document.getElementById("layer-toggle-zones")?.addEventListener("change", (e) => {
      if (!mapInstance || !zoneLayersGroup) return;
      if (e.target.checked) mapInstance.addLayer(zoneLayersGroup);
      else mapInstance.removeLayer(zoneLayersGroup);
    });

    document.getElementById("layer-toggle-nodes")?.addEventListener("change", (e) => {
      if (!mapInstance || !nodeMarkersGroup) return;
      if (e.target.checked) mapInstance.addLayer(nodeMarkersGroup);
      else mapInstance.removeLayer(nodeMarkersGroup);
    });

    document.getElementById("layer-toggle-incidents")?.addEventListener("change", (e) => {
      if (!mapInstance || !incidentMarkersGroup) return;
      if (e.target.checked) mapInstance.addLayer(incidentMarkersGroup);
      else mapInstance.removeLayer(incidentMarkersGroup);
    });

    mapControlsBound = true;
  }

  // Hidden-to-visible transitions can leave Leaflet with stale dimensions.
  requestAnimationFrame(() => mapInstance?.invalidateSize());
}

/**
 * Render designated geographic safety zones
 */
function drawSafetyZones() {
  if (!zoneLayersGroup) return;
  zoneLayersGroup.clearLayers();

  const zones = initialMockData.zones;

  zones.forEach(zone => {
    let color = "#10b981";
    let fillColor = "#10b981";

    if (zone.type === "CAUTION") {
      color = "#f59e0b";
      fillColor = "#f59e0b";
    } else if (zone.type === "RESTRICTED") {
      color = "#ef4444";
      fillColor = "#ef4444";
    }

    const circle = L.circle([zone.lat, zone.lng], {
      radius: zone.radius,
      color: color,
      weight: 2,
      fillColor: fillColor,
      fillOpacity: zone.type === "RESTRICTED" ? 0.22 : 0.14,
      dashArray: zone.type === "CAUTION" ? "6, 6" : null
    });

    circle.bindPopup(`
      <div class="map-popup-card">
        <div class="map-popup-header" style="color:${color};">
          ${zone.type === 'SAFE' ? '🟢' : zone.type === 'CAUTION' ? '🟡' : '🔴'} ${zone.name}
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">
          ${zone.description}
        </div>
        <div class="map-popup-stat" style="margin-top:6px;">
          <span>Perimeter Radius:</span>
          <strong>${zone.radius}m</strong>
        </div>
      </div>
    `);

    zoneLayersGroup.addLayer(circle);
  });
}

/**
 * Update / Draw Local Device Marker with radar pulsing halo
 */
function updateCurrentDeviceLocation() {
  if (!mapInstance) return;

  const lat = appState.telemetry.lat;
  const lng = appState.telemetry.lng;
  const isSos = appState.device.status === "SOS";

  const deviceHtml = `
    <div style="position:relative; width:36px; height:36px; display:flex; align-items:center; justify-content:center;">
      <div style="position:absolute; width:100%; height:100%; border-radius:50%; background:${isSos ? 'rgba(239, 68, 68, 0.4)' : 'rgba(6, 182, 212, 0.35)'}; animation:pulse-danger 2s infinite;"></div>
      <div style="width:16px; height:16px; border-radius:50%; background:${isSos ? '#ef4444' : '#06b6d4'}; border:3px solid #ffffff; box-shadow:0 0 10px ${isSos ? '#ef4444' : '#06b6d4'};"></div>
    </div>
  `;

  const customIcon = L.divIcon({
    html: deviceHtml,
    className: "custom-device-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  if (!currentDeviceMarker) {
    currentDeviceMarker = L.marker([lat, lng], { icon: customIcon, zIndexOffset: 1000 }).addTo(mapInstance);
  } else {
    currentDeviceMarker.setLatLng([lat, lng]);
    currentDeviceMarker.setIcon(customIcon);
  }

  currentDeviceMarker.bindPopup(`
    <div class="map-popup-card">
      <div class="map-popup-header">
        ★ ${appState.device.name} (${appState.device.id})
      </div>
      <div class="map-popup-stat">
        <span>Status:</span>
        <strong style="color:${isSos ? 'var(--color-restricted)' : 'var(--color-safe)'}">${appState.device.status}</strong>
      </div>
      <div class="map-popup-stat">
        <span>GPS Fix:</span>
        <strong>${appState.telemetry.gpsFix}</strong>
      </div>
      <div class="map-popup-stat">
        <span>Battery:</span>
        <strong>${appState.telemetry.battery}%</strong>
      </div>
      <div class="map-popup-stat">
        <span>Coordinates:</span>
        <strong style="font-family:var(--font-mono)">${lat.toFixed(5)}, ${lng.toFixed(5)}</strong>
      </div>
    </div>
  `);
}

/**
 * Draw or update nearby peer node markers
 */
function updatePeerNodeMarkers() {
  if (!mapInstance) return;

  const nodes = appState.nodes || [];

  // Remove peers that disappeared from application state.
  const activeIds = new Set(nodes.map(node => node.id));
  nodeMarkersMap.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      nodeMarkersGroup?.removeLayer(marker);
      nodeMarkersMap.delete(id);
    }
  });

  nodes.forEach(node => {
    const isSos = node.isSos || node.status === "SOS";
    const markerColor = isSos ? "#ef4444" : node.status === "ONLINE" ? "#10b981" : "#f59e0b";

    const nodeHtml = `
      <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
        <div style="width:12px; height:12px; border-radius:50%; background:${markerColor}; border:2px solid #ffffff; box-shadow:0 0 8px ${markerColor}; ${isSos ? 'animation:pulse-danger 1.5s infinite;' : ''}"></div>
      </div>
    `;

    const icon = L.divIcon({
      html: nodeHtml,
      className: "custom-node-marker",
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    let marker = nodeMarkersMap.get(node.id);

    if (!marker) {
      marker = L.marker([node.lat, node.lng], { icon: icon });
      nodeMarkersGroup?.addLayer(marker);
      nodeMarkersMap.set(node.id, marker);
    } else {
      marker.setLatLng([node.lat, node.lng]);
      marker.setIcon(icon);
    }

    marker.bindPopup(`
      <div class="map-popup-card">
        <div class="map-popup-header" style="color:${markerColor}">
          ● ${node.name} (${node.id})
        </div>
        <div class="map-popup-stat">
          <span>Status:</span>
          <strong style="color:${markerColor}">${node.status}</strong>
        </div>
        <div class="map-popup-stat">
          <span>LoRa RSSI:</span>
          <strong>${node.rssi} dBm</strong>
        </div>
        <div class="map-popup-stat">
          <span>Battery:</span>
          <strong>${node.battery}%</strong>
        </div>
        <button onclick="window.startDirectMessage && window.startDirectMessage('${node.id}')" style="margin-top:6px; background:var(--bg-surface-raised); border:1px solid var(--border-medium); color:var(--color-cyan); padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:700;">
          Send LoRa Message →
        </button>
      </div>
    `);
  });
}

/**
 * Draw distress and active incident beacons
 */
function updateIncidentMarkers() {
  if (!mapInstance || !incidentMarkersGroup) return;
  incidentMarkersGroup.clearLayers();

  const incidents = appState.incidents.filter(i => i.status === "ACTIVE" || i.status === "RESPONDING");

  incidents.forEach(inc => {
    const sosHtml = `
      <div style="position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center;">
        <div style="position:absolute; width:100%; height:100%; border-radius:50%; background:rgba(239, 68, 68, 0.5); animation:pulse-danger 1s infinite;"></div>
        <div style="width:20px; height:20px; border-radius:50%; background:#ef4444; color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; border:2px solid #fff;">!</div>
      </div>
    `;

    const icon = L.divIcon({
      html: sosHtml,
      className: "incident-distress-marker",
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const marker = L.marker([inc.lat, inc.lng], { icon: icon });
    marker.bindPopup(`
      <div class="map-popup-card">
        <div class="map-popup-header" style="color:var(--color-restricted)">
          🚨 ACTIVE INCIDENT: ${inc.title}
        </div>
        <div class="map-popup-stat">
          <span>Source Node:</span>
          <strong>${inc.sourceDevice}</strong>
        </div>
        <div class="map-popup-stat">
          <span>Risk Level:</span>
          <strong style="color:var(--color-restricted)">${inc.riskLevel} (${inc.riskScore}/100)</strong>
        </div>
        <div class="map-popup-stat">
          <span>Time:</span>
          <strong>${new Date(inc.timestamp).toLocaleTimeString()}</strong>
        </div>
      </div>
    `);

    incidentMarkersGroup.addLayer(marker);
  });
}
