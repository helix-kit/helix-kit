import { validateSpec, type Spec, type UIElement } from '@json-render/core';

import { authoringComponentSchemas, reportCatalog } from './catalog';
import { isObjectRecord } from './json';

export type ReportSpecIssue = {
  /** The element the issue was found on, when it belongs to one. */
  elementKey?: string;
  message: string;
};

type IssueLike = { path: PropertyKey[]; message: string };

const BINDING_KEYS = ['$state', '$item', '$bindState', '$bindItem', '$computed'];

const isBinding = (value: unknown): boolean =>
  isObjectRecord(value) && BINDING_KEYS.some((key) => key in value);

const valueAtPath = (source: unknown, path: PropertyKey[]): unknown =>
  path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      return current[Number(segment)];
    }
    return isObjectRecord(current) ? current[String(segment)] : undefined;
  }, source);

/**
 * Drops issues raised against a bound prop. `{"$state": "/devices"}` is resolved
 * at render time, so its shape cannot be known here — only that it is bound.
 */
const isBindingIssue = (props: Record<string, unknown>, issue: IssueLike): boolean =>
  issue.path.length > 0 && isBinding(valueAtPath(props, issue.path));

const formatIssue = (issue: IssueLike): string => {
  const path = issue.path.join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
};

/**
 * Checks a template against the catalog: structural integrity first, then every
 * element's component name and props.
 *
 * `catalog.validate()` is deliberately not used. It types a spec's `props` as a
 * loose object — the per-component schemas describe the vocabulary (they are
 * what `catalog.prompt()` renders) but are never enforced — and it additionally
 * requires `visible` on every element, which hand-authored templates omit. So
 * the names and schemas come from the catalog, and the checking happens here.
 *
 * Returns every issue rather than throwing on the first, so an author fixing a
 * template sees the whole list at once.
 */
export const validateReportSpec = (spec: Spec): ReportSpecIssue[] => {
  const issues: ReportSpecIssue[] = [];

  for (const issue of validateSpec(spec).issues) {
    if (issue.severity === 'error') {
      issues.push({ elementKey: issue.elementKey, message: issue.message });
    }
  }

  for (const [key, element] of Object.entries(spec.elements as Record<string, UIElement>)) {
    const propsSchema = authoringComponentSchemas[element.type];

    if (propsSchema === undefined) {
      issues.push({
        elementKey: key,
        message: `Unknown component "${element.type}". Available: ${reportCatalog.componentNames.join(', ')}`,
      });
      continue;
    }

    const props = isObjectRecord(element.props) ? element.props : {};
    const result = propsSchema.safeParse(props);

    if (!result.success) {
      for (const issue of result.error.issues as IssueLike[]) {
        if (!isBindingIssue(props, issue)) {
          issues.push({ elementKey: key, message: `${element.type} — ${formatIssue(issue)}` });
        }
      }
    }
  }

  return issues;
};

/** Renders issues as one message, for throwing out of the render path. */
export const formatReportSpecIssues = (issues: ReportSpecIssue[]): string =>
  issues
    .map((issue) =>
      issue.elementKey === undefined ? issue.message : `${issue.elementKey}: ${issue.message}`,
    )
    .join('; ');
