import { useSyncExternalStore } from 'react';

import { ARDUINO_SERIAL_FILTERS, ESP32_SERIAL_FILTERS } from './serial-filters';
import { BlePanel } from './transports/ble-panel';
import { SerialPanel } from './transports/serial-panel';

const subscribeHash = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
};

const ARDUINO_OPEN_SIGNALS = { dataTerminalReady: true, requestToSend: true };

export const App = () => {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  );
  const view = hash.replace('#', '');

  const renderPanel = () => {
    if (view === 'ble') {
      return <BlePanel />;
    }
    if (view === 'arduino') {
      return <SerialPanel filters={ARDUINO_SERIAL_FILTERS} openSignals={ARDUINO_OPEN_SIGNALS} />;
    }
    return <SerialPanel filters={ESP32_SERIAL_FILTERS} />;
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 720 }}>
      <h1>Helix Transport Harness</h1>
      <p>Verifies the shared transport packages against real hardware in a browser.</p>
      {renderPanel()}
    </main>
  );
};
