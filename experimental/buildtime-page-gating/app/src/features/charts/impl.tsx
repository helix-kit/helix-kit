'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = Array.from({ length: 12 }, (_, i) => ({ t: i, v: Math.round(50 + 30 * Math.sin(i / 2)) }));

// Heavy feature: recharts pulls in a chunk of d3. Gated out ⇒ absent from out/.
export default function ChartsImpl() {
  return (
    <main>
      <h1>Analytics</h1>
      <div className="card" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="v" stroke="#7cc4ff" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}
