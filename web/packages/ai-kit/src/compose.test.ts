import { describe, expect, it } from 'vitest';

import { composeAssistant, extendCapability } from './compose';

import type { AiCapability } from './types';

const OVERVIEW_ID = 'alpha.overview';
const OVERVIEW = 'alpha overview';
const REPLACED = 'Replaced.';

const tool = {
  name: 'run_code',
  description: 'Runs it.',
  parameters: { type: 'object' as const },
  execute: () => null,
};

const capability = (id: string, overrides: Partial<AiCapability> = {}): AiCapability => ({
  id,
  sections: [{ id: `${id}.overview`, title: `${id} overview`, body: `About ${id}.` }],
  tools: [],
  artifacts: [],
  ...overrides,
});

describe('composeAssistant', () => {
  it('renders each section under its title, in declared order', () => {
    const composed = composeAssistant([capability('alpha'), capability('beta')]);

    expect(composed.system).toBe(
      '## alpha overview\n\nAbout alpha.\n\n## beta overview\n\nAbout beta.',
    );
  });

  it('puts the intro before every section', () => {
    const composed = composeAssistant([capability('alpha')], { intro: 'You author reports.' });

    expect(composed.system.startsWith('You author reports.\n\n## alpha overview')).toBe(true);
  });

  it('lets a later capability override a section by id', () => {
    const composed = composeAssistant([
      capability('alpha'),
      capability('beta', {
        sections: [{ id: OVERVIEW_ID, title: OVERVIEW, body: REPLACED }],
      }),
    ]);

    expect(composed.sections).toHaveLength(1);
    expect(composed.sections[0]?.body).toBe(REPLACED);
  });

  it('keeps an overridden section where it first appeared', () => {
    const composed = composeAssistant([
      capability('alpha'),
      capability('beta'),
      capability('gamma', {
        sections: [{ id: OVERVIEW_ID, title: OVERVIEW, body: REPLACED }],
      }),
    ]);

    // Overriding changes what a section says, not where it sits — otherwise the
    // prompt reorders itself as capabilities are added.
    expect(composed.sections.map((section) => section.id)).toEqual([OVERVIEW_ID, 'beta.overview']);
  });

  it('applies host sections after every capability', () => {
    const composed = composeAssistant([capability('alpha')], {
      sections: [{ id: OVERVIEW_ID, title: OVERVIEW, body: 'Host wins.' }],
    });

    expect(composed.sections[0]?.body).toBe('Host wins.');
  });

  it('pools the tools of every capability', () => {
    const composed = composeAssistant([capability('alpha', { tools: [tool] }), capability('beta')]);

    expect(composed.tools.map((entry) => entry.name)).toEqual(['run_code']);
  });

  it('names both culprits when two capabilities claim one tool name', () => {
    expect(() =>
      composeAssistant([
        capability('alpha', { tools: [tool] }),
        capability('beta', { tools: [tool] }),
      ]),
    ).toThrow(/"alpha".*"beta"/);
  });

  it('rejects two capabilities producing the same artifact kind', () => {
    const artifact = { kind: 'report.code', description: 'The code.', mode: 'replace' as const };

    expect(() =>
      composeAssistant([
        capability('alpha', { artifacts: [artifact] }),
        capability('beta', { artifacts: [artifact] }),
      ]),
    ).toThrow(/artifact kind "report.code"/);
  });
});

describe('extendCapability', () => {
  it('replaces a section the capability already had', () => {
    const extended = extendCapability(capability('alpha'), {
      sections: [{ id: OVERVIEW_ID, title: OVERVIEW, body: 'Host context.' }],
    });

    expect(extended.sections).toHaveLength(1);
    expect(extended.sections[0]?.body).toBe('Host context.');
  });

  it('appends a section the capability did not have', () => {
    const extended = extendCapability(capability('alpha'), {
      sections: [
        { id: 'alpha.host-functions', title: 'Host functions', body: 'trpc(path, input)' },
      ],
    });

    expect(extended.sections.map((section) => section.id)).toEqual([
      OVERVIEW_ID,
      'alpha.host-functions',
    ]);
  });

  it('leaves the original alone, so two hosts can extend it differently', () => {
    const base = capability('alpha');
    extendCapability(base, {
      sections: [{ id: OVERVIEW_ID, title: OVERVIEW, body: 'Mutated?' }],
    });

    expect(base.sections[0]?.body).toBe('About alpha.');
  });
});
