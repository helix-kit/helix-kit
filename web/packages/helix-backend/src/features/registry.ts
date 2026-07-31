// Registry of cloud-accessible device feature names (usage — route, scope, UI — lives at the call site); registration is by import side-effect via `defineFeature`, so an app that never imports a feature never registers it (see ./seed for the DB catalog).
export type FeatureDefinition = Readonly<{ key: string }>;

export class FeatureRegistry {
  readonly #features = new Map<string, FeatureDefinition>();

  // Idempotent — registering the same key twice returns the first definition.
  register(key: string): FeatureDefinition {
    const existing = this.#features.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const definition: FeatureDefinition = Object.freeze({ key });
    this.#features.set(key, definition);
    return definition;
  }

  has(key: string): boolean {
    return this.#features.has(key);
  }

  list(): FeatureDefinition[] {
    return [...this.#features.values()];
  }

  keys(): string[] {
    return [...this.#features.keys()];
  }
}

// Keyed on a global symbol so multiple copies of this package (e.g. duplicated by a bundler) share one registry.
const GLOBAL_KEY = Symbol.for('helix.featureRegistry');

const globalStore = globalThis as { [key: symbol]: unknown };
const existing = globalStore[GLOBAL_KEY];

export const featureRegistry: FeatureRegistry =
  existing instanceof FeatureRegistry
    ? existing
    : (globalStore[GLOBAL_KEY] = new FeatureRegistry());

// Register a feature at its usage site. Idempotent; returns the shared definition.
export const defineFeature = (key: string): FeatureDefinition => featureRegistry.register(key);
