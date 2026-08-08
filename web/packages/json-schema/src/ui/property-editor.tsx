'use client';

/* eslint-disable react/no-array-index-key --
 * Rows are keyed by position deliberately. Keying by property name — the obvious
 * alternative — changes the key on every keystroke while renaming, which remounts
 * the row and takes focus out of the input the author is typing in. Properties
 * here are never reordered, so position is stable.
 */
import { useState } from 'react';

import { Button } from '@helix/design-system/components/button';
import { Checkbox } from '@helix/design-system/components/checkbox';
import { Input } from '@helix/design-system/components/input';
import { Label } from '@helix/design-system/components/label';
import { cn } from '@helix/design-system/lib/utils';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import {
  EnumEditor,
  LiteralEditor,
  SchemaDefinitionEditor,
  UnionEditor,
} from './definition-editor';

import {
  createDefaultProperty,
  type PropertyDescriptor,
  type SchemaDefinition,
} from '../definition';

/** Types whose shape is edited in a panel below the row rather than inline. */
const EXPANDABLE = new Set<SchemaDefinition['type']>([
  'object',
  'array',
  'union',
  'enum',
  'literal',
]);

const nextPropertyName = (properties: PropertyDescriptor[]): string => {
  const taken = new Set(properties.map((property) => property.name));
  if (!taken.has('newProperty')) {
    return 'newProperty';
  }

  let counter = 1;
  while (taken.has(`newProperty${counter}`)) {
    counter += 1;
  }
  return `newProperty${counter}`;
};

const PropertyRow = ({
  property,
  onChange,
  onRemove,
  depth,
  index,
}: {
  property: PropertyDescriptor;
  onChange: (property: PropertyDescriptor) => void;
  onRemove: () => void;
  depth: number;
  index: number;
}) => {
  const [expanded, setExpanded] = useState(true);
  const expandable = EXPANDABLE.has(property.schema.type);

  const updateSchema = (schema: SchemaDefinition) => {
    onChange({ ...property, schema });
  };

  return (
    <div className={cn(index > 0 ? 'border-t' : '', 'border-input')}>
      <div className="bg-muted/30 flex items-center">
        {expandable ? (
          <button
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="text-muted-foreground hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center"
            type="button"
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <div className="w-8 shrink-0" />
        )}

        <Input
          className="h-8 flex-1 border-y-0 border-r-0 font-mono text-xs"
          placeholder="property name"
          value={property.name}
          onChange={(event) => {
            onChange({ ...property, name: event.target.value });
          }}
        />

        <div className="shrink-0">
          <SchemaDefinitionEditor value={property.schema} onChange={updateSchema} />
        </div>

        <div className="border-input flex h-8 shrink-0 items-center gap-1 border-r px-2">
          <Checkbox
            checked={property.required}
            className="h-3.5 w-3.5"
            onCheckedChange={(checked) => {
              onChange({ ...property, required: checked === true });
            }}
          />
          <Label className="text-muted-foreground cursor-pointer text-[10px]">Required</Label>
        </div>

        <div className="border-input flex h-8 shrink-0 items-center gap-1 border-r px-2">
          <Checkbox
            checked={property.nullable}
            className="h-3.5 w-3.5"
            onCheckedChange={(checked) => {
              onChange({ ...property, nullable: checked === true });
            }}
          />
          <Label className="text-muted-foreground cursor-pointer text-[10px]">Nullable</Label>
        </div>

        <Button
          aria-label="Remove property"
          className="h-8 w-8 shrink-0 border-0 p-0"
          size="sm"
          type="button"
          variant="outline"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && expandable ? (
        <div className="pl-8">
          {property.schema.type === 'object' ? (
            <PropertyListEditor
              depth={depth + 1}
              properties={property.schema.properties}
              onChange={(properties) => {
                updateSchema({ type: 'object', properties });
              }}
            />
          ) : null}

          {property.schema.type === 'array' ? (
            <div className="border-input ml-1 space-y-1.5 border-l pl-3">
              <span className="text-muted-foreground text-xs font-medium">Array items</span>
              <SchemaDefinitionEditor
                value={property.schema.items}
                onChange={(items) => {
                  updateSchema({ type: 'array', items });
                }}
              />
              {property.schema.items.type === 'object' ? (
                <PropertyListEditor
                  depth={depth + 2}
                  properties={property.schema.items.properties}
                  onChange={(properties) => {
                    updateSchema({ type: 'array', items: { type: 'object', properties } });
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {property.schema.type === 'enum' ? (
            <EnumEditor
              values={property.schema.values}
              onChange={(values) => {
                updateSchema({ type: 'enum', values });
              }}
            />
          ) : null}

          {property.schema.type === 'literal' ? (
            <LiteralEditor
              value={property.schema.value}
              onChange={(value) => {
                updateSchema({ type: 'literal', value });
              }}
            />
          ) : null}

          {property.schema.type === 'union' ? (
            <UnionEditor
              variants={property.schema.variants}
              onChange={(variants) => {
                updateSchema({ type: 'union', variants });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const PropertyListEditor = ({
  properties,
  onChange,
  depth = 0,
}: {
  properties: PropertyDescriptor[];
  onChange: (properties: PropertyDescriptor[]) => void;
  depth?: number;
}) => (
  <div className="border-input border">
    {properties.length === 0 ? (
      <p className="text-muted-foreground py-2 text-center text-xs">
        No properties defined. Add one below.
      </p>
    ) : (
      properties.map((property, index) => (
        <PropertyRow
          key={index}
          depth={depth}
          index={index}
          property={property}
          onChange={(updated) => {
            onChange(properties.map((entry, at) => (at === index ? updated : entry)));
          }}
          onRemove={() => {
            onChange(properties.filter((_, at) => at !== index));
          }}
        />
      ))
    )}

    <Button
      className="h-8 w-full border-0 border-t text-xs"
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        onChange([...properties, createDefaultProperty(nextPropertyName(properties))]);
      }}
    >
      <Plus className="mr-1 h-3.5 w-3.5" />
      Add property
    </Button>
  </div>
);
