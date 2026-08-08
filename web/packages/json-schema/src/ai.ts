import { definitionToJsonSchema, jsonSchemaToDefinition } from './definition';
import { jsonSchemaToTypeString } from './type-string';

import type { AiCapability, ArtifactSpec } from '@helix/ai-kit';
import type { JSONSchema } from 'zod/v4/core';

const SUPPORTED = `Schemas are authored against a deliberate subset of JSON Schema — enough to describe data that crosses a boundary, small enough that every case has an obvious editor control.

- Types: \`string\`, \`number\`, \`boolean\`, \`null\`, \`object\`, \`array\`, plus \`enum\` (as \`{"enum": [...]}\`), a literal (as \`{"const": ...}\`) and a union (as \`{"anyOf": [...]}\`).
- An object lists \`properties\` and names the mandatory ones in \`required\`. A property absent from \`required\` is optional.
- Nullable is \`{"anyOf": [<schema>, {"type": "null"}]}\`.
- An array declares \`items\`.

Anything outside this — \`allOf\`, \`$ref\`, \`patternProperties\`, tuple \`items\`, numeric or string constraints — is dropped when the schema is read back, so a schema relying on it will not mean what it says. Keep property names plain identifiers: they become field names in generated types.`;

/** The schema a well-formed schema must itself satisfy, loosely. */
const SCHEMA_ARGUMENT: JSONSchema.JSONSchema = {
  type: 'object',
  properties: {
    schema: { type: 'object', description: 'The JSON Schema to check.' },
  },
  required: ['schema'],
  additionalProperties: false,
};

export type SchemaAuthoringOptions = {
  id?: string;
  /** Artifact kinds this capability's checks apply to, for the prompt. */
  artifacts?: ArtifactSpec[];
};

/**
 * Authoring JSON Schemas that this system will actually honour.
 *
 * Exists because "write a JSON Schema" is not the real instruction — the real
 * one is "write a schema that survives the round trip through our editor model".
 * A model given the full specification reaches for `allOf` and `$ref`, which are
 * silently dropped on the way back in, so the schema a person then sees is not
 * the one that was written.
 */
export const jsonSchemaAuthoring = (options: SchemaAuthoringOptions = {}): AiCapability => {
  const { id = 'schema', artifacts = [] } = options;

  return {
    id,
    sections: [{ id: `${id}.subset`, title: 'Writing schemas', body: SUPPORTED }],
    artifacts,
    tools: [
      {
        name: 'check_schema',
        description:
          'Checks a JSON Schema against the supported subset and returns the TypeScript type it produces. Use it to confirm a schema means what you intended before relying on it.',
        parameters: SCHEMA_ARGUMENT,
        execute: (raw) => {
          const { schema } = raw as { schema: JSONSchema.JSONSchema };

          try {
            const definition = jsonSchemaToDefinition(schema);
            const roundTripped = definitionToJsonSchema(definition);
            const lost = JSON.stringify(roundTripped) !== JSON.stringify(schema);

            return {
              supported: true,
              type: jsonSchemaToTypeString(schema),
              // A round trip that changes the schema means the editor will show
              // something other than what was written — worth saying plainly
              // rather than leaving to be discovered later.
              note: lost
                ? 'Parts of this schema fall outside the supported subset and were dropped. The effective schema is the one below.'
                : undefined,
              effectiveSchema: lost ? roundTripped : undefined,
            };
          } catch (error) {
            return {
              supported: false,
              error: error instanceof Error ? error.message : 'Could not read the schema.',
            };
          }
        },
      },
    ],
  };
};
