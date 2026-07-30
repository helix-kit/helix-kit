import { env } from './env';

const DEFAULT_ORIGIN = 'http://localhost:3000';

// SKIP_ENV_VALIDATION (bundle build) skips zod and its defaults, so these can be
// undefined at build time even though the type says otherwise; the cast admits that.
const fallback = (value: string, fallbackValue: string): string => {
  const raw = value as string | undefined;
  return raw === undefined || raw === '' ? fallbackValue : raw;
};

export const publicOrigin = fallback(env.NEXT_PUBLIC_BASE_URL, DEFAULT_ORIGIN);

// The public origin resolved at REQUEST time (robots.txt/sitemap.xml): the appliance
// ships one bundle to many installs, so a build-time baked-in origin would be wrong.
// PUBLIC_APP_URL is a plain server var each install writes into site.env.
export const runtimeOrigin = (): string => {
  const configured = process.env['PUBLIC_APP_URL'];
  return configured === undefined || configured === ''
    ? publicOrigin
    : configured.replace(/\/$/, '');
};

const sourceUrl = fallback(
  env.NEXT_PUBLIC_HELIX_SOURCE_URL,
  'https://github.com/helix-kit/helix-kit',
);

export const site = {
  name: 'Helix',
  tagline: 'The open IoT platform you compose yourself',
  description:
    'An open-source IoT platform assembled from reusable, independently adoptable components: embedded firmware, a minimal edge Linux OS, a cloud control plane, and clients — all speaking one transport-neutral protocol.',
  url: publicOrigin,
  appUrl: '/dashboard',
  sourceUrl: sourceUrl,
  twitter: '@jainhardik17',
} as const;

export const nav = [
  { label: 'Why Helix', href: '/#protocol' },
  { label: 'Platform', href: '/product' },
  { label: 'Docs', href: '/docs' },
  { label: 'Community', href: '/open-source' },
  { label: 'Blog', href: '/blog' },
] as const;

export type Pillar = {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  points: string[];
};

export const pillars: Pillar[] = [
  {
    slug: 'embedded',
    name: 'Embedded firmware',
    tagline: 'ESP32 & Arduino, built on the Helix protocol core',
    summary:
      'A transport-abstracting protocol core (packet + dispatch + endpoint + transports) with application services — OTA, secure MQTTs provisioning, file transfer, an on-device store — layered cleanly on top.',
    points: [
      'ESP-IDF firmware for ESP32 and FreeRTOS firmware for Arduino/AVR',
      'Signed, profile-gated OTA with CI and custom builds',
      'BLE, Serial, MQTT transports behind one dispatcher seam',
      'On-device durable event queue and KV/DB store',
    ],
  },
  {
    slug: 'edge-os',
    name: 'Edge Linux OS',
    tagline: 'A minimal, purpose-built OS for Jetson, Pi, and x86',
    summary:
      'A lean Linux image with only what the workload needs — no bloat — fully manageable over MQTTs, with runtime, cloud-comm, and device services for the core utilities.',
    points: [
      'debootstrap → rootfs → disk/ISO, bootable in QEMU',
      'Secure shell access and kiosk mode',
      'Manageable end-to-end over MQTTs',
      'Platform apps: AI/ML on Jetson, IoT on Raspberry Pi',
    ],
  },
  {
    slug: 'cloud',
    name: 'Cloud platform',
    tagline: 'Provisioning, releases/OTA, ingestion, and a gateway',
    summary:
      'All backend capability lives in one reusable package: DB, tRPC routers, storage providers, PKI, the event queue, an MQTT bridge, and the releases/OTA control plane. Apps are thin wiring.',
    points: [
      'Event ingestion pipeline (MQTT → broker → DB) with dedupe',
      'Certificate provisioning via step-ca',
      'Kind-agnostic release/artifact/build/OTA control plane',
      'Composable server roles: gateway, ingest, writer',
    ],
  },
  {
    slug: 'clients',
    name: 'Clients',
    tagline: 'Web (React/Next.js) and native Android (Compose)',
    summary:
      'A web app and a BLE-first native Android app, both built on the same protocol/service/transport split — talk to devices locally over BLE/Serial or remotely over MQTT/WebSockets.',
    points: [
      'WebSerial + Web Bluetooth for direct device access in the browser',
      'Native Kotlin/Compose SDK mirroring the web packages',
      'Shared, typed request/response + query/mutation surface',
      'One application logic, any transport',
    ],
  },
  {
    slug: 'protocol',
    name: 'The Helix protocol',
    tagline: 'One transport-neutral surface for every device',
    summary:
      'A framework that abstracts BLE, Serial, MQTT, and WebSockets behind one typed request/response + query/mutation surface, so the same application logic runs over any transport, local or remote.',
    points: [
      'Transport seam: add a transport without touching services',
      'Service seam: register a service with the dispatcher',
      'Reference implementations in C, Go, and Python',
      'The same core runs verbatim on ESP32 and Arduino',
    ],
  },
];
