'use client';

/* eslint-disable react/no-array-index-key --
 * Rows are keyed by position deliberately. Keying by property name — the obvious
 * alternative — changes the key on every keystroke while renaming, which remounts
 * the row and takes focus out of the input the author is typing in. Properties
 * here are never reordered, so position is stable.
 */
import { useState } from 'react';

import { Checkbox } from '@helix-hq/design-system/components/checkbox';
import { Input } from '@helix-hq/design-system/components/input';
import { Label } from '@helix-hq/design-system/components/label';
import { cn } from '@helix-hq/design-system/lib/utils';
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
      {/* A table row: the row owns the background, each cell is separated by a
          single right border, and the controls inside are transparent so they
          read as cells rather than as boxes sitting on one. */}
      <div className="bg-muted/20 flex items-stretch">
        <div className="border-input flex w-8 shrink-0 items-center justify-center border-r">
          {expandable ? (
            <button
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className="text-muted-foreground hover:text-foreground flex size-full items-center justify-center"
              type="button"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>

        <Input
          className="border-input h-8 flex-1 rounded-none border-0 border-r bg-transparent font-mono text-xs shadow-none focus-visible:ring-inset dark:bg-transparent"
          placeholder="property name"
          value={property.name}
          onChange={(event) => {
            onChange({ ...property, name: event.target.value });
          }}
        />

        <div className="border-input shrink-0 border-r">
          <SchemaDefinitionEditor value={property.schema} onChange={updateSchema} />
        </div>

        {(
          [
            [
              'Required',
              property.required,
              (checked: boolean) => ({ ...property, required: checked }),
            ],
            [
              'Nullable',
              property.nullable,
              (checked: boolean) => ({ ...property, nullable: checked }),
            ],
          ] as const
        ).map(([label, checked, apply]) => (
          <div
            key={label}
            className="border-input flex h-8 shrink-0 items-center gap-1.5 border-r px-2.5"
          >
            <Checkbox
              checked={checked}
              className="size-3.5 rounded-none"
              onCheckedChange={(next) => {
                onChange(apply(next === true));
              }}
            />
            <Label className="text-muted-foreground text-[10px]">{label}</Label>
          </div>
        ))}

        <button
          aria-label="Remove property"
          className="text-muted-foreground hover:text-destructive hover:bg-muted flex size-8 shrink-0 items-center justify-center transition-colors"
          type="button"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
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

    <button
      className="border-input text-muted-foreground hover:bg-muted/50 hover:text-foreground flex h-8 w-full items-center justify-center gap-1.5 border-t text-xs transition-colors"
      type="button"
      onClick={() => {
        onChange([...properties, createDefaultProperty(nextPropertyName(properties))]);
      }}
    >
      <Plus className="size-3.5" />
      Add property
    </button>
  </div>
);
