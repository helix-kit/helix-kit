import {
  Bluetooth,
  Cable,
  Cloud,
  Cpu,
  Database,
  Globe,
  Radio,
  Server,
  Smartphone,
} from 'lucide-react';

/* The signature spine: a glowing double-helix running down the page with pulsing
 * nodes, and small platform icons orbiting a few of those nodes. Rendered with a
 * fixed viewBox stretched to the container (preserveAspectRatio="none") so it needs
 * NO client-side measurement — it can never fail to appear. All motion is CSS, so
 * it animates without waiting on hydration and respects `prefers-reduced-motion`. */

const W = 160;
const H = 2000;
const MID = W / 2;
const AMP = 44;
const WAVELENGTH = 250;
const STEP = 10;

const strand = (phase: number): string => {
  let d = '';
  for (let y = 0; y <= H; y += STEP) {
    const x = MID + AMP * Math.sin((y / WAVELENGTH) * Math.PI * 2 + phase);
    d += `${y === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y}`;
  }
  return d;
};

const rungs = (): { id: string; x1: number; x2: number; y: number }[] => {
  const out: { id: string; x1: number; x2: number; y: number }[] = [];
  const spacing = WAVELENGTH / 2;
  for (let y = spacing / 2; y <= H; y += spacing) {
    const a = MID + AMP * Math.sin((y / WAVELENGTH) * Math.PI * 2);
    const b = MID + AMP * Math.sin((y / WAVELENGTH) * Math.PI * 2 + Math.PI);
    out.push({ id: `r${y}`, x1: a, x2: b, y });
  }
  return out;
};

const STRAND_A = strand(0);
const STRAND_B = strand(Math.PI);
const RUNGS = rungs();

type Orbit = {
  top: string;
  ring: number;
  speed: number;
  icons: React.ComponentType<{ className?: string }>[];
};

const ORBITS: Orbit[] = [
  { top: '10%', ring: 116, speed: 26, icons: [Bluetooth, Radio, Cable] },
  { top: '35%', ring: 100, speed: 30, icons: [Cpu, Server] },
  { top: '60%', ring: 112, speed: 28, icons: [Cloud, Database] },
  { top: '84%', ring: 96, speed: 32, icons: [Smartphone, Globe] },
];

const OrbitNode = ({ top, ring, speed, icons }: Orbit) => (
  <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top }}>
    {/* ambient halo */}
    <div className="bg-brand/15 absolute top-1/2 left-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl" />
    {/* orbit path */}
    <div
      className="border-brand/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
      style={{ width: ring, height: ring }}
    />
    {/* pulsing core */}
    <div className="bg-brand relative size-3 [animation:node-pulse_3.5s_ease-in-out_infinite] rounded-full shadow-[0_0_18px_5px_var(--color-brand)] motion-reduce:animate-none" />
    {/* orbiting icons — each rides its own delayed ring, counter-rotated to stay upright */}
    {icons.map((Icon, i) => {
      const delay = `${(-speed / icons.length) * i}s`;
      return (
        <div
          key={`${top}-${Icon.name}`}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 [animation:orbit-spin_var(--dur)_linear_infinite] rounded-full motion-reduce:animate-none"
          style={
            {
              width: ring,
              height: ring,
              animationDelay: delay,
              '--dur': `${speed}s`,
            } as React.CSSProperties
          }
        >
          <span
            className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 [animation:orbit-spin-rev_var(--dur)_linear_infinite] motion-reduce:animate-none"
            style={{ animationDelay: delay, '--dur': `${speed}s` } as React.CSSProperties}
          >
            <span className="border-brand/40 bg-card/90 text-brand flex size-7 items-center justify-center rounded-lg border shadow-[0_0_12px_-2px_var(--color-brand)] backdrop-blur">
              <Icon className="size-3.5" />
            </span>
          </span>
        </div>
      );
    })}
  </div>
);

export const OrbitSpine = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0 hidden justify-end [mask-image:linear-gradient(to_bottom,transparent,black_4%,black_96%,transparent)] lg:flex"
  >
    {/* pinned near the right, with padding so it isn't flush to the edge */}
    <div className="relative mr-8 h-full w-[280px] lg:mr-14 xl:mr-24">
      <svg
        className="absolute inset-0 h-full w-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox={`0 0 ${W} ${H}`}
      >
        <defs>
          <linearGradient id="spine-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-brand-cyan)" />
            <stop offset="0.5" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-brand-deep)" />
          </linearGradient>
          <filter height="110%" id="spine-blur" width="240%" x="-70%" y="-5%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        {/* glow underlay */}
        <path
          d={STRAND_A}
          filter="url(#spine-blur)"
          opacity={0.55}
          stroke="url(#spine-grad)"
          strokeWidth={3}
        />
        <path
          d={STRAND_B}
          filter="url(#spine-blur)"
          opacity={0.55}
          stroke="url(#spine-grad)"
          strokeWidth={3}
        />

        {RUNGS.map((r) => (
          <line
            key={r.id}
            opacity={0.16}
            stroke="var(--color-brand)"
            strokeWidth={1}
            x1={r.x1}
            x2={r.x2}
            y1={r.y}
            y2={r.y}
          />
        ))}

        {/* crisp strands */}
        <path d={STRAND_A} opacity={0.6} stroke="url(#spine-grad)" strokeWidth={1.5} />
        <path d={STRAND_B} opacity={0.6} stroke="url(#spine-grad)" strokeWidth={1.5} />

        {/* flowing energy */}
        <path
          className="[animation:spine-flow_2.4s_linear_infinite] motion-reduce:hidden"
          d={STRAND_A}
          stroke="var(--color-brand-light)"
          strokeDasharray="4 316"
          strokeLinecap="round"
          strokeWidth={2.5}
        />
        <path
          className="[animation:spine-flow_2.4s_linear_infinite] motion-reduce:hidden"
          d={STRAND_B}
          stroke="var(--color-brand-light)"
          strokeDasharray="4 316"
          strokeLinecap="round"
          strokeWidth={2.5}
        />
      </svg>

      {ORBITS.map((o) => (
        <OrbitNode key={o.top} {...o} />
      ))}
    </div>
  </div>
);
