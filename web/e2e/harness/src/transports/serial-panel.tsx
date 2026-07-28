import { SerialTransportProvider, useSerialTransport } from '@helix/transport-serial/react';

import type { SerialPortFilter, SerialSignalState } from '@helix/transport-serial';

import { RawMessagePanel } from '../raw-message-panel';

const HEX_RADIX = 16;
const USB_ID_WIDTH = 4;
const formatUsbId = (value: number | undefined): string =>
  value === undefined ? '????' : `0x${value.toString(HEX_RADIX).padStart(USB_ID_WIDTH, '0')}`;

const SerialControls = () => {
  const serial = useSerialTransport();
  const connected = serial.connectionState === 'connected';

  return (
    <section className="panel" data-testid="serial-panel">
      <h2>Web Serial</h2>
      <div data-testid="supported">{serial.supported ? 'supported' : 'unsupported'}</div>
      <div data-testid="connection-state">{serial.connectionState}</div>
      <div data-testid="port-info">
        {serial.portInfo !== null
          ? `${formatUsbId(serial.portInfo.usbVendorId)}:${formatUsbId(serial.portInfo.usbProductId)}`
          : 'none'}
      </div>
      <div className="row">
        {connected ? (
          <button data-testid="disconnect" type="button" onClick={() => void serial.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            data-testid="connect"
            disabled={!serial.supported || serial.connectionState === 'connecting'}
            type="button"
            onClick={() => void serial.connect()}
          >
            Connect
          </button>
        )}
      </div>
      {serial.error !== null ? <div data-testid="error">{serial.error}</div> : null}
      <RawMessagePanel />
    </section>
  );
};

// SerialTransportProvider renders HelixTransportProvider internally, so the
// RawMessagePanel inside talks over this transport with no extra wiring.
// openSignals lets a native-USB board (Arduino) assert DTR; ESP32 leaves the
// default (deasserted) so it is not held in reset.
export const SerialPanel = ({
  filters,
  openSignals,
}: {
  filters: readonly SerialPortFilter[];
  openSignals?: SerialSignalState | null;
}) => (
  <SerialTransportProvider filters={filters} openSignals={openSignals}>
    <SerialControls />
  </SerialTransportProvider>
);
