import { jsonSchemaToTypeString } from '@helix/json-schema';

import type { HostFunctions } from './types';
import type { JSONSchema } from 'zod/v4/core';

/**
 * TypeScript declarations describing the environment a run provides.
 *
 * Fed to Monaco via `addExtraLib`, this is what turns the code pane typesafe:
 * `input` gets the shape of the input schema, and every registered function gets
 * a real signature, so an author sees completion and inline errors rather than
 * discovering a typo when the run fails.
 *
 * Kept beside the executor because it must describe exactly what the executor
 * binds — a declaration that drifts from the runtime is worse than none.
 */
export const describeEnvironment = ({
  inputSchema,
  functions = {},
}: {
  inputSchema?: JSONSchema._JSONSchema;
  functions?: HostFunctions;
}): string => {
  const inputType = inputSchema === undefined ? 'unknown' : jsonSchemaToTypeString(inputSchema);

  const declarations = Object.entries(functions).map(([name, entry]) => {
    const parameter =
      entry.parameters === undefined ? 'unknown' : jsonSchemaToTypeString(entry.parameters);
    const returns = entry.returns === undefined ? 'unknown' : jsonSchemaToTypeString(entry.returns);
    const doc = entry.description === undefined ? '' : `/** ${entry.description} */\n`;

    // Host calls block via asyncify, so the guest sees a plain return type. A
    // Promise here would invite `await`, which this sandbox cannot support.
    return `${doc}declare function ${name}(argument: ${parameter}): ${returns};`;
  });

  return [`declare const input: ${inputType};`, ...declarations].join('\n\n');
};
