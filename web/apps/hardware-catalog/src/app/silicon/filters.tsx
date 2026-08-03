'use client';

import { Badge } from '@helix/design-system/components/badge';
import { Button } from '@helix/design-system/components/button';
import { Input } from '@helix/design-system/components/input';
import { useQueryStates } from 'nuqs';
import { useDebouncedCallback } from 'use-debounce';

import { siliconSearchParsers } from './search-params';

import type { FilterOption } from './filter-options';

const SEARCH_DEBOUNCE_MS = 300;

type ToggleGroupProps = {
  readonly title: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string) => void;
};

const ToggleGroup = ({ title, options, selected, onToggle }: ToggleGroupProps) => (
  <div className="space-y-2">
    <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        // Nothing to find: show it greyed rather than letting the click return an empty page.
        const empty = option.count === 0;
        return (
          <button
            key={option.value}
            className={empty ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
            disabled={empty}
            title={empty ? 'No parts recorded with this yet' : `${option.count} parts`}
            type="button"
            onClick={() => {
              onToggle(option.value);
            }}
          >
            <Badge variant={active ? 'default' : 'outline'}>
              {option.label}
              <span className="ml-1 opacity-60">{option.count}</span>
            </Badge>
          </button>
        );
      })}
    </div>
  </div>
);

type SiliconFiltersProps = {
  readonly kinds: readonly FilterOption[];
  readonly coreKinds: readonly FilterOption[];
  readonly interfaceKinds: readonly FilterOption[];
  readonly radioStandards: readonly FilterOption[];
  readonly manufacturers: readonly FilterOption[];
  readonly coreDesigns: readonly FilterOption[];
};

export const SiliconFilters = (props: SiliconFiltersProps) => {
  const [filters, setFilters] = useQueryStates(siliconSearchParsers, { shallow: false });

  const toggle =
    (
      key:
        | 'kinds'
        | 'coreKinds'
        | 'interfaceKinds'
        | 'radioStandards'
        | 'manufacturerIds'
        | 'coreDesignIds',
    ) =>
    (value: string) => {
      const current = filters[key];
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
      void setFilters({ [key]: next.length === 0 ? null : next, page: 1 });
    };

  const onSearch = useDebouncedCallback((value: string) => {
    void setFilters({ search: value === '' ? null : value, page: 1 });
  }, SEARCH_DEBOUNCE_MS);

  const activeCount =
    filters.kinds.length +
    filters.coreKinds.length +
    filters.interfaceKinds.length +
    filters.radioStandards.length +
    filters.manufacturerIds.length +
    filters.coreDesignIds.length;

  return (
    <aside className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2">
      <Input
        defaultValue={filters.search}
        placeholder="Search silicon…"
        onChange={(event) => {
          onSearch(event.target.value);
        }}
      />

      <ToggleGroup
        options={props.kinds}
        selected={filters.kinds}
        title="Kind"
        onToggle={toggle('kinds')}
      />
      <ToggleGroup
        options={props.coreKinds}
        selected={filters.coreKinds}
        title="Has engine"
        onToggle={toggle('coreKinds')}
      />
      <ToggleGroup
        options={props.interfaceKinds}
        selected={filters.interfaceKinds}
        title="Peripherals"
        onToggle={toggle('interfaceKinds')}
      />
      <ToggleGroup
        options={props.radioStandards}
        selected={filters.radioStandards}
        title="Radio"
        onToggle={toggle('radioStandards')}
      />
      {props.manufacturers.length > 0 ? (
        <ToggleGroup
          options={props.manufacturers}
          selected={filters.manufacturerIds}
          title="Vendor"
          onToggle={toggle('manufacturerIds')}
        />
      ) : null}
      {props.coreDesigns.length > 0 ? (
        <ToggleGroup
          options={props.coreDesigns}
          selected={filters.coreDesignIds}
          title="Core design"
          onToggle={toggle('coreDesignIds')}
        />
      ) : null}

      <div className="space-y-2">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Min accelerator TOPS (int8)
        </div>
        <Input
          defaultValue={filters.minTops ?? ''}
          placeholder="e.g. 1"
          type="number"
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value);
            void setFilters({
              minTops: Number.isFinite(parsed) ? parsed : null,
              page: 1,
            });
          }}
        />
      </div>

      {activeCount > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void setFilters({
              kinds: null,
              coreKinds: null,
              interfaceKinds: null,
              radioStandards: null,
              manufacturerIds: null,
              coreDesignIds: null,
              minTops: null,
              page: 1,
            });
          }}
        >
          Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
        </Button>
      ) : null}
    </aside>
  );
};
