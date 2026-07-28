'use client';

import * as React from 'react';

import { cn } from '@helix/design-system/lib/utils';
import { Slider as SliderPrimitive } from 'radix-ui';

const resolveSliderValues = (
  value: number[] | undefined,
  defaultValue: number[] | undefined,
  min: number,
  max: number,
): number[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }

  return [min, max];
};

const Slider = ({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) => {
  const _values = React.useMemo(
    () => resolveSliderValues(value, defaultValue, min, max),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      className={cn(
        'relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col',
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      max={max}
      min={min}
      value={value}
      {...props}
    >
      <SliderPrimitive.Track
        className="bg-muted relative grow overflow-hidden rounded-full data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        data-slot="slider-track"
      >
        <SliderPrimitive.Range
          className="bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full"
          data-slot="slider-range"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="border-ring ring-ring/50 relative block size-3 shrink-0 rounded-full border bg-white transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-1 focus-visible:ring-1 focus-visible:outline-hidden active:ring-1 disabled:pointer-events-none disabled:opacity-50"
          data-slot="slider-thumb"
        />
      ))}
    </SliderPrimitive.Root>
  );
};

export { Slider };
