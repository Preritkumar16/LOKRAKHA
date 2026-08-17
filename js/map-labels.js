/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Offline Vector Map Label Layer
 * Fully offline, zoom-responsive vector label rendering for Leaflet (z10 - z14)
 * Extracted directly from local OpenMapTiles PBF vector tiles
 */

import L from "leaflet";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

/**
 * Coordinate conversion: Tile relative coordinates to Latitude/Longitude
 */
export function tileToLatLng(featX, featY, extent, z, x, y) {
  const tileX = x + featX / extent;
  const tileY = y + featY / extent;
  const n = Math.pow(2, z);
  const lon = (tileX / n) * 360.0 - 180.0;
  const latRad = Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * tileY / n)));
  const lat = (latRad * 180.0) / Math.PI;
  return { lat, lng: lon };
}

/**
 * Coordinate conversion: Latitude/Longitude to Tile coordinates
 */
export function latLngToTile(lat, lng, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180.0) / 360.0) * n);
  const latRad = (lat * Math.PI) / 180.0;
  const y = Math.floor(
    ((1.0 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2.0) * n
  );
  return { x, y };
}

/**
 * Extract preferred name property from feature properties
 */
function getFeatureName(props) {
  if (!props) return null;
  const name =
    props.name ||
    props["name:en"] ||
    props.name_en ||
    props["name:latin"] ||
    props.name_int ||
    props.ref;
  if (!name || typeof name !== "string") return null;
  return name.trim();
}

/**
 * Fast polygon centroid calculation
 */
