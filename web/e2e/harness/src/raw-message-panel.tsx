import { useEffect, useState } from 'react';

import { createRequestId, type HelixPacket } from '@helix/protocol';
import { useHelixTransport } from '@helix/protocol/service/react';

import type { HelixMessage } from '@helix/protocol/service';

const MAX_LOG = 50;

// Contract-agnostic transport probe: injects raw request JSON, sends it over the transport above, and surfaces received packets verbatim.
export const RawMessagePanel = () => {
  const { transport, isConnected } = useHelixTransport();
  const [request, setRequest] = useState('');
  const [sendError, setSendError] = useState('');
  const [received, setReceived] = useState<readonly string[]>([]);

  useEffect(
    () =>
      transport.subscribe((packet) => {
        setReceived((entries) => [JSON.stringify(packet), ...entries].slice(0, MAX_LOG));
      }),
    [transport],
  );

  const send = async () => {
    setSendError('');
    try {
      const message = JSON.parse(request) as HelixMessage;
      const packet: HelixPacket<HelixMessage> = { message, requestId: createRequestId() };
      await transport.send(packet);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section data-testid="message-panel">
      <label>
        Request message JSON
        <textarea
          data-testid="request-input"
          placeholder='{"service":"...","method":"...","payload":{}}'
          rows={5}
          value={request}
          onChange={(event) => {
            setRequest(event.target.value);
          }}
        />
      </label>
      <div className="row">
        <button
          data-testid="send"
          disabled={!isConnected}
          type="button"
          onClick={() => void send()}
        >
          Send
        </button>
        <button
          data-testid="clear-received"
          type="button"
          onClick={() => {
            setReceived([]);
          }}
        >
          Clear
        </button>
      </div>
      {sendError !== '' ? <div data-testid="send-error">{sendError}</div> : null}
      <div>
        Last received
        <pre data-testid="last-received">{received[0] ?? ''}</pre>
      </div>
      <pre data-testid="received-log">{received.join('\n')}</pre>
    </section>
  );
};
