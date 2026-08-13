'use client';

import { z } from 'zod';

import type { AdminRow, FieldMeta } from '@/lib/field-meta';

import type { FormField } from '@helix-hq/design-system/components/dynamic-form-fields';

/**
 * The client half of the derived form: turns the server's field descriptors into a zod schema
 * and design-system field descriptors, and marshals values in both directions. Authority still
 * sits with the server — its input schema is derived from the same columns.
 */

const NONE = '__none__';

const baseSchema = (field: FieldMeta): z.ZodType => {
  switch (field.valueKind) {
    case 'number':
      return z.coerce.number();
    case 'boolean':
      return z.boolean();
    case 'stringArray':
      return z.array(z.string());
    case 'date':
      return z.coerce.date();
    case 'string':
    case 'json':
      return z.string();
    default:
      return z.string();
  }
};

const ISO_DATE_LENGTH = 10;

/** The blank a widget starts from, per value kind. */
const emptyFor = (field: FieldMeta): unknown => {
  if (field.valueKind === 'boolean') {
    return false;
  }
  return field.valueKind === 'stringArray' ? [] : '';
};

/** Blank inputs must read as "not provided", not as `0`, `""` or `Invalid Date`. */
const blank = (value: unknown): boolean =>
  value === '' || value == null || value === NONE || (Array.isArray(value) && value.length === 0);

export const schemaForFields = (fields: readonly FieldMeta[]): z.ZodObject => {
  const shape: Record<string, z.ZodType> = {};

  for (const field of fields) {
    if (field.required) {
      shape[field.name] =
        field.valueKind === 'string'
          ? z.string().min(1, `${field.label} is required`)
          : baseSchema(field);
      continue;
    }
    shape[field.name] = z.preprocess(
      (value) => (blank(value) ? undefined : value),
      baseSchema(field).optional(),
    );
  }

  return z.object(shape);
};

export const formFieldsFor = (fields: readonly FieldMeta[]): FormField[] =>
  fields.map((field) => ({
    name: field.name,
    label: field.required ? `${field.label} *` : field.label,
    type: field.widget,
    placeholder: field.placeholder,
    options:
      field.widget !== 'select'
        ? undefined
        : [
            ...(field.required ? [] : [{ label: '— none —', value: NONE }]),
            ...(field.options ?? []),
          ],
  }));

/** Empty starting values, typed so react-hook-form does not treat inputs as uncontrolled. */
export const emptyValues = (fields: readonly FieldMeta[]): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field.name, emptyFor(field)]));

/** Existing row → form values. Dates and JSON become the text the widgets show. */
export const rowToValues = (fields: readonly FieldMeta[], row: AdminRow): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((field) => {
      const value = row[field.name];
      if (value == null) {
        return [field.name, emptyFor(field)];
      }
      if (field.valueKind === 'date' && value instanceof Date) {
        return [field.name, value.toISOString().slice(0, ISO_DATE_LENGTH)];
      }
      if (field.valueKind === 'json') {
        return [field.name, JSON.stringify(value, null, 2)];
      }
      return [field.name, value];
    }),
  );

/**
 * Form values → the mutation payload. Omitted keys let the column's own default apply, which
 * is why blanks are dropped rather than sent as empty strings.
 */
export const valuesToPayload = (
  fields: readonly FieldMeta[],
  values: Record<string, unknown>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];
    if (blank(value) || (typeof value === 'number' && Number.isNaN(value))) {
      continue;
    }
    if (field.valueKind === 'json' && typeof value === 'string') {
      payload[field.name] = JSON.parse(value);
      continue;
    }
    payload[field.name] = value;
  }

  return payload;
};
