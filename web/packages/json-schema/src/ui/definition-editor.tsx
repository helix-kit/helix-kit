'use client';

/* eslint-disable react/no-array-index-key -- see the note in property-editor.tsx */
import { Button } from '@helix/design-system/components/button';
import { Input } from '@helix/design-system/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@helix/design-system/components/select';
import { Plus, Trash2 } from 'lucide-react';

import {
  SCHEMA_TYPE_OPTIONS,
  createDefaultDefinition,
  type SchemaDefinition,
  type SchemaType,
} from '../definition';

/** Picks the type of a value; changing it resets to that type's default shape. */
export const SchemaDefinitionEditor = ({
  value,
  onChange,
}: {
  value: SchemaDefinition;
  onChange: (value: SchemaDefinition) => void;
}) => (
  <Select
    value={value.type}
    onValueChange={(nextType) => {
      onChange(createDefaultDefinition(nextType as SchemaType));
    }}
  >
    <SelectTrigger className="h-8 w-[120px] rounded-none border-0 bg-transparent text-xs shadow-none dark:bg-transparent dark:hover:bg-transparent">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {SCHEMA_TYPE_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const EnumEditor = ({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) => (
  <div className="space-y-1.5">
    {values.map((value, index) => (
      <div key={index} className="flex items-center gap-1.5">
        <Input
          className="border-input h-7 flex-1 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent"
          value={value}
          onChange={(event) => {
            onChange(values.map((entry, at) => (at === index ? event.target.value : entry)));
          }}
        />
        <Button
          className="h-7 w-7 rounded-none p-0"
          disabled={values.length <= 1}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => {
            onChange(values.filter((_, at) => at !== index));
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    ))}
    <Button
      className="border-input h-7 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent"
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        onChange([...values, `value${values.length + 1}`]);
      }}
    >
      <Plus className="mr-1 h-3 w-3" />
      Add value
    </Button>
  </div>
);

export const LiteralEditor = ({
  value,
  onChange,
}: {
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) => {
  const literalType = typeof value as 'string' | 'number' | 'boolean';

  return (
    <div className="space-y-1.5">
      <Select
        value={literalType}
        onValueChange={(nextType) => {
          if (nextType === 'number') {
            onChange(0);
          } else if (nextType === 'boolean') {
            onChange(false);
          } else {
            onChange('');
          }
        }}
      >
        <SelectTrigger className="border-input h-7 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent dark:hover:bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="string">String</SelectItem>
          <SelectItem value="number">Number</SelectItem>
          <SelectItem value="boolean">Boolean</SelectItem>
        </SelectContent>
      </Select>

      {literalType === 'boolean' ? (
        <Select
          value={String(value)}
          onValueChange={(nextValue) => {
            onChange(nextValue === 'true');
          }}
        >
          <SelectTrigger className="border-input h-7 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent dark:hover:bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="border-input h-7 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent"
          type={literalType === 'number' ? 'number' : 'text'}
          value={String(value)}
          onChange={(event) => {
            if (literalType !== 'number') {
              onChange(event.target.value);
              return;
            }
            const parsed = Number.parseFloat(event.target.value);
            onChange(Number.isNaN(parsed) ? 0 : parsed);
          }}
        />
      )}
    </div>
  );
};

export const UnionEditor = ({
  variants,
  onChange,
}: {
  variants: SchemaDefinition[];
  onChange: (variants: SchemaDefinition[]) => void;
}) => (
  <div className="space-y-2">
    {variants.map((variant, index) => (
      <div key={index} className="border-input flex items-start gap-1.5 border p-2">
        <div className="flex-1">
          <SchemaDefinitionEditor
            value={variant}
            onChange={(updated) => {
              onChange(variants.map((entry, at) => (at === index ? updated : entry)));
            }}
          />
        </div>
        <Button
          className="h-7 w-7 shrink-0 rounded-none p-0"
          disabled={variants.length <= 1}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => {
            onChange(variants.filter((_, at) => at !== index));
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    ))}
    <Button
      className="border-input h-7 rounded-none bg-transparent text-xs shadow-none dark:bg-transparent"
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        onChange([...variants, { type: 'string' }]);
      }}
    >
      <Plus className="mr-1 h-3 w-3" />
      Add variant
    </Button>
  </div>
);
