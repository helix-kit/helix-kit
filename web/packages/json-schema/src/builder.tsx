'use client';

import { useCallback, useMemo } from 'react';

import { ScrollArea } from '@helix/design-system/components/scroll-area';
import { cn } from '@helix/design-system/lib/utils';

import {
  definitionToJsonSchema,
  jsonSchemaToDefinition,
  type PropertyDescriptor,
} from './definition';
import { PropertyListEditor } from './ui/property-editor';

import type { JSONSchema } from 'zod/v4/core';

export type { PropertyDescriptor };

/**
 * Edits the top-level object schema of a document.
 *
 * Only object schemas are editable here: the things this describes — a report's
 * input, a tool's arguments — are always a named set of fields, and constraining
 * it keeps the UI a flat property list rather than an arbitrary tree. Anything
 * else in `value` is treated as an empty object rather than throwing, since a
 * schema being edited is often momentarily malformed.
 */
export const JsonSchemaBuilder = ({
  value,
  onValueChange,
  className,
  maxHeight,
}: {
  value?: JSONSchema._JSONSchema;
  onValueChange: (schema: JSONSchema.JSONSchema) => void;
  className?: string;
  maxHeight?: string;
}) => {
  const properties = useMemo<PropertyDescriptor[]>(() => {
    if (value === undefined) {
      return [];
    }

    const definition = jsonSchemaToDefinition(value);
    return definition.type === 'object' ? definition.properties : [];
  }, [value]);

  const handleChange = useCallback(
    (next: PropertyDescriptor[]) => {
      onValueChange(definitionToJsonSchema({ type: 'object', properties: next }));
    },
    [onValueChange],
  );

  const content = <PropertyListEditor depth={0} properties={properties} onChange={handleChange} />;

  if (maxHeight === undefined) {
    return <div className={cn('w-full', className)}>{content}</div>;
  }

  return (
    <ScrollArea className={cn('w-full', className)} style={{ maxHeight }}>
      <div className="w-full p-1">{content}</div>
    </ScrollArea>
  );
};
