import { env } from './env';

// SKIP_ENV_VALIDATION (bundle packaging) bypasses zod AND its defaults, so this
// can be undefined at build time — and robots.txt/sitemap.xml are prerendered,
// which would crash the build. Resolve the origin once, with a fallback.
const DEFAULT_ORIGIN = 'http://localhost:3000';

// `env` types these as always-present (zod supplies defaults), but
// SKIP_ENV_VALIDATION — which the bundle build uses, since a packaged bundle has
// no runtime env — skips zod entirely, defaults included. So at build time they
// really can be undefined, and robots.txt/sitemap.xml are PRERENDERED: an
// undefined origin crashes the whole build. The cast admits that the declared
// type is a lie under that flag.
const fallback = (value: string, fallbackValue: string): string => {
  const raw = value as string | undefined;
  return raw === undefined || raw === '' ? fallbackValue : raw;
};

export const publicOrigin = fallback(env.NEXT_PUBLIC_BASE_URL, DEFAULT_ORIGIN);

/**
 * The public origin, resolved at REQUEST time — for robots.txt and sitemap.xml.
 *
 * `publicOrigin` above comes from NEXT_PUBLIC_BASE_URL, which Next inlines at
 * BUILD time. That is fine for metadata in a bundle built for one site, but the
 * appliance ships ONE bundle to MANY installs on different domains: a baked-in
 * origin would have every appliance advertising someone else's URL (or, if the
 * build had no value, localhost — which is exactly what happened). PUBLIC_APP_URL
 * is a plain server var the appliance writes into site.env, so reading it here
 * (from a force-dynamic route) gives each install its own correct origin.
 */
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
  // The console is now a route in THIS app, not a separate deployment — the
  // marketing "Open the console" CTAs point at it directly.
  appUrl: '/admin',
  sourceUrl: sourceUrl,
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
