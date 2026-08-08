import type {
  AiCapability,
  AiToolDescriptor,
  ArtifactSpec,
  ComposedAssistant,
  PromptSection,
} from './types';

export type ComposeOptions = {
  /** Opening text, before any capability's sections. Describes the task at hand. */
  intro?: string;
  /**
   * Sections applied last, so a host can override anything a capability says
   * about itself, or add cross-cutting sections of its own.
   */
  sections?: PromptSection[];
};

const renderSection = (section: PromptSection): string => `## ${section.title}\n\n${section.body}`;

/**
 * Merges sections by id, keeping each id at the position it first appeared.
 *
 * Position is held deliberately: an override is meant to change what a section
 * says, not where it sits. If a later override moved its section to the end, the
 * prompt would silently reorder itself as capabilities were added, and prompt
 * order is not incidental — it is what establishes context before the parts that
 * depend on it.
 */
const mergeSections = (groups: PromptSection[][]): PromptSection[] => {
  const order: string[] = [];
  const byId = new Map<string, PromptSection>();

  for (const group of groups) {
    for (const section of group) {
      if (!byId.has(section.id)) {
        order.push(section.id);
      }
      byId.set(section.id, section);
    }
  }

  return order.map((id) => byId.get(id) as PromptSection);
};

/**
 * Extends a capability with extra sections, returning a new one.
 *
 * The mechanism by which a host adapts a piece to its own setting: an id that
 * already exists replaces that section, a new id appends one. The original is
 * untouched, so the same capability can be extended differently by two hosts in
 * the same process.
 */
export const extendCapability = (
  capability: AiCapability,
  extension: {
    sections?: PromptSection[];
    tools?: AiToolDescriptor[];
    artifacts?: ArtifactSpec[];
  },
): AiCapability => ({
  id: capability.id,
  sections: mergeSections([capability.sections, extension.sections ?? []]),
  tools: [...capability.tools, ...(extension.tools ?? [])],
  artifacts: [...capability.artifacts, ...(extension.artifacts ?? [])],
});

const collectUnique = <Item>(
  capabilities: AiCapability[],
  select: (capability: AiCapability) => Item[],
  keyOf: (item: Item) => string,
  label: string,
): Item[] => {
  const seen = new Map<string, string>();
  const items: Item[] = [];

  for (const capability of capabilities) {
    for (const item of select(capability)) {
      const key = keyOf(item);
      const owner = seen.get(key);
      if (owner !== undefined) {
        // Left to the model, a duplicate is a coin toss over which one runs;
        // failing here names both culprits while a person is still looking.
        throw new Error(
          `Duplicate ${label} "${key}": declared by both "${owner}" and "${capability.id}".`,
        );
      }
      seen.set(key, capability.id);
      items.push(item);
    }
  }

  return items;
};

/**
 * Assembles capabilities into the single assistant a host runs.
 *
 * Sections merge by id in declared order; tools and artifacts are pooled, and a
 * collision in either is an error rather than a silent last-one-wins, because
 * both are addressed by name and the model has no way to tell two apart.
 */
export const composeAssistant = (
  capabilities: AiCapability[],
  options: ComposeOptions = {},
): ComposedAssistant => {
  const sections = mergeSections([
    ...capabilities.map((capability) => capability.sections),
    options.sections ?? [],
  ]);

  const parts = sections.map(renderSection);
  const intro = options.intro?.trim();

  return {
    system: (intro === undefined || intro.length === 0 ? parts : [intro, ...parts]).join('\n\n'),
    sections,
    tools: collectUnique(
      capabilities,
      (capability) => capability.tools,
      (tool) => tool.name,
      'tool',
    ),
    artifacts: collectUnique(
      capabilities,
      (capability) => capability.artifacts,
      (artifact) => artifact.kind,
      'artifact kind',
    ),
  };
};
