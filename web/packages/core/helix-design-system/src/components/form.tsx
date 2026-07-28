'use client';

import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';

import { Label } from './label';

import type * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '../lib/utils';

/**
 * Re-export of `react-hook-form`'s provider so Fluxery form primitives can
 * share one import path.
 */
type FormProps<
  TFieldValues extends FieldValues = FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
> = UseFormReturn<TFieldValues, unknown, TTransformedValues> & {
  children: React.ReactNode;
};

const Form = <
  TFieldValues extends FieldValues = FieldValues,
  TTransformedValues extends FieldValues | undefined = undefined,
>({
  children,
  ...form
}: FormProps<TFieldValues, TTransformedValues>) => {
  return <FormProvider {...form}>{children}</FormProvider>;
};

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

/**
 * Wraps `react-hook-form`'s `Controller` and exposes the field name to sibling
 * Fluxery form primitives through context.
 */
const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>({
  ...props
}: ControllerProps<TFieldValues, TName, TTransformedValues>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

/**
 * Returns the generated ids and validation state used by `FormLabel`,
 * `FormControl`, `FormDescription`, and `FormMessage`.
 *
 * Must be called within both `FormField` and `FormItem`.
 */
const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

/** Groups a field's label, control, description, and message under one shared id. */
const FormItem = ({ className, ...props }: React.ComponentProps<'div'>) => {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn('grid gap-2', className)} data-slot="form-item" {...props} />
    </FormItemContext.Provider>
  );
};

const FormLabel = ({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) => {
  const { error, formItemId } = useFormField();

  return (
    <Label
      className={cn('data-[error=true]:text-destructive', className)}
      data-error={error !== undefined}
      data-slot="form-label"
      htmlFor={formItemId}
      {...props}
    />
  );
};

/** Injects the accessibility attributes derived from the current form field state. */
const FormControl = ({ ...props }: React.ComponentProps<typeof Slot>) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot
      aria-describedby={
        error === undefined ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={error !== undefined}
      data-slot="form-control"
      id={formItemId}
      {...props}
    />
  );
};

const FormDescription = ({ className, ...props }: React.ComponentProps<'p'>) => {
  const { formDescriptionId } = useFormField();

  return (
    <p
      className={cn('text-muted-foreground text-sm', className)}
      data-slot="form-description"
      id={formDescriptionId}
      {...props}
    />
  );
};

const FormMessage = ({ className, ...props }: React.ComponentProps<'p'>) => {
  const { error, formMessageId } = useFormField();
  const body = error === undefined ? props.children : String(error.message ?? '');

  if (body === null || body === undefined || body === '') {
    return null;
  }

  return (
    <p
      className={cn('text-destructive text-sm', className)}
      data-slot="form-message"
      id={formMessageId}
      {...props}
    >
      {body}
    </p>
  );
};

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
