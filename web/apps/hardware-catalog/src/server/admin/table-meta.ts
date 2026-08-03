import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import type { FieldMeta } from '@/lib/field-meta';
import { humanize } from '@/lib/format';

import { dataTypeOf } from '../zod-table';

/**
 * Turns a drizzle table into form fields, the same way `zod-table.ts` turns it into an input
 * schema. Forty-two hand-written forms would drift from their tables within a week; deriving
 * both from the column definitions means adding a column adds its input everywhere.
 */

/** Columns the server owns. */
const MANAGED = new Set(['id', 'createdAt', 'updatedAt']);

/** Free text long enough to deserve a textarea rather than a single line. */
const LONG_TEXT = new Set([
  'description',
  'summary',
  'notes',
  'instructions',
  'wording',
  'quotedText',
  'muxNotes',
  'conditions',
  'reviewNotes',
  'mountingSummary',
  'detail',
  'impact',
  'shockVibrationSpec',
  'selectionMethod',
]);

type Widget = FieldMeta['widget'];
type ValueKind = FieldMeta['valueKind'];

const classify = (name: string, column: PgColumn): { widget: Widget; valueKind: ValueKind } => {
  if (column.enumValues != null && column.enumValues.length > 0) {
    return { widget: 'select', valueKind: 'string' };
  }
  if (column.dimensions > 0) {
    return { widget: 'stringArray', valueKind: 'stringArray' };
  }
  switch (dataTypeOf(column)) {
    case 'boolean':
      return { widget: 'checkbox', valueKind: 'boolean' };
    case 'number':
      return { widget: 'number', valueKind: 'number' };
    // Typed into a plain box (the date picker fights ISO input) and coerced on submit.
    case 'date':
      return { widget: 'input', valueKind: 'date' };
    case 'json':
      return { widget: 'textarea', valueKind: 'json' };
    default:
      break;
  }
  if (name.endsWith('Url')) {
    return { widget: 'url', valueKind: 'string' };
  }
  return { widget: LONG_TEXT.has(name) ? 'textarea' : 'input', valueKind: 'string' };
};

const placeholderFor = (valueKind: ValueKind): string | undefined => {
  if (valueKind === 'date') {
    return 'YYYY-MM-DD';
  }
  return valueKind === 'json' ? '{ }' : undefined;
};

/** Column property name → the SQL table its foreign key points at. */
const foreignKeyTargets = (table: PgTable): Map<string, string> => {
  const columnsByDbName = new Map(
    Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]),
  );

  const targets = new Map<string, string>();
  for (const foreignKey of getTableConfig(table).foreignKeys) {
    const reference = foreignKey.reference();
    const [local] = reference.columns;
    const foreignTable = reference.foreignTable as unknown as Record<symbol, string>;
    const foreignName = foreignTable[Symbol.for('drizzle:Name')];
    const propertyName = local == null ? undefined : columnsByDbName.get(local.name);
    if (propertyName != null && foreignName != null) {
      targets.set(propertyName, foreignName);
    }
  }
  return targets;
};

/** Splits `maxClockMhz` into `Max Clock Mhz` before the shared acronym pass runs. */
const labelFor = (name: string): string => humanize(name.replace(/([A-Z])/g, ' $1').trim());

/**
 * `resolveEntity` maps a SQL table name to the admin entity slug that edits it, so a foreign
 * key renders as a picker over real rows instead of a raw id box.
 */
export const describeTable = (
  table: PgTable,
  resolveEntity: (sqlTableName: string) => string | undefined,
): FieldMeta[] => {
  const references = foreignKeyTargets(table);

  return Object.entries(getTableColumns(table)).flatMap(([name, column]) => {
    if (MANAGED.has(name)) {
      return [];
    }

    const referencedTable = references.get(name);
    const referenceEntity = referencedTable == null ? undefined : resolveEntity(referencedTable);
    const classified = classify(name, column);
    const widget = referenceEntity == null ? classified.widget : 'select';

    return [
      {
        name,
        label: labelFor(name),
        widget,
        valueKind: classified.valueKind,
        required: column.notNull && !column.hasDefault,
        options:
          column.enumValues == null
            ? undefined
            : column.enumValues.map((value) => ({ label: humanize(value), value })),
        referenceEntity,
        placeholder: placeholderFor(classified.valueKind),
      } satisfies FieldMeta,
    ];
  });
};
