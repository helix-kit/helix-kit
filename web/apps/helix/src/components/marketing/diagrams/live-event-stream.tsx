'use client';

import { useEffect, useRef, useState } from 'react';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { sampleEvents } from '@/lib/landing';

type Row = { id: number; time: string; device: string; field: string; value: string };

const pad = (n: number) => String(n).padStart(2, '0');
const clockFrom = (sec: number) => `12:${pad(41 + Math.floor(sec / 60))}:${pad(sec % 60)}`;

const makeRow = (id: number, sec: number): Row => {
  const e = sampleEvents[id % sampleEvents.length] ?? sampleEvents[0];
  return { id, time: clockFrom(sec), device: e.device, field: e.field, value: e.value };
};

// Fixed sparkline shape (a settled telemetry wiggle), sampled to path points.
const SPARK = [0.4, 0.5, 0.42, 0.6, 0.55, 0.7, 0.5, 0.62, 0.72, 0.58, 0.66, 0.8, 0.6, 0.74];
const SPARK_W = 128;
const SPARK_H = 34;
const points = SPARK.map((v, i) => ({
  x: (i / (SPARK.length - 1)) * SPARK_W,
  y: SPARK_H - v * (SPARK_H - 6) - 3,
}));
const lastPoint = points[points.length - 1] ?? { x: SPARK_W, y: SPARK_H / 2 };
const sparkPath = points
  .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
  .join(' ');

export const LiveEventStream = () => {
  const reduce = useReducedMotion() ?? false;
  const seed = useRef(0);
  const sec = useRef(2);
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: 4 }, (_, i) => makeRow(i, 2 + i * 3)),
  );

  useEffect(() => {
    seed.current = 4;
    sec.current = 2 + 4 * 3;
    if (reduce) {
      return;
    }
    const timer = setInterval(() => {
      sec.current += 3;
      const next = makeRow(seed.current, sec.current);
      seed.current += 1;
      setRows((prev) => [next, ...prev].slice(0, 4));
    }, 2400);
    return () => {
      clearInterval(timer);
    };
  }, [reduce]);

  return (
    <div className="border-border/70 bg-card/90 rounded-xl border p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
          Live Event Stream
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-green-400">
          <span className="size-1.5 animate-pulse rounded-full bg-green-400" />
          streaming
        </span>
      </div>

      {/* Fixed-height, clipped window: rows stream in without changing the card's
          height, so nothing below on the page shifts. */}
      <div className="grid h-[84px] grid-cols-[auto_1fr_auto] content-start gap-x-4 gap-y-1 overflow-hidden font-mono text-[11px]">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.div
              key={row.id}
              animate={{ opacity: 1, y: 0 }}
              className="col-span-3 grid grid-cols-subgrid items-center"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0, y: -6 }}
              layout
              transition={{ duration: 0.3 }}
            >
              <span className="text-muted-foreground/70">{row.time}</span>
              <span className="text-foreground/80 truncate">device/{row.device}</span>
              <span className="text-brand">
                {row.field} {row.value}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <svg
        className="mt-3 w-full"
        fill="none"
        height={SPARK_H}
        preserveAspectRatio="none"
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      >
        <path d={sparkPath} opacity={0.35} stroke="var(--color-brand)" strokeWidth={1.5} />
        <path
          className="[animation:spark-flow_2.5s_linear_infinite] motion-reduce:hidden"
          d={sparkPath}
          opacity={0.9}
          stroke="var(--color-brand-light)"
          strokeDasharray="16 144"
          strokeLinecap="round"
          strokeWidth={1.5}
        />
        <circle
          className="[animation:node-pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none"
          cx={lastPoint.x}
          cy={lastPoint.y}
          fill="var(--color-brand-light)"
          r={2.5}
        />
      </svg>
    </div>
  );
};
