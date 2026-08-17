/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Offline-First IndexedDB Storage Layer
 * Decentralized local data persistence without cloud dependencies
 */

const DB_NAME = "LOKRAKSHA_LOCAL_DB";
const DB_VERSION = 1;

let dbInstance = null;

/**
 * Initialize IndexedDB stores
 * @returns {Promise<IDBDatabase>}
 */
export function initStorage() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }

    if (!window.indexedDB) {
      console.warn("[Storage] IndexedDB not available, falling back to LocalStorage.");
      return resolve(null);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Messages store
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id" });
        msgStore.createIndex("timestamp", "timestamp", { unique: false });
        msgStore.createIndex("peerId", "peerId", { unique: false });
      }

      // Incidents / SOS store
      if (!db.objectStoreNames.contains("incidents")) {
        const incStore = db.createObjectStore("incidents", { keyPath: "id" });
        incStore.createIndex("timestamp", "timestamp", { unique: false });
        incStore.createIndex("status", "status", { unique: false });
        incStore.createIndex("risk", "risk", { unique: false });
      }

      // Known Nearby Nodes store
      if (!db.objectStoreNames.contains("nodes")) {
        db.createObjectStore("nodes", { keyPath: "id" });
      }

      // Sensor Telemetry log store
      if (!db.objectStoreNames.contains("telemetry")) {
        const telStore = db.createObjectStore("telemetry", { keyPath: "id", autoIncrement: true });
        telStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      console.log("[Storage] IndexedDB initialized successfully.");
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("[Storage] IndexedDB initialization error:", event.target.error);
      resolve(null);
    };
  });
}

/**
 * Generic helper to run transaction on object store
 */
function getStore(storeName, mode = "readonly") {
  if (!dbInstance) return null;
  const tx = dbInstance.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ----------------- Messages -----------------

export async function saveMessage(message) {
  if (!message.id) message.id = "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
  if (!message.timestamp) message.timestamp = Date.now();

  const store = getStore("messages", "readwrite");
  if (!store) {
    // Fallback
    const list = JSON.parse(localStorage.getItem("lok_messages") || "[]");
    list.unshift(message);
    localStorage.setItem("lok_messages", JSON.stringify(list.slice(0, 100)));
    return message;
  }

  return new Promise((resolve) => {
    const req = store.put(message);
    req.onsuccess = () => resolve(message);
    req.onerror = () => resolve(message);
  });
}

export async function getMessages() {
  const store = getStore("messages", "readonly");
  if (!store) {
    return JSON.parse(localStorage.getItem("lok_messages") || "[]");
  }

  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const msgs = req.result || [];
      msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      resolve(msgs);
    };
    req.onerror = () => resolve([]);
  });
}

// ----------------- Incidents -----------------

export async function saveIncident(incident) {
  if (!incident.id) incident.id = "INC-" + Date.now().toString().slice(-6);
  if (!incident.timestamp) incident.timestamp = Date.now();

  const store = getStore("incidents", "readwrite");
  if (!store) {
    const list = JSON.parse(localStorage.getItem("lok_incidents") || "[]");
    const idx = list.findIndex(i => i.id === incident.id);
    if (idx >= 0) list[idx] = incident;
    else list.unshift(incident);
    localStorage.setItem("lok_incidents", JSON.stringify(list));
    return incident;
  }

  return new Promise((resolve) => {
    const req = store.put(incident);
    req.onsuccess = () => resolve(incident);
    req.onerror = () => resolve(incident);
  });
}

export async function getIncidents() {
  const store = getStore("incidents", "readonly");
  if (!store) {
    return JSON.parse(localStorage.getItem("lok_incidents") || "[]");
  }

  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      resolve(items);
    };
    req.onerror = () => resolve([]);
  });
}

// ----------------- Nearby Peer Nodes -----------------

export async function saveNode(node) {
  if (!node.id) return;
  const store = getStore("nodes", "readwrite");
  if (!store) {
    const list = JSON.parse(localStorage.getItem("lok_nodes") || "[]");
    const idx = list.findIndex(n => n.id === node.id);
    if (idx >= 0) list[idx] = node;
    else list.push(node);
    localStorage.setItem("lok_nodes", JSON.stringify(list));
    return node;
  }

  return new Promise((resolve) => {
    const req = store.put(node);
    req.onsuccess = () => resolve(node);
    req.onerror = () => resolve(node);
  });
}

export async function getNodes() {
  const store = getStore("nodes", "readonly");
  if (!store) {
    return JSON.parse(localStorage.getItem("lok_nodes") || "[]");
  }

  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

// ----------------- Telemetry Log -----------------

export async function saveTelemetry(telemetry) {
  const store = getStore("telemetry", "readwrite");
  const record = { ...telemetry, timestamp: telemetry.lastUpdate || Date.now() };
  if (!store) return;

  return new Promise((resolve) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function getTelemetry(limit = 50) {
  const store = getStore("telemetry", "readonly");
  if (!store) return [];

  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list.slice(0, limit));
    };
    req.onerror = () => resolve([]);
  });
}

// ----------------- Settings -----------------

export async function saveSetting(key, value) {
  const store = getStore("settings", "readwrite");
  if (!store) {
    localStorage.setItem("lok_setting_" + key, JSON.stringify(value));
    return;
  }

  return new Promise((resolve) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

export async function getSettings() {
  const store = getStore("settings", "readonly");
  if (!store) {
    const settings = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("lok_setting_")) {
        const cleanKey = k.replace("lok_setting_", "");
        settings[cleanKey] = JSON.parse(localStorage.getItem(k));
      }
    }
    return settings;
  }

  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      const res = {};
      items.forEach(it => { res[it.key] = it.value; });
      resolve(res);
    };
    req.onerror = () => resolve({});
  });
}

// ----------------- Clear Data -----------------

export async function clearAllLocalData() {
  if (dbInstance) {
    const stores = ["messages", "incidents", "nodes", "telemetry", "settings"];
    stores.forEach(name => {
      try {
        const tx = dbInstance.transaction(name, "readwrite");
        tx.objectStore(name).clear();
      } catch (err) {
        console.warn(`[Storage] Clear error on ${name}:`, err);
      }
    });
  }
  localStorage.clear();
  console.log("[Storage] All local storage cleared.");
}
