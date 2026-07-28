'use client';

import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const nodes: Node[] = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Trigger' } },
  { id: '2', position: { x: 200, y: 80 }, data: { label: 'Transform' } },
  { id: '3', position: { x: 400, y: 0 }, data: { label: 'Sink' } },
];
const edges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3' },
];

// Heavy feature: @xyflow/react bundles a large graph-editor runtime.
export default function WorkflowImpl() {
  return (
    <main>
      <h1>Workflows</h1>
      <div className="card" style={{ height: 400 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </main>
  );
}
