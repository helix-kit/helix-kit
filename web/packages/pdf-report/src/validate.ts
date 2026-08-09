import { validateSpec, type Spec, type UIElement } from '@json-render/core';

import { authoringComponentSchemas, reportCatalog } from './catalog';
import { isObjectRecord } from './json';

import type { JSONSchema } from 'zod/v4/core';

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

/**
 * Whether a JSON-Pointer path exists in a schema.
 *
 * Only descends what can be named: object properties by key, and array items by
 * index or `*`. A path into something the schema leaves open (a record, an
 * unconstrained object) is accepted rather than guessed at.
 */
const pathExistsInSchema = (schema: JSONSchema._JSONSchema, pointer: string): boolean => {
  const segments = pointer.split('/').filter((segment) => segment !== '');
  // Annotated, and read through a local each iteration: reassigning from a
  // property of itself is otherwise a circular inference the compiler rejects.
  let current: JSONSchema._JSONSchema = schema;

  for (const segment of segments) {
    const node: JSONSchema._JSONSchema = current;
    if (typeof node !== 'object') {
      return true;
    }

    if (node.type === 'array') {
      const { items } = node;
      if (items === undefined || Array.isArray(items)) {
        return true;
      }
      current = items;
      continue;
    }

    const { properties } = node;
    if (properties === undefined) {
      // Open or unconstrained: nothing here contradicts the path.
      return true;
    }

    const next = properties[segment];
    if (next === undefined) {
      return false;
    }
    current = next;
  }

  return true;
};

/** Every `$state` pointer a spec reads, with the element that reads it. */
const collectStateBindings = (spec: Spec): { elementKey: string; pointer: string }[] => {
  const bindings: { elementKey: string; pointer: string }[] = [];

  const walk = (elementKey: string, value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(elementKey, entry);
      }
      return;
    }

    if (!isObjectRecord(value)) {
      return;
    }

    const pointer = value.$state;
    if (typeof pointer === 'string') {
      bindings.push({ elementKey, pointer });
      return;
    }

    for (const entry of Object.values(value)) {
      walk(elementKey, entry);
    }
  };

  for (const [key, element] of Object.entries(spec.elements as Record<string, UIElement>)) {
    walk(key, element.props);
  }

  return bindings;
};

const formatIssue = (issue: IssueLike): string => {
  const path = issue.path.join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
};

/**
 * A key at the top of the layout that does not belong there.
 *
 * A patch aimed outside the layout — `/spec/elements/...` from a model shown the
 * whole template — does not fail. `replace` invents the parents it cannot find,
 * so the layout quietly grows a `spec` key holding a second, partial layout that
 * nothing draws.
 */
const strayTopLevelIssues = (spec: Spec): ReportSpecIssue[] =>
  Object.keys(spec as unknown as Record<string, unknown>)
    .filter((key) => key !== 'root' && key !== 'elements')
    .map((key) => ({
      message: `The layout has an unexpected top-level key "${key}". Patch paths are rooted at the layout, so they start with "/elements" or "/root".`,
    }));

const childrenOf = (element: UIElement): string[] =>
  Array.isArray(element.children) ? element.children.filter((c) => typeof c === 'string') : [];

/**
 * The same child listed twice in one container.
 *
 * Nothing is invalid about it — the element simply draws twice — which is why it
 * survives every other check and is only noticed by whoever reads the document.
 * It comes from a specific mistake: JSON Patch `add` on an array inserts, so a
 * model that inserts a section before an existing one and then "moves" that one
 * down by adding it again ends up with two of it.
 */
const duplicateChildIssues = (spec: Spec): ReportSpecIssue[] => {
  const issues: ReportSpecIssue[] = [];

  for (const [key, element] of Object.entries(spec.elements as Record<string, UIElement>)) {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const child of childrenOf(element)) {
      if (seen.has(child) && !reported.has(child)) {
        reported.add(child);
        issues.push({
          elementKey: key,
          message: `Child "${child}" is listed more than once, so it draws more than once. Adding to an array inserts; it does not move what is already there.`,
        });
      }
      seen.add(child);
    }
  }

  return issues;
};

/**
 * An element nothing reaches from the root.
 *
 * Also not invalid, and also invisible: the element is built, bound and checked,
 * and then never drawn, so a report is missing a section that every check
 * reported as present.
 */
const unreachableElementIssues = (spec: Spec): ReportSpecIssue[] => {
  const elements = spec.elements as Record<string, UIElement>;
  const reached = new Set<string>();
  const queue = [spec.root];

  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined || reached.has(key)) {
      continue;
    }
    reached.add(key);
    const element = elements[key];
    if (element !== undefined) {
      queue.push(...childrenOf(element));
    }
  }

  return Object.keys(elements)
    .filter((key) => !reached.has(key))
    .map((key) => ({
      elementKey: key,
      message: 'Nothing reaches this element from the root, so it is never drawn.',
    }));
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
export const validateReportSpec = (
  spec: Spec,
  outputSchema?: JSONSchema._JSONSchema,
): ReportSpecIssue[] => {
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

  issues.push(
    ...strayTopLevelIssues(spec),
    ...duplicateChildIssues(spec),
    ...unreachableElementIssues(spec),
  );

  // A binding that reads a path the code never produces renders as empty rather
  // than failing, so without this a typo is invisible until someone reads the
  // PDF and wonders where a column went.
  if (outputSchema !== undefined) {
    for (const { elementKey, pointer } of collectStateBindings(spec)) {
      if (!pathExistsInSchema(outputSchema, pointer)) {
        issues.push({
          elementKey,
          message: `Binding "${pointer}" is not produced by the output schema.`,
        });
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
