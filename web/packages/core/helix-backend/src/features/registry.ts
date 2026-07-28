// The feature registry: the machinery a consuming app uses to register the
// cloud-accessible device features it actually ships. By design a feature
// definition is *only a name* — the registry deliberately does not know how a
// feature is used (its route, gateway scope, UI, or default). Those live at the
// usage site, in the app that consumes this package.
//
// Registration is by import side-effect: an app declares `defineFeature('x')`
// co-located with the code that uses feature `x`, so a feature is registered
// only when that code is actually imported into the build. A custom server that
// never imports feature X never registers X. A build/startup step then reads the
// populated registry and seeds the DB catalog (see ./seed).

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

// A single registry instance shared across every module in the process. Keyed on
// a global symbol so that multiple copies of this package (e.g. duplicated by a
// bundler) still populate one registry rather than several disjoint ones.
const GLOBAL_KEY = Symbol.for('helix.featureRegistry');

const globalStore = globalThis as { [key: symbol]: unknown };
const existing = globalStore[GLOBAL_KEY];

export const featureRegistry: FeatureRegistry =
  existing instanceof FeatureRegistry
    ? existing
    : (globalStore[GLOBAL_KEY] = new FeatureRegistry());

// Register a feature at its usage site. Idempotent; returns the shared definition.
export const defineFeature = (key: string): FeatureDefinition => featureRegistry.register(key);
