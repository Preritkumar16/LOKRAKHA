/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * LOKRAKSHA Mock Data Provider
 * Matches the exact JSON structure of the physical ESP32 device firmware
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

  // Real-time sensor telemetry
  telemetry: {
    device_id: "LKRK-001",
    device_name: "LOKRAKSHA Alpha",
    temperature: 31.4,
    humidity: 72,
    battery: 84,
    batteryVoltage: 4.12,
    lat: 19.0760,
    lng: 72.8777,
    altitude: 14.2,
    hdop: 0.9,
    gpsFix: "3D_FIX",
    loraStatus: "CONNECTED",
    loraFrequency: "868.1 MHz",
    loraRssi: -78,
    loraSnr: 9.2,
    zone: "SAFE",
    risk: "LOW"
  },

  // Designated geographic safety boundaries
  zones: [
    {
      id: "ZONE-SAFE-01",
      name: "Campus Quad Safe Zone",
      type: "SAFE",
      lat: 19.0760,
      lng: 72.8777,
      radius: 200,
      description: "Designated high-security safe gathering area with continuous peer mesh coverage."
    },
    {
      id: "ZONE-CAUTION-01",
      name: "North Perimeter Corridor",
      type: "CAUTION",
      lat: 19.0780,
      lng: 72.8765,
      radius: 160,
      description: "Low-visibility transit corridor. Exercise situational awareness."
    },
    {
      id: "ZONE-RESTRICTED-01",
      name: "Hazardous Chemical / Sump Zone",
      type: "RESTRICTED",
      lat: 19.0805,
      lng: 72.8810,
      radius: 140,
      description: "Prohibited restricted area. Unescorted entry triggers automatic safety warning."
    }
  ],

  // Nearby independent decentralized peer nodes
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
      lat: 19.0772,
      lng: 72.8790,
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
      lat: 19.0745,
      lng: 72.8760,
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
      lat: 19.0785,
      lng: 72.8745,
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
      lat: 19.0735,
      lng: 72.8795,
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
      text: "LOKRAKSHA Bravo peer node online on 868.1 MHz. Mesh routing active.",
      priority: "NORMAL",
      timestamp: Date.now() - 360000,
      status: "DELIVERED"
    },
    {
      id: "msg_init_02",
      from: "LKRK-003",
      to: "LKRK-001",
      type: "DIRECT",
      text: "Peer beacon received. Signal RSSI -82 dBm, link stable.",
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
      lat: 19.0780,
      lng: 72.8765,
      zone: "North Perimeter Corridor",
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
