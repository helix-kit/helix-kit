export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

export const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    throw new Error(`${label}: ${message}`, { cause: error });
  }
};
