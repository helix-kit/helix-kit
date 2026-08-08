export { composeAssistant, extendCapability, type ComposeOptions } from './compose';
export { artifactTools, type ArtifactEmitter } from './artifact-tools';
export { coerceArguments } from './coerce';
export {
  createArtifactCollector,
  type ArtifactCollector,
  type ArtifactEvent,
  type ArtifactHandlers,
} from './artifact-stream';
export type {
  AiCapability,
  AiToolDescriptor,
  ArtifactMode,
  ArtifactSpec,
  ComposedAssistant,
  PromptSection,
} from './types';
