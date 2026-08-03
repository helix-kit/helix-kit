import Link from 'next/link';

import { loadEntityCounts } from '@/server/admin/queries';
import { ENTITIES, ENTITY_GROUPS } from '@/server/admin/registry';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin' };

const AdminIndexPage = async () => {
  const counts = await loadEntityCounts();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Every table is editable here. Work top-down: a manufacturer before its silicon, the
          silicon before its compute units, and a product before the interfaces it exposes.
        </p>
      </header>

      {ENTITY_GROUPS.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {group}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ENTITIES.filter((entity) => entity.group === group).map((entity) => (
              <Link
                key={entity.slug}
                className="border-border hover:border-primary/60 flex items-center justify-between rounded-lg border px-4 py-3 transition-colors"
                href={`/admin/${entity.slug}`}
              >
                <span className="text-sm">{entity.label}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {counts[entity.slug] ?? 0}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default AdminIndexPage;
