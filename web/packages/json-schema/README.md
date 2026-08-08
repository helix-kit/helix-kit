# @helix/json-schema

Authoring JSON Schemas, and turning them into TypeScript.

Two things live here, both needed wherever a user defines the shape of some data:
a **schema editor** that avoids making people hand-write JSON Schema, and a
**TypeScript emitter** that makes a schema usable by a code editor.

## Exports

| Entry                        | Contents                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `@helix/json-schema`         | `SchemaDefinition` and its converters, `toObjectSchema`, `jsonSchemaToTypeString` |
| `@helix/json-schema/builder` | `JsonSchemaBuilder` — the React property editor                                   |

## `SchemaDefinition`

JSON Schema is a poor thing to edit directly: nullability, optionality and unions
are all nested combinators, so a single "this field is an optional nullable
string" is three levels of structure. `SchemaDefinition` flattens that into what
an author actually thinks about — a type, plus `required` and `nullable` flags —
and `definitionToJsonSchema` / `jsonSchemaToDefinition` convert both ways.

The conversion round-trips: every `SchemaType` survives definition → JSON Schema →
definition unchanged, including nesting and per-property flags.

## `jsonSchemaToTypeString`

Emits TypeScript source for a schema. This is what makes a bound code editor
typesafe — the result is injected into Monaco as `declare const input: <this>`,
so an author gets completion and inline errors against the real shape:

```ts
jsonSchemaToTypeString(
  z.toJSONSchema(z.object({ devices: z.array(z.object({ faults: z.number() })) })),
);
// { devices: { faults: number; }[]; }
```

It covers what `z.toJSONSchema()` emits: objects, arrays, tuples, unions,
intersections, enums, `const`, nullable, `$ref`/`$defs`, optional properties and
records.

## On degrading rather than throwing

Every entry point returns something usable for input it cannot model — `unknown`
for an unresolvable schema, an empty object for a malformed one. A schema under
active editing is frequently incomplete, and an editor that throws on a
half-written schema loses the author's work; one that briefly says `unknown` does
not.
