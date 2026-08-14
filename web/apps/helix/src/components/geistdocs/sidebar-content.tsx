import {
  BookOpen,
  Boxes,
  Cable,
  FileCode2,
  FileText,
  Network,
  Package,
  Rocket,
} from 'lucide-react';

import type * as PageTree from 'fumadocs-core/page-tree';
import type { LucideIcon } from 'lucide-react';

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

/**
 * Icons are the only hand-maintained part of the navigation. A page with no
 * entry gets a sensible default rather than being dropped, so adding docs never
 * requires touching this file.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  'Get Started': Rocket,
  Concepts: Boxes,
  Packages: Package,
  'API Reference': FileCode2,
};

const PAGE_ICONS: Record<string, LucideIcon> = {
  '/docs': BookOpen,
  '/docs/architecture': Network,
  '/docs/protocol': Cable,
};

const toItem = (node: PageTree.Item): DocsListItem => ({
  title: typeof node.name === 'string' ? node.name : node.url,
  href: node.url,
  icon: PAGE_ICONS[node.url] ?? FileText,
});

/** Pages directly inside a folder, including any nested one level down. */
const folderItems = (nodes: PageTree.Node[]): DocsListItem[] =>
  nodes.flatMap((node) => {
    if (node.type === 'page') {
      return [toItem(node)];
    }
    if (node.type === 'folder') {
      return folderItems(node.children);
    }
    return [];
  });

/**
 * Builds the sidebar from the page tree fumadocs derives from `content/docs`.
 *
 * Previously this file was a hand-written list with a comment asking whoever
 * edited it to keep it in sync with `meta.json`. It drifted the first time it
 * was tested: the PDF-report page shipped, was live, and was unreachable —
 * nothing linked to it. Deriving the nav removes the second source of truth.
 */
export const buildSections = (tree: PageTree.Root): DocsSection[] => {
  const sections: DocsSection[] = [];
  let current: DocsSection | null = null;

  for (const node of tree.children) {
    if (node.type === 'separator') {
      const title = typeof node.name === 'string' ? node.name : 'Documentation';
      current = { title, Icon: SECTION_ICONS[title] ?? Boxes, list: [] };
      sections.push(current);
      continue;
    }

    if (node.type === 'folder') {
      // A folder is its own section, so it does not need a separator above it.
      // A folder of folders — the API reference, one folder per package —
      // becomes one section each, rather than 66 pages flattened into a single
      // undifferentiated list.
      const nested = node.children.filter((child) => child.type === 'folder');
      if (nested.length > 0) {
        sections.push(...buildSections({ ...tree, children: nested } as PageTree.Root));
      }

      const pages = folderItems(node.children.filter((child) => child.type !== 'folder'));
      if (pages.length > 0 || node.index !== undefined) {
        const title = typeof node.name === 'string' ? node.name : 'Packages';
        sections.push({
          title,
          Icon: SECTION_ICONS[title] ?? Package,
          href: node.index?.url,
          list: pages,
        });
      }
      current = null;
      continue;
    }

    if (node.type === 'page') {
      if (current === null) {
        current = { title: 'Documentation', Icon: BookOpen, list: [] };
        sections.push(current);
      }
      current.list.push(toItem(node));
    }
  }

  return sections.filter((section) => section.list.length > 0 || section.href !== undefined);
};
