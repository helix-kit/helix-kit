'use client';

import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const layout = [
  { i: 'a', x: 0, y: 0, w: 2, h: 2 },
  { i: 'b', x: 2, y: 0, w: 2, h: 2 },
  { i: 'c', x: 4, y: 0, w: 2, h: 2 },
];

// Heavy feature: react-grid-layout + react-resizable + react-draggable.
export default function GridImpl() {
  return (
    <main>
      <h1>Dashboard grid</h1>
      <GridLayout className="layout" layout={layout} cols={6} rowHeight={60} width={720}>
        {layout.map((l) => (
          <div key={l.i} className="card">
            widget {l.i}
          </div>
        ))}
      </GridLayout>
    </main>
  );
}
