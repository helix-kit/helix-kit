import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadRecordWorkspace } from '@/server/admin/queries';

import { RecordWorkspace } from './record-workspace';

import type { Metadata } from 'next';

type PageProps = { readonly params: Promise<{ entity: string; id: string }> };

const titleOf = (row: Record<string, unknown>, labelField: string): string => {
  const value = row[labelField] ?? row['name'] ?? row['id'];
  return typeof value === 'string' && value !== '' ? value : String(row['id']);
};

export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { entity, id } = await params;
  const workspace = await loadRecordWorkspace(entity, id);
  return {
    title: workspace == null ? 'Admin' : titleOf(workspace.row, workspace.entity.labelField),
  };
};

const RecordPage = async ({ params }: PageProps) => {
  const { entity, id } = await params;
  const workspace = await loadRecordWorkspace(entity, id);
  if (workspace == null) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Link
        className="text-muted-foreground hover:text-foreground text-xs"
        href={`/admin/${entity}`}
      >
        ← {workspace.entity.label}
      </Link>
      <RecordWorkspace
        entityLabel={workspace.entity.label}
        entitySlug={entity}
        fields={workspace.fields}
        referenceLabels={workspace.referenceLabels}
        routerKey={workspace.entity.routerKey}
        row={workspace.row}
        sections={workspace.sections}
        title={titleOf(workspace.row, workspace.entity.labelField)}
      />
    </div>
  );
};

export default RecordPage;
