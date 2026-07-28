/* Single source of truth for all landing-page copy and illustrative data.
 * Content is deliberately centralized here so it's easy to revise without
 * touching component/animation code. Sample telemetry, git log, and community
 * messages are ILLUSTRATIVE placeholders (Helix is unreleased) — not real data. */

export const heroChips = [
  { label: 'Transport Neutral', icon: 'radio' },
  { label: 'Self Hosted', icon: 'server' },
  { label: 'Open Source', icon: 'git' },
  { label: 'Secure by Default', icon: 'shield' },
] as const;

/** The `helix --status` terminal — each line types in sequentially. */
export const statusLines: { key: string; value: string; ok?: boolean }[] = [
  { key: 'protocol', value: 'OK', ok: true },
  { key: 'transports', value: 'OK  (BLE, Serial, MQTT, WS)', ok: true },
  { key: 'services', value: 'OK  (12 loaded)', ok: true },
  { key: 'events', value: 'OK  (streaming)', ok: true },
  { key: 'ota', value: 'OK  (verified)', ok: true },
  { key: 'pki', value: 'OK  (step-ca)', ok: true },
  { key: 'cloud', value: 'OK  (online)', ok: true },
];

export const heroStats = [
  { value: 4, suffix: '+', label: 'Transports' },
  { value: 5, suffix: '', label: 'MCU / OS Targets' },
  { value: 100, suffix: '%', label: 'Open & Auditable' },
  { value: 1, suffix: '', label: 'Docker Appliance' },
] as const;

/** Illustrative device telemetry for the live event stream. */
export const sampleEvents = [
  { device: 'office-sensor-01', field: 'temperature', value: '24.3' },
  { device: 'office-sensor-02', field: 'humidity', value: '41%' },
  { device: 'edge-node-01', field: 'status', value: 'online' },
  { device: 'camera-01', field: 'motion', value: 'true' },
  { device: 'floor-sensor-03', field: 'temperature', value: '22.1' },
  { device: 'gateway-02', field: 'uplink', value: 'ok' },
  { device: 'valve-01', field: 'state', value: 'closed' },
  { device: 'meter-07', field: 'power', value: '1.8kW' },
] as const;

export const protocolTransports = [
  { key: 'ble', label: 'BLE', icon: 'bluetooth' },
  { key: 'serial', label: 'Serial', icon: 'cable' },
  { key: 'mqtt', label: 'MQTT', icon: 'radio' },
  { key: 'websocket', label: 'WebSockets', icon: 'globe' },
] as const;

export const protocolBullets = [
  'Add a new transport without touching a service',
  'Register a new service without touching a transport',
  'Same application logic runs everywhere',
] as const;

/** The five composable layers (accordion). */
export const layers = [
  {
    slug: 'embedded',
    name: 'Embedded Firmware',
    icon: 'cpu',
    summary: 'Protocol core, OTA, KV/DB, Events, Provisioning.',
    detail:
      'ESP-IDF and Arduino/AVR firmware built on the transport-abstracting protocol core, with signed profile-gated OTA, an on-device KV/DB store, and a durable event queue layered on top.',
  },
  {
    slug: 'edge-os',
    name: 'Edge Linux OS',
    icon: 'server',
    summary: 'Lean, secure, remotely manageable OS for Jetson, Raspberry Pi, x86.',
    detail:
      'A minimal Linux image with only what the workload needs — bootable in QEMU, fully manageable over MQTTs, running AI/ML on Jetson or IoT on Raspberry Pi.',
  },
  {
    slug: 'cloud',
    name: 'Cloud Platform',
    icon: 'cloud',
    summary: 'MQTT → Broker → DB, tRPC APIs, PKI (step-ca), Storage, Releases, and more.',
    detail:
      'All backend capability in one reusable package: event ingestion, tRPC routers, storage providers, certificate provisioning, and a kind-agnostic releases/OTA control plane.',
  },
  {
    slug: 'clients',
    name: 'Clients',
    icon: 'devices',
    summary: 'Web (Next.js) & Android (BLE-first). Same protocol. Same services.',
    detail:
      'A web app with WebSerial + Web Bluetooth for direct device access, and a native Kotlin/Compose SDK — both talking to devices locally over BLE/Serial or remotely over MQTT/WebSockets.',
  },
  {
    slug: 'protocol',
    name: 'Helix Protocol',
    icon: 'dna',
    summary: 'The common surface tying everything together.',
    detail:
      'One typed request/response + query/mutation surface over BLE, Serial, MQTT, and WebSockets, with reference implementations in C, Go, and Python.',
  },
] as const;

/** Architecture flow — corrected to the real stack (Mosquitto, Redpanda, OpenFGA, MinIO). */
export const architecture = {
  devices: [
    { label: 'MCU / ESP32', icon: 'cpu' },
    { label: 'Linux Devices', icon: 'server' },
    { label: 'Sensors / Actuators', icon: 'activity' },
  ],
  edge: [
    { label: 'Helix Edge OS', sub: '(MQTT Client)' },
    { label: 'Local Services', sub: '(KV, Events, OTA)' },
  ],
  broker: { label: 'MQTT Broker', sub: '(Mosquitto)' },
  cloud: [
    { label: 'Ingest Service' },
    { label: 'Stream / Events', sub: 'Redpanda' },
    { label: 'tRPC APIs' },
    { label: 'PostgreSQL' },
    { label: 'Object Storage', sub: 'MinIO' },
  ],
  controlPlane: [
    { label: 'PKI', sub: 'step-ca' },
    { label: 'Releases & OTA', sub: 'Control Plane' },
  ],
  baseline: ['Observability', 'Metrics', 'Audit Logs', 'RBAC (OpenFGA)'],
} as const;

export const tools = [
  {
    name: 'Firmware SDKs',
    icon: 'cpu',
    body: 'C (ESP-IDF), C++ (Arduino), Go, Python.',
    tag: 'Lightweight & portable',
  },
  {
    name: 'Cloud Package',
    icon: 'cloud',
    body: '~25 services in one Docker appliance.',
    tag: 'Self-host anywhere',
  },
  {
    name: 'Web App',
    icon: 'globe',
    body: 'React / Next.js, WebSerial, Web Bluetooth, MQTT.',
    tag: 'Runs in your browser',
  },
  {
    name: 'Android App',
    icon: 'smartphone',
    body: 'Jetpack Compose. BLE-first, MQTT ready.',
    tag: 'Native & delightful',
  },
] as const;

/** Illustrative git log for the open-source section. */
export const gitLog = [
  { hash: 'a1b2c3d', msg: 'feat(protocol): add webtransport support' },
  { hash: '9f8e7d6', msg: 'fix(ota): verify signature before swap' },
  { hash: '4e5d0c2', msg: 'docs: update architecture diagram' },
] as const;

/** Illustrative community activity (placeholder handles, not real endorsements). */
export const communityMessages = [
  { handle: 'contributor', text: 'Looks great! 🔥', time: '2m' },
  { handle: 'maintainer', text: 'Can we add metrics for queue depth?', time: '1m' },
  { handle: 'helix-bot', text: 'Done ✅', time: 'just now' },
] as const;

export const cloneCommands = [
  'git clone https://github.com/helix-kit/helix-kit.git',
  'cd helix',
  'helix appliance up',
] as const;
