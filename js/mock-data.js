/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Mock Data Provider
 * Geographically centered around Thakur College of Engineering & Technology (TCET), Kandivali East, Mumbai
 */

export const initialMockData = {
  // Local peer node device profile
  device: {
    id: "LKRK-001",
    name: "LOKRAKSHA Alpha",
    firmware: "v2.4.1-ESP32-LORA",
    status: "ONLINE",
    connectionType: "LOCAL_WIFI_DIRECT",
    ip: "192.168.4.1",
    publicKey: "0x4F9B7A210CD988A2",
    credentialStatus: "ACTIVE",
    isVerified: true
  },

  // Real-time sensor telemetry (Centered at TCET Campus: 19.2060° N, 72.8746° E)
  telemetry: {
    device_id: "LKRK-001",
    device_name: "LOKRAKSHA Alpha",
    temperature: 31.4,
    humidity: 72,
    battery: 84,
    batteryVoltage: 4.12,
    lat: 19.2060,
    lng: 72.8746,
    altitude: 14.2,
    hdop: 0.9,
    gpsFix: "3D_FIX",
    gpsStatus: "ACTIVE",
    gpsValid: true,
    loraStatus: "CONNECTED",
    loraFrequency: "868.1 MHz",
    loraRssi: -78,
    loraSnr: 9.2,
    zone: "SAFE",
    risk: "LOW"
  },

  // Designated geographic safety boundaries around TCET Campus & Thakur Village
  zones: [
    {
      id: "ZONE-SAFE-01",
      name: "TCET Campus Quad Safe Zone",
      type: "SAFE",
      lat: 19.2060,
      lng: 72.8746,
      radius: 180,
      description: "Designated high-security safe gathering area with continuous peer mesh coverage across TCET campus."
    },
    {
      id: "ZONE-CAUTION-01",
      name: "Thakur Village Transit Corridor",
      type: "CAUTION",
      lat: 19.2082,
      lng: 72.8762,
      radius: 160,
      description: "Thakur Village commercial transit zone. Exercise situational awareness."
    },
    {
      id: "ZONE-RESTRICTED-01",
      name: "Western Express Highway Boundary Hazard",
      type: "RESTRICTED",
      lat: 19.2038,
      lng: 72.8705,
      radius: 150,
      description: "High-traffic highway perimeter. Unescorted exit triggers automatic safety alert."
    }
  ],

  // Nearby independent decentralized peer nodes in and around Thakur College
  nodes: [
    {
      id: "LKRK-002",
      name: "LOKRAKSHA Bravo",
      status: "ONLINE",
      riskState: "LOW",
      isSos: false,
      rssi: -74,
      snr: 8.5,
      battery: 92,
      lat: 19.2072,
      lng: 72.8755,
      temperature: 30.8,
      humidity: 70,
      lastSeen: Date.now() - 12000,
      locationSharing: true,
      publicKey: "0x89C1...44D3"
    },
    {
      id: "LKRK-003",
      name: "LOKRAKSHA Charlie",
      status: "ONLINE",
      riskState: "LOW",
      isSos: false,
      rssi: -82,
      snr: 6.2,
      battery: 76,
      lat: 19.2048,
      lng: 72.8735,
      temperature: 32.1,
      humidity: 74,
      lastSeen: Date.now() - 25000,
      locationSharing: true,
      publicKey: "0x12E4...99B1"
    },
    {
      id: "LKRK-004",
      name: "LOKRAKSHA Delta",
      status: "ONLINE",
      riskState: "MEDIUM",
      isSos: false,
      rssi: -89,
      snr: 4.8,
      battery: 48,
      lat: 19.2078,
      lng: 72.8740,
      temperature: 33.0,
      humidity: 68,
      lastSeen: Date.now() - 40000,
      locationSharing: true,
      publicKey: "0x77A0...33F8"
    },
    {
      id: "LKRK-005",
      name: "LOKRAKSHA Echo",
      status: "ONLINE",
      riskState: "LOW",
      isSos: false,
      rssi: -68,
      snr: 10.4,
      battery: 88,
      lat: 19.2042,
      lng: 72.8762,
      temperature: 30.5,
      humidity: 71,
      lastSeen: Date.now() - 8000,
      locationSharing: true,
      publicKey: "0x33B2...11A9"
    }
  ],

  // Pre-seeded message history
  messages: [
    {
      id: "msg_init_01",
      from: "LKRK-002",
      to: "BROADCAST",
      type: "BROADCAST",
      text: "LOKRAKSHA Bravo peer node online on 868.1 MHz. TCET campus mesh routing active.",
      priority: "NORMAL",
      timestamp: Date.now() - 360000,
      status: "DELIVERED"
    },
    {
      id: "msg_init_02",
      from: "LKRK-003",
      to: "LKRK-001",
      type: "DIRECT",
      text: "Peer beacon received from Sports Wing. Signal RSSI -82 dBm, link stable.",
      priority: "NORMAL",
      timestamp: Date.now() - 180000,
      status: "DELIVERED"
    }
  ],

  // Pre-seeded incidents (historic for demo)
  incidents: [
    {
      id: "INC-882104",
      sourceDevice: "LKRK-003",
      sourceName: "LOKRAKSHA Charlie",
      type: "CAUTION_ZONE",
      title: "Perimeter Caution Warning",
      lat: 19.2082,
      lng: 72.8762,
      zone: "Thakur Village Transit Corridor",
      temperature: 32.1,
      humidity: 74,
      battery: 76,
      riskLevel: "MEDIUM",
      riskScore: 45,
      timestamp: Date.now() - 720000,
      status: "RESOLVED", // ACTIVE, ACKNOWLEDGED, RESPONDING, RESOLVED
      timeline: [
        { stage: "INCIDENT DETECTED", time: Date.now() - 720000, completed: true },
        { stage: "RISK ASSESSED", time: Date.now() - 715000, completed: true },
        { stage: "ALERT GENERATED", time: Date.now() - 710000, completed: true },
        { stage: "PEER NOTIFIED", time: Date.now() - 700000, completed: true },
        { stage: "RESPONSE", time: Date.now() - 650000, completed: true }
      ]
    }
  ]
};
