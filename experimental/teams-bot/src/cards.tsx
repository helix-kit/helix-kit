// SPDX-License-Identifier: AGPL-3.0-only
//
// A reusable card authored once as JSX; button `id`s come back to bot.onAction() on click.

import { Card, CardText, Actions, Button } from "chat";
import type { ChatElement } from "chat/jsx-runtime";

export interface DeviceAlert {
  device: string;
  title: string;
  detail: string;
}

export function deviceAlertCard(alert: DeviceAlert): ChatElement {
  return (
    <Card title={alert.title} subtitle={alert.device}>
      <CardText>{alert.detail}</CardText>
      <Actions>
        <Button id="ack" label="Acknowledge" style="primary" value={alert.device} />
        <Button id="reboot" label="Reboot device" style="danger" value={alert.device} />
      </Actions>
    </Card>
  );
}
