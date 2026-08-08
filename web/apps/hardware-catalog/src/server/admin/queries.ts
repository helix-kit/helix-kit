import 'server-only';

import { count, desc, eq, getTableColumns } from 'drizzle-orm';

import type { AdminRow, FieldMeta } from '@/lib/field-meta';

import { ENTITIES, entitySlugForTable, findEntity, type EntityDefinition } from './registry';
import { describeTable } from './table-meta';

import type { PgColumn } from 'drizzle-orm/pg-core';

import { db } from '../db';

/**
 * Server-side reads for the admin screens. Lists are read straight from the database — the
 * admin needs whole rows and no shaping — while every write still goes through the tRPC
 * routers, which own validation.
 */

export const ADMIN_PAGE_SIZE = 50;
const OPTION_LIMIT = 500;

const columnOf = (entity: EntityDefinition, name: string): PgColumn | undefined =>
  (getTableColumns(entity.table) as Record<string, PgColumn>)[name];

/** id → display label for one entity, used to fill foreign-key pickers. */
const loadOptions = async (entity: EntityDefinition) => {
  const idColumn = columnOf(entity, 'id');
  const labelColumn = columnOf(entity, entity.labelField) ?? idColumn;
  if (idColumn == null || labelColumn == null) {
    return [];
  }

  const rows = await db
    .select({ value: idColumn, label: labelColumn })
    .from(entity.table)
    .limit(OPTION_LIMIT);

  return rows.map((row) => ({
    value: String(row.value),
    label: row.label == null || row.label === '' ? String(row.value) : String(row.label),
  }));
};

export type EntityScreen = {
  fields: FieldMeta[];
  rows: AdminRow[];
  total: number;
  referenceLabels: Record<string, string>;
};

/** Everything one admin screen needs: its fields, its rows, and the labels behind its FK ids. */
export const loadEntityScreen = async (
  slug: string,
  parentId?: string,
  page = 1,
): Promise<EntityScreen | null> => {
  const entity = findEntity(slug);
  if (entity == null) {
    return null;
  }

  const fields = describeTable(entity.table, entitySlugForTable);

  const parentColumn =
    parentId == null || entity.parentField == null
      ? undefined
      : columnOf(entity, entity.parentField);
  const where = parentColumn == null || parentId == null ? undefined : eq(parentColumn, parentId);
  const createdAt = columnOf(entity, 'createdAt');

  const listQuery = db
    .select()
    .from(entity.table)
    .where(where)
    .limit(ADMIN_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PAGE_SIZE);

  const [rows, totals] = await Promise.all([
    createdAt == null ? listQuery : listQuery.orderBy(desc(createdAt)),
    db.select({ value: count() }).from(entity.table).where(where),
  ]);

  // Every distinct entity referenced by a foreign key on this table, loaded once.
  const referencedSlugs = [
    ...new Set(
      fields.flatMap((field) => (field.referenceEntity == null ? [] : [field.referenceEntity])),
    ),
  ];

  const optionsBySlug = new Map(
    await Promise.all(
      referencedSlugs.map(async (referencedSlug) => {
        const referenced = findEntity(referencedSlug);
        return [referencedSlug, referenced == null ? [] : await loadOptions(referenced)] as const;
      }),
    ),
  );

  const referenceLabels: Record<string, string> = {};
  for (const options of optionsBySlug.values()) {
    for (const option of options) {
      referenceLabels[option.value] = option.label;
    }
  }

  return {
    fields: fields.map((field) =>
      field.referenceEntity == null
        ? field
        : { ...field, options: optionsBySlug.get(field.referenceEntity) ?? [] },
    ),
    rows: rows as AdminRow[],
    total: totals[0]?.value ?? 0,
    referenceLabels,
  };
};

