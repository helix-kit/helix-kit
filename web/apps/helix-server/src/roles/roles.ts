export type RoleCloser = () => Promise<void>;

// `dispatch` (Kafka -> Inngest / inline) and `workflow` (the Inngest serve
// endpoint) are opt-in: they only run when named explicitly, so existing
// deployments and load tests keep the historical gateway+ingest+writer topology.
const ROLES = ['gateway', 'ingest', 'writer', 'dispatch', 'workflow'] as const;
const DEFAULT_ROLES = ['gateway', 'ingest', 'writer'] as const;
type Role = (typeof ROLES)[number];

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

export const parseRoles = (value: string | undefined): Set<Role> => {
  if (value === undefined || value.trim() === '') {
    return new Set(DEFAULT_ROLES);
  }
  const roles = new Set<Role>();
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry === '') {
      continue;
    }
    if (!isRole(entry)) {
      throw new Error(`Unknown HELIX_SERVER_ROLES entry "${entry}"; expected ${ROLES.join(', ')}.`);
    }
    roles.add(entry);
  }
  if (roles.size === 0) {
    throw new Error('HELIX_SERVER_ROLES must name at least one role.');
  }
  return roles;
};
