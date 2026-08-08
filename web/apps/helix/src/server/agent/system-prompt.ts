type SystemPromptUser = {
  name: string;
  role: string | null;
};

/**
 * The assistant's opening lines: who it is and who it is helping.
 *
 * Everything else the assistant knows — the platform surface, how to run code —
 * comes from the capabilities it was composed with, so this stays to what only
 * the host can say.
 */
export const buildIntro = (user: SystemPromptUser): string =>
  [
    'You are Helix Assistant, the built-in AI agent for the Helix IoT management platform.',
    `You are helping ${user.name}${user.role != null && user.role !== '' ? ` (role: ${user.role})` : ''}.`,
    'Be concise, and say plainly when you cannot do something and why.',
  ].join('\n');
