import {
  getWebSerial,
  selectSerialPort,
  type SerialPort,
  type SerialPortFilter,
} from '@helix/transport-serial';

export type Esp32FirmwareArtifact = Readonly<{
  id: string;
  name: string;
  offset: number;
  sha256: string;
  size: number;
  url: string;
}>;

export type Esp32FirmwareManifest = Readonly<{
  artifacts: readonly Esp32FirmwareArtifact[];
  baudRate: number;
  chip: 'esp32';
  flashFreq: '40m' | '80m' | 'keep';
  flashMode: 'dio' | 'dout' | 'keep' | 'qio' | 'qout';
  flashSize:
    | '128MB'
    | '16MB'
    | '1MB'
    | '256KB'
    | '2MB'
    | '2MB-c1'
    | '32MB'
    | '4MB'
    | '4MB-c1'
    | '512KB'
    | '64MB'
    | '8MB'
    | 'detect'
    | 'keep';
  profile: string;
}>;

export type Esp32FlashProgress = Readonly<{
  artifact: Esp32FirmwareArtifact;
  artifactIndex: number;
  bytesTotal: number;
  bytesWritten: number;
  percent: number;
}>;

export type FlashEsp32Options = Readonly<{
  fetch?: typeof fetch;
  manifest: Esp32FirmwareManifest;
  manualBootMode?: boolean;
  onLog?: (message: string) => void;
  onProgress?: (progress: Esp32FlashProgress) => void;
  port?: SerialPort;
}>;

export type FlashEsp32Result = Readonly<{
  chip: string;
  manifest: Esp32FirmwareManifest;
}>;

type DownloadedArtifact = Readonly<{
  artifact: Esp32FirmwareArtifact;
  data: Uint8Array;
}>;

const HEX_RADIX = 16;
const PERCENT_COMPLETE = 100;
const SHA256_HEX_PATTERN = /^[a-f\d]{64}$/i;

export const ESP32_SERIAL_PORT_FILTERS: readonly SerialPortFilter[] = [
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1a86 },
  { usbVendorId: 0x0403 },
  { usbVendorId: 0x303a },
  { usbVendorId: 0x04d8 },
];

export const ESP32_LINUX_SERIAL_PREP_COMMAND =
  'sudo setfacl -m u:$USER:rw /dev/ttyUSB0 && sudo stty -F /dev/ttyUSB0 115200 cs8 -cstopb -parenb cread clocal -hupcl min 1 time 0 -icanon -echo -isig -ixon -ixoff ignpar -parmrk -opost';

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('');

const digestSha256 = async (data: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(data));
  return bytesToHex(new Uint8Array(digest));
};

const validateManifest = (manifest: Esp32FirmwareManifest): void => {
  if (String(manifest.chip) !== 'esp32') {
    throw new Error(`Unsupported firmware chip ${String(manifest.chip)}.`);
  }
  if (manifest.artifacts.length === 0) {
    throw new Error('ESP32 firmware manifest contains no artifacts.');
  }
  const offsets = new Set<number>();
  for (const artifact of manifest.artifacts) {
    if (!Number.isSafeInteger(artifact.offset) || artifact.offset < 0) {
      throw new Error(`Firmware artifact ${artifact.name} has an invalid offset.`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      throw new Error(`Firmware artifact ${artifact.name} has an invalid size.`);
    }
    if (!SHA256_HEX_PATTERN.test(artifact.sha256.trim())) {
      throw new Error(`Firmware artifact ${artifact.name} has an invalid SHA-256 digest.`);
    }
    if (offsets.has(artifact.offset)) {
      throw new Error(`Firmware manifest repeats offset ${artifact.offset}.`);
    }
    offsets.add(artifact.offset);
  }
};

export const fetchEsp32FirmwareManifest = async (
  url: string | URL,
  fetcher: typeof fetch = fetch,
): Promise<Esp32FirmwareManifest> => {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Firmware manifest request failed with HTTP ${response.status}.`);
  }
  const manifest = (await response.json()) as Esp32FirmwareManifest;
  validateManifest(manifest);
  return manifest;
};

const downloadArtifact = async (
  artifact: Esp32FirmwareArtifact,
  fetcher: typeof fetch,
): Promise<DownloadedArtifact> => {
  const response = await fetcher(artifact.url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${artifact.name} download failed with HTTP ${response.status}.`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength !== artifact.size) {
    throw new Error(
      `${artifact.name} size mismatch: expected ${artifact.size}, received ${data.byteLength}.`,
    );
  }
  const actualSha256 = await digestSha256(data);
  if (actualSha256 !== artifact.sha256.trim().toLowerCase()) {
    throw new Error(`${artifact.name} SHA-256 verification failed.`);
  }
  return { artifact, data };
};

export const selectEsp32SerialPort = async (): Promise<SerialPort> => {
  const serial = getWebSerial();
  if (serial === null) {
    throw new Error('Web Serial is not available in this browser.');
  }
  return selectSerialPort(serial, ESP32_SERIAL_PORT_FILTERS);
};

export const flashEsp32 = async ({
  fetch: fetcher = fetch,
  manifest,
  manualBootMode = false,
  onLog,
  onProgress,
  port: providedPort,
}: FlashEsp32Options): Promise<FlashEsp32Result> => {
  validateManifest(manifest);
  const port = providedPort ?? (await selectEsp32SerialPort());
  const downloaded = await Promise.all(
    manifest.artifacts.map(async (artifact) => {
      onLog?.(`Downloading and verifying ${artifact.name}.`);
      return downloadArtifact(artifact, fetcher);
    }),
  );

  const esptool = await import('esptool-js');
  const transport = new esptool.Transport(port, true);
  try {
    const loader = new esptool.ESPLoader({
      baudrate: manifest.baudRate,
      debugLogging: false,
      terminal: {
        clean: () => undefined,
        write: (message: string) => onLog?.(message.trimEnd()),
        writeLine: (message: string) => onLog?.(message),
      },
      transport,
    });
    const chip = await loader.main(manualBootMode ? 'no_reset' : 'default_reset');
    onLog?.(`Connected to ${chip}.`);
    await loader.writeFlash({
      compress: true,
      eraseAll: true,
      fileArray: downloaded.map(({ artifact, data }) => ({
        address: artifact.offset,
        data,
      })),
      flashFreq: manifest.flashFreq,
      flashMode: manifest.flashMode,
      flashSize: manifest.flashSize,
      reportProgress: (artifactIndex, bytesWritten, bytesTotal) => {
        const artifact = manifest.artifacts[artifactIndex];
        if (artifact === undefined) {
          return;
        }
        onProgress?.({
          artifact,
          artifactIndex,
          bytesTotal,
          bytesWritten,
          percent:
            bytesTotal === 0 ? 0 : Math.round((bytesWritten / bytesTotal) * PERCENT_COMPLETE),
        });
      },
    });
    await loader.after('hard_reset');
    onLog?.('ESP32 flash complete.');
    return { chip, manifest };
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
};