function getPolygonCentroid(latlngs) {
  if (!latlngs || latlngs.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (let i = 0; i < latlngs.length; i++) {
    sumLat += latlngs[i].lat;
    sumLng += latlngs[i].lng;
  }
  return {
    lat: sumLat / latlngs.length,
    lng: sumLng / latlngs.length
  };
}

/**
 * Leaflet Layer for Offline Vector Map Labels
 */
export const OfflineVectorLabelLayer = L.Layer.extend({
  options: {
    pane: "labelsPane",
    zIndex: 250,
    minZoom: 10,
    maxZoom: 14,
    tileUrlPattern: "/assets/maps/mumbai/{z}/{x}/{y}.pbf",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },

  initialize: function (options) {
    L.setOptions(this, options);
    this._canvas = null;
    this._ctx = null;
    this._tileCache = new Map();
    this._fetchingTiles = new Set();
    this._animFrame = null;
    this._needsRedraw = true;
  },

  onAdd: function (map) {
    this._map = map;

    let pane = map.getPane(this.options.pane);
    if (!pane) {
      pane = map.createPane(this.options.pane);
      pane.style.zIndex = String(this.options.zIndex);
      pane.style.pointerEvents = "none";
    }

    this._canvas = L.DomUtil.create(
      "canvas",
      "leaflet-offline-vector-labels",
      pane
    );
    this._canvas.style.position = "absolute";
    this._canvas.style.left = "0";
    this._canvas.style.top = "0";
    this._canvas.style.pointerEvents = "none";
    this._ctx = this._canvas.getContext("2d");

    map.on("move", this._onMove, this);
    map.on("moveend", this._onMoveEnd, this);
    map.on("resize", this._onResize, this);
    map.on("zoom", this._onZoom, this);
    map.on("zoomend", this._onZoomEnd, this);
    map.on("viewreset", this._onViewReset, this);

    this._resetCanvas();
    this._update();
  },

  onRemove: function (map) {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }

    map.off("move", this._onMove, this);
    map.off("moveend", this._onMoveEnd, this);
    map.off("resize", this._onResize, this);
    map.off("zoom", this._onZoom, this);
    map.off("zoomend", this._onZoomEnd, this);
    map.off("viewreset", this._onViewReset, this);

    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
  },

  _onMove: function () {
    this._positionCanvas();
    this._scheduleRedraw();
  },

  _onMoveEnd: function () {
    this._positionCanvas();
    this._update();
  },

  _onResize: function () {
    this._resetCanvas();
    this._update();
  },

  _onZoom: function () {
    this._positionCanvas();
    this._scheduleRedraw();
  },

  _onZoomEnd: function () {
    this._resetCanvas();
    this._update();
  },

  _onViewReset: function () {
    this._resetCanvas();
    this._update();
  },

  _resetCanvas: function () {
    if (!this._map || !this._canvas) return;

    const size = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;

    this._canvas.width = Math.max(1, Math.round(size.x * dpr));
    this._canvas.height = Math.max(1, Math.round(size.y * dpr));
    this._canvas.style.width = `${size.x}px`;
    this._canvas.style.height = `${size.y}px`;

    this._ctx = this._canvas.getContext("2d");
    if (this._ctx) {
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this._positionCanvas();
  },

  _positionCanvas: function () {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
  },

  _scheduleRedraw: function () {
    if (this._animFrame) return;
    this._animFrame = requestAnimationFrame(() => {
      this._animFrame = null;
      this._render();
    });
  },

  _update: function () {
    if (!this._map) return;

    const currentZoom = this._map.getZoom();
    const tileZoom = Math.min(14, Math.max(10, Math.floor(currentZoom)));
    const bounds = this._map.getBounds();

    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    const minTile = latLngToTile(nw.lat, nw.lng, tileZoom);
    const maxTile = latLngToTile(se.lat, se.lng, tileZoom);

    const minX = Math.min(minTile.x, maxTile.x) - 1;
    const maxX = Math.max(minTile.x, maxTile.x) + 1;
    const minY = Math.min(minTile.y, maxTile.y) - 1;
    const maxY = Math.max(minTile.y, maxTile.y) + 1;

    let tilesToFetch = [];

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${tileZoom}/${x}/${y}`;
        if (!this._tileCache.has(key) && !this._fetchingTiles.has(key)) {
          tilesToFetch.push({ z: tileZoom, x, y, key });
        }
      }
    }

    if (tilesToFetch.length > 0) {
      tilesToFetch.forEach((t) => this._loadTile(t.z, t.x, t.y, t.key));
    }

    this._render();
  },

  _loadTile: async function (z, x, y, key) {
    this._fetchingTiles.add(key);
    const url = `/assets/maps/mumbai/${z}/${x}/${y}.pbf`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        this._tileCache.set(key, null);
        this._fetchingTiles.delete(key);
        return;
      }

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        // SPA router fallback returned index.html for non-existent tile
        this._tileCache.set(key, null);
        this._fetchingTiles.delete(key);
        return;
      }

      const buffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      if (uint8.length < 10 || uint8[0] === 0x3c) {
        // Not a binary protobuf file
        this._tileCache.set(key, null);
        this._fetchingTiles.delete(key);
        return;
      }

      const pbf = new Pbf(uint8);
      const vectorTile = new VectorTile(pbf);

      const features = this._extractTileFeatures(vectorTile, z, x, y);
      this._tileCache.set(key, features);
    } catch (err) {
      this._tileCache.set(key, null);
    } finally {
      this._fetchingTiles.delete(key);
      this._scheduleRedraw();
    }
  },

  _extractTileFeatures: function (tile, z, x, y) {
    const features = [];
    const layers = tile.layers;

    // 1. PLACE LABELS (cities, suburbs, towns, localities, neighbourhoods, islands, villages)
    if (layers.place) {
      const l = layers.place;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || !geom[0][0]) continue;
        const pt = geom[0][0];

        // Deduplicate cross-tile buffering: only accept points originating in this tile extent
        if (pt.x < 0 || pt.x >= l.extent || pt.y < 0 || pt.y >= l.extent)
          continue;

        const coords = tileToLatLng(pt.x, pt.y, l.extent, z, x, y);
        const fClass = f.properties.class || "suburb";
        const rank = typeof f.properties.rank === "number" ? f.properties.rank : 20;

        features.push({
          type: "place",
          name,
          fClass,
          rank,
          lat: coords.lat,
          lng: coords.lng
        });
      }
    }

    // 2. TRANSPORTATION NAME LABELS (highways, expressways, major roads, streets)
    if (layers.transportation_name) {
      const l = layers.transportation_name;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const fClass = f.properties.class || "road";
        const geom = f.loadGeometry();
        if (!geom || geom.length === 0) continue;

        geom.forEach((line) => {
          if (!line || line.length < 2) return;
          const latlngs = line.map((p) =>
            tileToLatLng(p.x, p.y, l.extent, z, x, y)
          );
          features.push({
            type: "road",
            name,
            fClass,
            latlngs
          });
        });
      }
    }

    // 3. WATERWAY & WATER NAMES (rivers, creeks, canals, lakes)
    if (layers.waterway) {
      const l = layers.waterway;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || geom.length === 0) continue;

        geom.forEach((line) => {
          if (!line || line.length < 2) return;
          const latlngs = line.map((p) =>
            tileToLatLng(p.x, p.y, l.extent, z, x, y)
          );
          features.push({
            type: "water",
            name,
            fClass: f.properties.class || "river",
            latlngs
          });
        });
      }
    }

    if (layers.water_name) {
      const l = layers.water_name;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || !geom[0][0]) continue;
        const pt = geom[0][0];
        if (pt.x < 0 || pt.x >= l.extent || pt.y < 0 || pt.y >= l.extent)
          continue;

        const coords = tileToLatLng(pt.x, pt.y, l.extent, z, x, y);
        features.push({
          type: "water_point",
          name,
          lat: coords.lat,
          lng: coords.lng
        });
      }
    }

    // 4. AERODROMES (Airports, Helibases)
    if (layers.aerodrome_label) {
      const l = layers.aerodrome_label;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || !geom[0][0]) continue;
        const pt = geom[0][0];
        if (pt.x < 0 || pt.x >= l.extent || pt.y < 0 || pt.y >= l.extent)
          continue;

        const coords = tileToLatLng(pt.x, pt.y, l.extent, z, x, y);
        features.push({
          type: "aerodrome",
          name,
          fClass: f.properties.class || "airport",
          lat: coords.lat,
          lng: coords.lng
        });
      }
    }

    // 5. PARKS & PROTECTED AREAS (National parks, wildlife sanctuaries)
    if (layers.park) {
      const l = layers.park;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || geom[0].length === 0) continue;
        const latlngs = geom[0].map((p) =>
          tileToLatLng(p.x, p.y, l.extent, z, x, y)
        );
        const centroid = getPolygonCentroid(latlngs);
        if (!centroid) continue;

        features.push({
          type: "park",
          name,
          fClass: f.properties.class || "national_park",
          lat: centroid.lat,
          lng: centroid.lng
        });
      }
    }

    // 6. POIS (Transit, Hospitals, Police, Landmarks)
    if (layers.poi) {
      const l = layers.poi;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const fClass = f.properties.class || "";
        const allowed = [
          "railway",
          "ferry_terminal",
          "hospital",
          "police",
          "bus",
          "place_of_worship",
          "town_hall",
          "park"
        ];
        if (!allowed.includes(fClass)) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || !geom[0][0]) continue;
        const pt = geom[0][0];
        if (pt.x < 0 || pt.x >= l.extent || pt.y < 0 || pt.y >= l.extent)
          continue;

        const coords = tileToLatLng(pt.x, pt.y, l.extent, z, x, y);
        features.push({
          type: "poi",
          name,
          fClass,
          rank: typeof f.properties.rank === "number" ? f.properties.rank : 10,
          lat: coords.lat,
          lng: coords.lng
        });
      }
    }

    // 7. MOUNTAIN PEAKS & FORTS
    if (layers.mountain_peak) {
      const l = layers.mountain_peak;
      const len = l.length;
      for (let i = 0; i < len; i++) {
        const f = l.feature(i);
        const name = getFeatureName(f.properties);
        if (!name) continue;

        const geom = f.loadGeometry();
        if (!geom || !geom[0] || !geom[0][0]) continue;
        const pt = geom[0][0];
        if (pt.x < 0 || pt.x >= l.extent || pt.y < 0 || pt.y >= l.extent)
          continue;

        const coords = tileToLatLng(pt.x, pt.y, l.extent, z, x, y);
        features.push({
          type: "peak",
          name,
          rank: typeof f.properties.rank === "number" ? f.properties.rank : 10,
          lat: coords.lat,
          lng: coords.lng
        });
      }
    }

    return features;
  },

  _render: function () {
    if (!this._map || !this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const map = this._map;
    const currentZoom = map.getZoom();
    const tileZoom = Math.min(14, Math.max(10, Math.floor(currentZoom)));
    const size = map.getSize();

    ctx.clearRect(0, 0, size.x, size.y);

    const bounds = map.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    const minTile = latLngToTile(nw.lat, nw.lng, tileZoom);
    const maxTile = latLngToTile(se.lat, se.lng, tileZoom);

    const minX = Math.min(minTile.x, maxTile.x) - 1;
    const maxX = Math.max(minTile.x, maxTile.x) + 1;
    const minY = Math.min(minTile.y, maxTile.y) - 1;
    const maxY = Math.max(minTile.y, maxTile.y) + 1;

    let candidateFeatures = [];

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${tileZoom}/${x}/${y}`;
        const tileFeats = this._tileCache.get(key);
        if (tileFeats && tileFeats.length > 0) {
          candidateFeatures.push(...tileFeats);
        }
      }
    }

    if (candidateFeatures.length === 0) return;

    // Spatial collision detector
    const placedBoxes = [];
    const placedNames = new Map(); // name -> Array<{ x, y }>
    const proximityThreshold = currentZoom >= 13 ? 120 : 160;

    function checkCollision(x1, y1, x2, y2, name = null) {
      // 1. Text bounds collision check
      for (let i = 0; i < placedBoxes.length; i++) {
        const b = placedBoxes[i];
        if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) {
          return true; // Overlap detected
        }
      }

      // 2. Proximity de-duplication for same name
      if (name && placedNames.has(name)) {
        const existing = placedNames.get(name);
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        for (let i = 0; i < existing.length; i++) {
          const dist = Math.hypot(existing[i].x - centerX, existing[i].y - centerY);
          if (dist < proximityThreshold) {
            return true; // Too close to existing label of same name
          }
        }
      }

      return false;
    }

    function recordPlacement(x1, y1, x2, y2, name = null) {
      placedBoxes.push({ x1, y1, x2, y2 });
      if (name) {
        if (!placedNames.has(name)) placedNames.set(name, []);
        placedNames.get(name).push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
      }
    }

    // Sort features by priority
    candidateFeatures.sort((a, b) => {
      const getPrio = (f) => {
        if (f.name === "Mumbai") return 0;
        if (f.type === "place" && f.fClass === "city") return 10 + (f.rank || 10);
        if (f.type === "aerodrome" && f.fClass === "international") return 20;
        if (f.type === "road" && (f.fClass === "motorway" || f.fClass === "trunk")) return 30;
        if (f.type === "place" && f.fClass === "town") return 40 + (f.rank || 10);
        if (f.type === "park" && f.fClass === "national_park") return 50;
        if (f.type === "place" && f.fClass === "suburb") return 60 + (f.rank || 10);
        if (f.type === "water") return 80;
        if (f.type === "road" && f.fClass === "primary") return 90;
        if (f.type === "aerodrome") return 95;
        if (f.type === "poi" && (f.fClass === "ferry_terminal" || f.fClass === "hospital" || f.fClass === "police")) return 100 + (f.rank || 10);
        if (f.type === "place" && (f.fClass === "neighbourhood" || f.fClass === "village")) return 110 + (f.rank || 10);
        if (f.type === "poi" && (f.fClass === "railway" || f.fClass === "bus")) return 120 + (f.rank || 10);
        if (f.type === "road" && (f.fClass === "secondary" || f.fClass === "tertiary")) return 130;
        if (f.type === "road") return 135;
        if (f.type === "peak") return 140;
        if (f.type === "place" && f.fClass === "hamlet") return 150 + (f.rank || 10);
        if (f.type === "poi") return 160 + (f.rank || 10);
        return 200;
      };
      return getPrio(a) - getPrio(b);
    });

    // RENDER CANDIDATES
    candidateFeatures.forEach((f) => {
      // 1. PLACE LABELS
      if (f.type === "place") {
        this._renderPlaceLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 2. ROAD LABELS
      else if (f.type === "road") {
        this._renderRoadLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 3. WATERWAY LABELS
      else if (f.type === "water") {
        this._renderWaterwayLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 4. WATER POINT LABELS
      else if (f.type === "water_point") {
        this._renderWaterPointLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 5. AERODROME LABELS
      else if (f.type === "aerodrome") {
        this._renderAerodromeLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 6. PARK LABELS
      else if (f.type === "park") {
        this._renderParkLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 7. POI LABELS (Railways, Hospitals, Police, Bus)
      else if (f.type === "poi") {
        this._renderPoiLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
      // 8. MOUNTAIN PEAK LABELS
      else if (f.type === "peak") {
        this._renderPeakLabel(ctx, map, f, currentZoom, checkCollision, recordPlacement);
      }
    });
  },

  _renderPlaceLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    const isMumbai = f.name === "Mumbai";
    const isCity = f.fClass === "city";
    const isTown = f.fClass === "town";
    const isSuburb = f.fClass === "suburb";
    const isNeighbourhood = f.fClass === "neighbourhood";
    const isVillage = f.fClass === "village";
    const isHamlet = f.fClass === "hamlet";
    const isIsland = f.fClass === "island";

    // Zoom visibility gating
    if (zoom < 11 && !isMumbai && !isCity && !isTown && !isIsland) return;
    if (zoom < 11.5 && (isVillage || isHamlet || isNeighbourhood)) return;
    if (zoom < 12 && (isHamlet || isNeighbourhood)) return;

    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < -100 || pt.x > size.x + 100 || pt.y < -50 || pt.y > size.y + 50)
      return;

    let fontSize = 11;
    let fontWeight = "600";
    let textColor = "#e2e8f0";
    let haloColor = "rgba(10, 16, 26, 0.95)";
    let haloWidth = 3.5;

    if (isMumbai) {
      fontSize = zoom >= 13 ? 20 : zoom >= 12 ? 18 : zoom >= 11 ? 16 : 14;
      fontWeight = "800";
      textColor = "#ffffff";
      haloWidth = 5;
    } else if (isCity) {
      fontSize = zoom >= 13 ? 15 : zoom >= 12 ? 14 : 12.5;
      fontWeight = "700";
      textColor = "#f8fafc";
      haloWidth = 4;
    } else if (isTown || (isSuburb && (f.rank || 20) <= 15)) {
      fontSize = zoom >= 13 ? 13 : zoom >= 12 ? 12 : 11;
      fontWeight = "700";
      textColor = "#e2e8f0";
      haloWidth = 3.5;
    } else if (isSuburb || isNeighbourhood) {
      fontSize = zoom >= 13 ? 12 : zoom >= 12 ? 11.5 : 10.5;
      fontWeight = "600";
      textColor = isNeighbourhood ? "#cbd5e1" : "#e2e8f0";
      haloWidth = 3;
    } else if (isIsland) {
      fontSize = 10.5;
      fontWeight = "600";
      textColor = "#93c5fd";
      haloWidth = 3;
    } else {
      // village / hamlet
      fontSize = zoom >= 13 ? 11 : 10;
      fontWeight = "500";
      textColor = "#94a3b8";
      haloWidth = 2.5;
    }

    ctx.font = `${fontWeight} ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(f.name).width;
    const pad = 3;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;

    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = haloWidth;
    ctx.strokeText(f.name, pt.x, pt.y);

    ctx.fillStyle = textColor;
    ctx.fillText(f.name, pt.x, pt.y);
  },

  _getPolylinePlacement: function (pts, textWidth, minRatio = 0.55) {
    if (!pts || pts.length < 2) return null;
    let totalLength = 0;
    const dists = [0];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      totalLength += d;
      dists.push(totalLength);
    }
    if (totalLength < textWidth * minRatio) return null;

    const midDist = totalLength / 2;
    let midIdx = 0;
    for (let i = 0; i < dists.length - 1; i++) {
      if (dists[i] <= midDist && midDist <= dists[i + 1]) {
        midIdx = i;
        break;
      }
    }

    const p1 = pts[midIdx];
    const p2 = pts[midIdx + 1] || pts[midIdx];
    const segLen = dists[midIdx + 1] - dists[midIdx];
    const t = segLen > 0 ? (midDist - dists[midIdx]) / segLen : 0.5;

    const mx = p1.x + (p2.x - p1.x) * t;
    const my = p1.y + (p2.y - p1.y) * t;

    const lookBack = Math.max(0, midIdx - 1);
    const lookAhead = Math.min(pts.length - 1, midIdx + 2);
    let angle = Math.atan2(
      pts[lookAhead].y - pts[lookBack].y,
      pts[lookAhead].x - pts[lookBack].x
    );
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    return { mx, my, angle, totalLength };
  },

  _renderRoadLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    const isMajor =
      f.fClass === "motorway" ||
      f.fClass === "trunk" ||
      f.fClass === "motorway_construction";
    const isPrimary = f.fClass === "primary";
    const isSecondary = f.fClass === "secondary";
    const isTertiary = f.fClass === "tertiary";
    const isMinor = f.fClass === "minor" || f.fClass === "service" || f.fClass === "residential";

    if (zoom < 10.8 && !isMajor) return;
    if (zoom < 11.5 && !isMajor && !isPrimary) return;
    if (zoom < 12 && (isSecondary || isTertiary || isMinor)) return;
    if (zoom < 13 && isMinor) return;

    const pts = f.latlngs.map((ll) => map.latLngToContainerPoint(ll));
    const size = map.getSize();

    let fontSize = 9.5;
    let fontWeight = "600";
    let textColor = "#94a3b8";

    if (isMajor) {
      fontSize = zoom >= 13 ? 11.5 : 10.5;
      fontWeight = "700";
      textColor = "#fef08a";
    } else if (isPrimary) {
      fontSize = zoom >= 13 ? 11 : 10;
      fontWeight = "700";
      textColor = "#e2e8f0";
    } else if (isSecondary || isTertiary) {
      fontSize = zoom >= 13 ? 10.5 : 9.5;
      fontWeight = "600";
      textColor = "#cbd5e1";
    } else {
      fontSize = zoom >= 14 ? 10 : 9;
      fontWeight = "500";
      textColor = "#94a3b8";
    }

    ctx.font = `${fontWeight} ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(f.name).width;

    const placement = this._getPolylinePlacement(pts, textWidth, isMajor ? 0.45 : 0.55);
    if (!placement) return;

    const { mx, my, angle } = placement;

    if (mx < -50 || mx > size.x + 50 || my < -50 || my > size.y + 50) return;

    const pad = 4;
    const halfW = textWidth / 2 + pad;
    const halfH = fontSize / 2 + pad;

    const x1 = mx - halfW;
    const y1 = my - halfH;
    const x2 = mx + halfW;
    const y2 = my + halfH;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;

    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(10, 16, 26, 0.95)";
    ctx.lineWidth = isMajor ? 3.5 : 2.8;
    ctx.strokeText(f.name, 0, 0);

    ctx.fillStyle = textColor;
    ctx.fillText(f.name, 0, 0);
    ctx.restore();
  },

  _renderWaterwayLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    if (zoom < 10.5 && f.name !== "Ulhas River" && f.name !== "Vaitarna") return;

    const pts = f.latlngs.map((ll) => map.latLngToContainerPoint(ll));
    const size = map.getSize();

    const fontSize = zoom >= 13 ? 11 : 10;
    ctx.font = `italic 600 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(f.name).width;

    const placement = this._getPolylinePlacement(pts, textWidth, 0.45);
    if (!placement) return;

    const { mx, my, angle } = placement;

    if (mx < -50 || mx > size.x + 50 || my < -50 || my > size.y + 50) return;

    const pad = 4;
    const x1 = mx - textWidth / 2 - pad;
    const y1 = my - fontSize / 2 - pad;
    const x2 = mx + textWidth / 2 + pad;
    const y2 = my + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;

    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(10, 20, 36, 0.95)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.name, 0, 0);

    ctx.fillStyle = "#38bdf8"; // sky blue
    ctx.fillText(f.name, 0, 0);
    ctx.restore();
  },

  _renderWaterPointLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < 0 || pt.x > size.x || pt.y < 0 || pt.y > size.y) return;

    const fontSize = zoom >= 13 ? 11 : 10.5;
    ctx.font = `italic 600 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(f.name).width;
    const pad = 4;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;
    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(10, 20, 36, 0.95)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.name, pt.x, pt.y);

    ctx.fillStyle = "#38bdf8";
    ctx.fillText(f.name, pt.x, pt.y);
  },

  _renderAerodromeLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < -50 || pt.x > size.x + 50 || pt.y < -50 || pt.y > size.y + 50)
      return;

    const isIntl = f.fClass === "international" || f.name.includes("International");
    const labelText = isIntl ? `✈ ${f.name}` : `🚁 ${f.name}`;
    const fontSize = isIntl ? (zoom >= 13 ? 12 : 11) : 10;

    ctx.font = `700 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(labelText).width;
    const pad = 4;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;
    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(10, 16, 26, 0.95)";
    ctx.lineWidth = 3.5;
    ctx.strokeText(labelText, pt.x, pt.y);

    ctx.fillStyle = "#f8fafc";
    ctx.fillText(labelText, pt.x, pt.y);
  },

  _renderParkLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    if (zoom < 10.5 && !f.name.includes("National Park")) return;

    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < -50 || pt.x > size.x + 50 || pt.y < -50 || pt.y > size.y + 50)
      return;

    const fontSize = zoom >= 13 ? 11.5 : 10.5;
    ctx.font = `italic 600 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(f.name).width;
    const pad = 4;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;
    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(10, 26, 18, 0.95)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.name, pt.x, pt.y);

    ctx.fillStyle = "#86efac"; // soft green
    ctx.fillText(f.name, pt.x, pt.y);
  },

  _renderPoiLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    if (zoom < 11.5 && f.fClass !== "railway" && f.fClass !== "ferry_terminal") return;
    if (zoom < 12 && (f.rank || 10) > 3) return;
    if (zoom < 13 && (f.fClass === "bus" || f.fClass === "place_of_worship")) return;

    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < 0 || pt.x > size.x || pt.y < 0 || pt.y > size.y) return;

    let prefix = "● ";
    let color = "#e2e8f0";

    if (f.fClass === "ferry_terminal") {
      prefix = "⚓ ";
      color = "#93c5fd";
    } else if (f.fClass === "railway") {
      prefix = "🚆 ";
      color = "#e2e8f0";
    } else if (f.fClass === "hospital") {
      prefix = "🏥 ";
      color = "#fca5a5";
    } else if (f.fClass === "police") {
      prefix = "🛡 ";
      color = "#67e8f9";
    } else if (f.fClass === "bus") {
      prefix = "🚏 ";
      color = "#cbd5e1";
    } else if (f.fClass === "place_of_worship") {
      prefix = "🏛 ";
      color = "#fef08a";
    }

    const labelText = `${prefix}${f.name}`;
    const fontSize = zoom >= 14 ? 10.5 : zoom >= 13 ? 10 : 9.5;

    ctx.font = `600 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(labelText).width;
    const pad = 3;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;
    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(10, 16, 26, 0.95)";
    ctx.lineWidth = 2.8;
    ctx.strokeText(labelText, pt.x, pt.y);

    ctx.fillStyle = color;
    ctx.fillText(labelText, pt.x, pt.y);
  },

  _renderPeakLabel: function (ctx, map, f, zoom, checkCollision, recordPlacement) {
    if (zoom < 11.5) return;

    const pt = map.latLngToContainerPoint([f.lat, f.lng]);
    const size = map.getSize();
    if (pt.x < 0 || pt.x > size.x || pt.y < 0 || pt.y > size.y) return;

    const labelText = `▲ ${f.name}`;
    const fontSize = zoom >= 13 ? 10.5 : 9.5;

    ctx.font = `600 ${fontSize}px ${this.options.fontFamily}`;
    const textWidth = ctx.measureText(labelText).width;
    const pad = 3;

    const x1 = pt.x - textWidth / 2 - pad;
    const y1 = pt.y - fontSize / 2 - pad;
    const x2 = pt.x + textWidth / 2 + pad;
    const y2 = pt.y + fontSize / 2 + pad;

    if (checkCollision(x1, y1, x2, y2, f.name)) return;
    recordPlacement(x1, y1, x2, y2, f.name);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(10, 16, 26, 0.95)";
    ctx.lineWidth = 2.8;
    ctx.strokeText(labelText, pt.x, pt.y);

    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(labelText, pt.x, pt.y);
  }
});

/**
 * Factory function to instantiate the offline vector label layer
 */
export function createOfflineVectorLabelLayer(options) {
  return new OfflineVectorLabelLayer(options);
}
