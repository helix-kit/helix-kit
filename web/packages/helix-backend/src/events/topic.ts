const TOPIC_NAMESPACE = 'helix';
const EVENT_SUBTOPIC = 'event';
const EVENT_TOPIC_SEGMENT_COUNT = 6;

export type ParsedDeviceEventTopic = Readonly<{
  deviceId: string;
  service: string;
}>;

export type DeviceEventEnvelope = Readonly<{
  msgId?: string;
  payload?: unknown;
  timestamp?: string;
  type: string;
}>;

export const deviceEventSubscriptionTopics = (): string[] => [
  `${TOPIC_NAMESPACE}/device/+/service/+/${EVENT_SUBTOPIC}`,
];

export const buildDeviceEventTopic = (deviceId: string, service: string): string =>
  `${TOPIC_NAMESPACE}/device/${deviceId}/service/${service}/${EVENT_SUBTOPIC}`;

// helix / device / <deviceId> / service / <service> / event
export const parseDeviceEventTopic = (topic: string): ParsedDeviceEventTopic | null => {
  const segments = topic.split('/');
  if (
    segments.length !== EVENT_TOPIC_SEGMENT_COUNT ||
    segments[0] !== TOPIC_NAMESPACE ||
    segments[1] !== 'device' ||
    segments[3] !== 'service' ||
    segments[5] !== EVENT_SUBTOPIC
  ) {
    return null;
  }

  const deviceId = segments[2]?.trim() ?? '';
  const service = segments[4]?.trim() ?? '';
  if (deviceId === '' || service === '') {
    return null;
  }
  return { deviceId, service };
};

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const isDeviceEventEnvelope = (value: unknown): value is DeviceEventEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  normalizeOptionalString((value as { type?: unknown }).type) !== null;

export const parseDeviceEventEnvelope = (payload: string): DeviceEventEnvelope | null => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return isDeviceEventEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
