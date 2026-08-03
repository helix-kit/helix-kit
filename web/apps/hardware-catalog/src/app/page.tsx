import Link from 'next/link';

import { fetchQuery } from '@/server/server';

const SUMMARY_LIMIT = 1;

const HomePage = async () => {
  const [silicon, products] = await Promise.all([
    fetchQuery((trpc) => trpc.silicon.list.queryOptions({ limit: SUMMARY_LIMIT })),
    fetchQuery((trpc) => trpc.products.list.queryOptions({ limit: SUMMARY_LIMIT })),
  ]);

  const tiles = [
    { href: '/silicon', label: 'Silicon', count: silicon.total, hint: 'SoCs, MCUs, I/O chips' },
    { href: '/products', label: 'Products', count: products.total, hint: 'Modules, boards, kits' },
  ];

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Embedded hardware, as a graph</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Silicon capability and board exposure are modelled separately, compute engines are rows
          rather than a core count, and accelerator throughput always carries the precision it was
          measured at. Browse the silicon, then compare parts side by side.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            className="border-border hover:border-primary/60 rounded-lg border p-5 transition-colors"
            href={tile.href}
          >
            <div className="text-muted-foreground text-xs tracking-wide uppercase">{tile.hint}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{tile.count}</span>
              <span className="text-sm">{tile.label}</span>
            </div>
          </Link>
        ))}
      </section>

      {silicon.total === 0 ? (
        <p className="text-muted-foreground text-sm">
          The catalog is empty. Records are added through the write API — there is no seed data by
          design.
        </p>
      ) : null}
    </div>
  );
};

export default HomePage;
