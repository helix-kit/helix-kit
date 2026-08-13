'use client';

import { useMemo } from 'react';

import { Label } from '@helix-hq/design-system/components/label';
import { Separator } from '@helix-hq/design-system/components/separator';
import { cn } from '@helix-hq/design-system/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const FieldSet = ({ className, ...props }: React.ComponentProps<'fieldset'>) => (
  <fieldset
    className={cn(
      'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
      className,
    )}
    data-slot="field-set"
    {...props}
  />
);

const FieldLegend = ({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) => (
  <legend
    className={cn(
      'mb-2.5 font-medium data-[variant=label]:text-xs data-[variant=legend]:text-sm',
      className,
    )}
    data-slot="field-legend"
    data-variant={variant}
    {...props}
  />
);

const FieldGroup = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
      className,
    )}
    data-slot="field-group"
    {...props}
  />
);

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

const Field = ({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>) => (
  <div
    className={cn(fieldVariants({ orientation }), className)}
    data-orientation={orientation}
    data-slot="field"
    role="group"
    {...props}
  />
);

const FieldContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
    data-slot="field-content"
    {...props}
  />
);

const FieldLabel = ({ className, ...props }: React.ComponentProps<typeof Label>) => (
  <Label
    className={cn(
      'group/field-label peer/field-label has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border *:data-[slot=field]:p-2',
      'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
      className,
    )}
    data-slot="field-label"
    {...props}
  />
);

const FieldTitle = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'flex w-fit items-center gap-2 text-xs/relaxed group-data-[disabled=true]/field:opacity-50',
      className,
    )}
    data-slot="field-label"
    {...props}
  />
);

const FieldDescription = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p
    className={cn(
      'text-muted-foreground text-left text-xs/relaxed leading-normal font-normal group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
      'last:mt-0 nth-last-2:-mt-1',
      '[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4',
      className,
    )}
    data-slot="field-description"
    {...props}
  />
);

const FieldSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      'relative -my-2 h-5 text-xs group-data-[variant=outline]/field-group:-mb-2',
      className,
    )}
    data-content={children != null}
    data-slot="field-separator"
    {...props}
  >
    <Separator className="absolute inset-0 top-1/2" />
    {children != null ? (
      <span
        className="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
        data-slot="field-separator-content"
      >
        {children}
      </span>
    ) : null}
  </div>
);

const FieldError = ({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>;
}) => {
  const content = useMemo(() => {
    if (children != null) {
      return children;
    }

    if (errors === undefined || errors.length === 0) {
      return null;
    }

    const uniqueMessages = [
      ...new Set(
        errors
          .map((error) => error?.message)
          .filter((message): message is string => message != null && message.length > 0),
      ),
    ];

    if (uniqueMessages.length === 1) {
      return uniqueMessages[0];
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueMessages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    );
  }, [children, errors]);

  if (content == null || content === false || content === '') {
    return null;
  }

  return (
    <div
      className={cn('text-destructive text-xs font-normal', className)}
      data-slot="field-error"
      role="alert"
      {...props}
    >
      {content}
    </div>
  );
};

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
