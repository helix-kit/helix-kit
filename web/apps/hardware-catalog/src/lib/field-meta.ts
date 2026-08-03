/**
 * The description of one editable column, derived on the server from the drizzle table and
 * handed to the client form. Shared type only — no schema import, so it is safe in a client
 * component.
 *
 * `widget` is what to render; `valueKind` is what the server expects back. They are separate
 * because a date is typed into a plain text box but must arrive as a `Date`.
 */
export type FieldMeta = {
  name: string;
  label: string;
  widget: 'input' | 'url' | 'number' | 'textarea' | 'checkbox' | 'select' | 'stringArray';
  valueKind: 'string' | 'number' | 'boolean' | 'date' | 'stringArray' | 'json';
  required: boolean;
  /** Populated for enum columns, and for foreign keys once the referenced rows are resolved. */
  options?: { label: string; value: string }[];
  /** Entity slug this column points at, when it is a foreign key. */
  referenceEntity?: string;
  placeholder?: string;
};

/** A row as the admin table sees it — the routers return plain objects keyed by column name. */
export type AdminRow = Record<string, unknown> & { id: string };
