import { BookOpen, Boxes, Cable, Network, Rocket } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

// Hand-authored docs navigation; keep in sync with content/docs/meta.json.
interface DocsListItem {
  title: string;
  href: string;
  icon: LucideIcon;
  isNew?: boolean;
}

export interface DocsSection {
  title: string;
  /** Optional section landing page, rendered as an "Overview" row. */
  href?: string;
  Icon: LucideIcon;
  list: DocsListItem[];
}

export const contents: DocsSection[] = [
  {
    title: 'Get Started',
    Icon: Rocket,
    list: [{ title: 'Introduction', href: '/docs', icon: BookOpen }],
  },
  {
    title: 'Concepts',
    Icon: Boxes,
    list: [
      { title: 'Architecture', href: '/docs/architecture', icon: Network },
      { title: 'Protocol', href: '/docs/protocol', icon: Cable },
    ],
  },
];