/** Row counts for the admin index, so it is obvious what has data and what does not. */
export const loadEntityCounts = async (): Promise<Record<string, number>> => {
  const counts = await Promise.all(
    ENTITIES.map(async (entity) => {
      const [row] = await db.select({ value: count() }).from(entity.table);
      return [entity.slug, row?.value ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts);
};

/**
 * Entities whose owner column points at `parentSlug`. Derived from the foreign keys rather than
 * declared, so a new child table shows up on its parent's page without another registry entry.
 */
export const childEntitiesOf = (parentSlug: string): EntityDefinition[] =>
  ENTITIES.filter((entity) => {
    if (entity.parentField == null) {
      return false;
    }
    const parentField = describeTable(entity.table, entitySlugForTable).find(
      (field) => field.name === entity.parentField,
    );
    return parentField?.referenceEntity === parentSlug;
  });

type ChildSection = {
  slug: string;
  label: string;
  hint?: string;
  routerKey: string;
  /** Owner column, injected on save and hidden from the form. */
  parentField: string;
  fields: FieldMeta[];
  columns: string[];
  rows: AdminRow[];
};

export type RecordWorkspace = {
  entity: EntityDefinition;
  fields: FieldMeta[];
  row: AdminRow;
  referenceLabels: Record<string, string>;
  sections: ChildSection[];
};

const CHILD_ROW_LIMIT = 100;

/**
 * Everything needed to edit one record on one page: its own fields plus every collection that
 * hangs off it. Without this, editing a product means visiting a dozen separate tables and
 * re-selecting the same parent in each one.
 */
export const loadRecordWorkspace = async (
  slug: string,
  id: string,
): Promise<RecordWorkspace | null> => {
  const entity = findEntity(slug);
  if (entity == null) {
    return null;
  }

  const idColumn = columnOf(entity, 'id');
  if (idColumn == null) {
    return null;
  }

  const [row] = await db.select().from(entity.table).where(eq(idColumn, id)).limit(1);
  if (row == null) {
    return null;
  }

  const ownFields = describeTable(entity.table, entitySlugForTable);
  const children = childEntitiesOf(slug);

  // One options load per referenced entity across the record and all of its children.
  const referencedSlugs = new Set<string>();
  const childFields = new Map<string, FieldMeta[]>();
  for (const field of ownFields) {
    if (field.referenceEntity != null) {
      referencedSlugs.add(field.referenceEntity);
    }
  }
  for (const child of children) {
    const fields = describeTable(child.table, entitySlugForTable);
    childFields.set(child.slug, fields);
    for (const field of fields) {
      if (field.referenceEntity != null) {
        referencedSlugs.add(field.referenceEntity);
      }
    }
  }

  const optionsBySlug = new Map(
    await Promise.all(
      [...referencedSlugs].map(async (referencedSlug) => {
        const referenced = findEntity(referencedSlug);
        return [referencedSlug, referenced == null ? [] : await loadOptions(referenced)] as const;
      }),
    ),
  );

  const referenceLabels: Record<string, string> = {};
  for (const options of optionsBySlug.values()) {
    for (const option of options) {
      referenceLabels[option.value] = option.label;
    }
  }

  const withOptions = (fields: FieldMeta[]): FieldMeta[] =>
    fields.map((field) =>
      field.referenceEntity == null
        ? field
        : { ...field, options: optionsBySlug.get(field.referenceEntity) ?? [] },
    );

  const sections = await Promise.all(
    children.map(async (child) => {
      const parentColumn =
        child.parentField == null ? undefined : columnOf(child, child.parentField);
      const rows =
        parentColumn == null
          ? []
          : await db.select().from(child.table).where(eq(parentColumn, id)).limit(CHILD_ROW_LIMIT);

      return {
        slug: child.slug,
        label: child.label,
        hint: child.hint,
        routerKey: child.routerKey,
        parentField: child.parentField ?? '',
        // The owner column is injected on save, so it has no business in the form.
        fields: withOptions(childFields.get(child.slug) ?? []).filter(
          (field) => field.name !== child.parentField,
        ),
        columns: child.listColumns.filter((column) => column !== child.parentField),
        rows: rows as AdminRow[],
      } satisfies ChildSection;
    }),
  );

  return {
    entity,
    fields: withOptions(ownFields),
    row: row as AdminRow,
    referenceLabels,
    sections,
  };
};
