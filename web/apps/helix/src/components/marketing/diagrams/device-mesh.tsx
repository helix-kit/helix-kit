import { Cpu, Server, Smartphone } from 'lucide-react';

const nodes = [
  { id: 'a', Icon: Cpu, left: '50%', top: '22%', x: 200, y: 70, delay: 0 },
  { id: 'b', Icon: Server, left: '22%', top: '72%', x: 88, y: 232, delay: 0.4 },
  { id: 'c', Icon: Smartphone, left: '78%', top: '72%', x: 312, y: 232, delay: 0.8 },
];

const CENTER = { x: 200, y: 172 };

export const DeviceMesh = () => (
  <div className="relative mx-auto aspect-[4/3.2] w-full max-w-md">
    <svg className="absolute inset-0 h-full w-full" fill="none" viewBox="0 0 400 320">
      <defs>
        <filter height="200%" id="mesh-floor" width="200%" x="-50%" y="-50%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>

      <ellipse
        cx="200"
        cy="250"
        fill="var(--color-brand)"
        filter="url(#mesh-floor)"
        opacity="0.14"
        rx="120"
        ry="26"
      />

      <g opacity="0.35" stroke="var(--color-border)" strokeWidth="1">
        <path d="M28 34 L372 34 L372 286 L28 286 Z" />
        <path d="M140 108 L260 108 L260 208 L140 208 Z" opacity="0.7" />
        <path d="M28 34 L140 108 M372 34 L260 108 M372 286 L260 208 M28 286 L140 208" />
      </g>

      {nodes.map((n) => (
        <line
          key={n.id}
          className="animate-[mesh-flow_0.7s_linear_infinite] motion-reduce:animate-none"
          opacity="0.7"
          stroke="var(--color-brand)"
          strokeDasharray="4 10"
          strokeWidth="1.5"
          x1={CENTER.x}
          x2={n.x}
          y1={CENTER.y}
          y2={n.y}
        />
      ))}
    </svg>

    <div
      className="absolute"
      style={{ left: '50%', top: '54%', transform: 'translate(-50%,-50%)' }}
    >
      <div className="border-brand bg-brand/10 relative flex size-12 items-center justify-center rounded-full border shadow-[0_0_24px_-2px_var(--color-brand)]">
        <span className="bg-brand size-2.5 animate-pulse rounded-full" />
      </div>
    </div>

    {nodes.map((n) => (
      <div
        key={n.id}
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: n.left, top: n.top }}
      >
        <div
          className="border-border/70 bg-card text-brand flex size-11 [animation:float-bob_3s_ease-in-out_infinite] items-center justify-center rounded-xl border shadow-lg motion-reduce:animate-none"
          style={{ animationDelay: `${n.delay}s` }}
        >
          <n.Icon className="size-5" />
        </div>
      </div>
    ))}
  </div>
);
