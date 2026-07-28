import { HelixEsp32BleProvider, useBleTransport } from '@helix/transport-ble';

import { RawMessagePanel } from '../raw-message-panel';

const BleControls = () => {
  const ble = useBleTransport();
  const connected = ble.connectionState === 'connected';

  return (
    <section className="panel" data-testid="ble-panel">
      <h2>Web Bluetooth</h2>
      <div data-testid="ble-supported">{ble.supported ? 'supported' : 'unsupported'}</div>
      <div data-testid="ble-connection-state">{ble.connectionState}</div>
      <div data-testid="ble-device-name">{ble.deviceName ?? 'none'}</div>
      <div className="row">
        {connected ? (
          <button data-testid="ble-disconnect" type="button" onClick={() => void ble.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            data-testid="ble-connect"
            disabled={!ble.supported || ble.connectionState === 'connecting'}
            type="button"
            onClick={() => void ble.connect()}
          >
            Connect
          </button>
        )}
      </div>
      {ble.error !== null ? <div data-testid="ble-error">{ble.error}</div> : null}
      <RawMessagePanel />
    </section>
  );
};

export const BlePanel = () => (
  <HelixEsp32BleProvider>
    <BleControls />
  </HelixEsp32BleProvider>
);
