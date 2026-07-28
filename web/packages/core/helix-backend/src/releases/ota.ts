import { jsonPacketCodec } from '@helix/protocol-core';
import { type MqttClient } from 'mqtt';

import { resolveOtaTarget } from './resolve';

import { type DatabaseClient } from '../db';

const MQTT_QOS_AT_LEAST_ONCE = 1;

const deviceInTopic = (deviceId: string): string => `helix/device/${deviceId}/in`;

// Path-based OTA producer: resolves the device's target `app` blob and publishes
// an `ota-update` command to the device's /in topic. The device then requests a
// profile-gated signed URL for `packagePath` and downloads + verifies `sha256`.
export const createOtaPublisher =
  (mqttClient: MqttClient, db: DatabaseClient) =>
  async (deviceId: string): ReturnType<typeof resolveOtaTarget> => {
    const target = await resolveOtaTarget(db, deviceId);
    if (target === null) {
      return null;
    }
    const packet = {
      message: {
        method: 'ota-update',
        payload: {
          packagePath: target.storageKey,
          sha256: target.sha256,
          version: target.version,
        },
        service: 'ota',
      },
    };
    mqttClient.publish(deviceInTopic(deviceId), jsonPacketCodec.encode(packet), {
      qos: MQTT_QOS_AT_LEAST_ONCE,
    });
    return target;
  };
