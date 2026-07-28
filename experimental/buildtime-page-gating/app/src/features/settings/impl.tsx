'use client';

import { useState } from 'react';

export default function SettingsImpl() {
  const [name, setName] = useState('edge-device-01');
  return (
    <main>
      <h1>Settings</h1>
      <div className="card">
        <label>
          Device name{' '}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </main>
  );
}
