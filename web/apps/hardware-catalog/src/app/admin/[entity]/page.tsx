import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Pagination } from '@/components/pagination';
import { ADMIN_PAGE_SIZE, childEntitiesOf, loadEntityScreen } from '@/server/admin/queries';
import { findEntity } from '@/server/admin/registry';

import { EntityAdmin } from './entity-admin';

import type { Metadata } from 'next';
import type { SearchParams } from 'nuqs/server';

type PageProps = {
  readonly params: Promise<{ entity: string }>;
  readonly searchParams: Promise<SearchParams>;
};

export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { entity } = await params;
  return { title: findEntity(entity)?.label ?? 'Admin' };
};

const EntityAdminPage = async ({ params, searchParams }: PageProps) => {
  const { entity: slug } = await params;
  const entity = findEntity(slug);
  if (entity == null) {
    notFound();
  }

  const query = await searchParams;
  const parentId = typeof query.parentId === 'string' ? query.parentId : undefined;
  const requestedPage = Number.parseInt(String(query.page ?? '1'), 10);
  const page = Number.isNaN(requestedPage) ? 1 : Math.max(1, requestedPage);
  const screen = await loadEntityScreen(slug, parentId, page);
  if (screen == null) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Link className="text-muted-foreground hover:text-foreground text-xs" href="/admin">
        ← All tables
      </Link>
      {parentId == null ? null : (
        <p className="text-muted-foreground text-xs">
          Filtered to one parent.{' '}
          <Link className="text-primary underline" href={`/admin/${slug}`}>
            Show all
          </Link>
        </p>
      )}
      <EntityAdmin
        fields={screen.fields}
        hasChildren={childEntitiesOf(slug).length > 0}
        hint={entity.hint}
        label={entity.label}
        listColumns={entity.listColumns}
        parentField={entity.parentField}
        referenceLabels={screen.referenceLabels}
        routerKey={entity.routerKey}
        rows={screen.rows}
        slug={entity.slug}
        total={screen.total}
      />
      <Pagination
        basePath={`/admin/${slug}`}
        page={page}
        params={{ parentId }}
        perPage={ADMIN_PAGE_SIZE}
        total={screen.total}
        unit="rows"
      />
    </div>
  );
};

export default EntityAdminPage;
