import type { ComponentProps } from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';
import {
  CalloutContainer as CalloutContainerPrimitive,
  CalloutDescription as CalloutDescriptionPrimitive,
  Callout as CalloutPrimitive,
  CalloutTitle as CalloutTitlePrimitive,
} from 'fumadocs-ui/components/callout';

type CalloutProps = ComponentProps<typeof CalloutPrimitive>;

export const Callout = ({ className, ...props }: CalloutProps) => (
  <CalloutPrimitive
    className={cn(
      "rounded-sm bg-transparent p-3! shadow-none [&_div[role='none']]:hidden",
      className,
    )}
    {...props}
  />
);

export const CalloutContainer = (props: ComponentProps<typeof CalloutContainerPrimitive>) => (
  <CalloutContainerPrimitive {...props} />
);

export const CalloutTitle = (props: ComponentProps<typeof CalloutTitlePrimitive>) => (
  <CalloutTitlePrimitive {...props} />
);

export const CalloutDescription = (props: ComponentProps<typeof CalloutDescriptionPrimitive>) => (
  <CalloutDescriptionPrimitive {...props} />
);
