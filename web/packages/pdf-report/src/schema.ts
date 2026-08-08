import { reportCatalog } from './catalog';
import { isObjectRecord } from './json';

/**
 * A JSON Schema for a report template, for a JSON editor's language service.
 *
 * Two departures from `catalog.jsonSchema()` as it comes out:
 *
 * - `visible` is dropped from `required`. The catalog models what an LLM should
 *   emit, where every field is spelled out; a hand-authored template omits it.
 * - Per-component prop shapes are not included, because the catalog cannot
 *   express them here — `props` is typed by `propsOf`, a dynamic-key record,
 *   which JSON Schema renders as an opaque object. Component *names* are a
 *   plain enum, so completion and validation on `type` do work, which is where
 *   most authoring mistakes are. `catalog.prompt()` carries the prop shapes for
 *   the cases that need them.
 */
export const reportSpecJsonSchema = (): object => {
  const schema = reportCatalog.jsonSchema();

  if (!isObjectRecord(schema)) {
    return schema;
  }

  const properties = schema.properties as
    Record<string, Record<string, Record<string, unknown>>> | undefined;
  const element = properties?.elements?.additionalProperties;

  if (isObjectRecord(element) && Array.isArray(element.required)) {
    element.required = element.required.filter((key) => key !== 'visible');
  }

  return schema;
};
