'use client';

import { type ReactNode, type Ref, useEffect, useId, useImperativeHandle, useRef } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { type DefaultValues, type FieldValues, type UseFormReturn, useForm } from 'react-hook-form';

import { Button } from './button';
import {
  DynamicFormContextProvider,
  type DynamicFormSignedUrlMutation,
} from './dynamic-form-context';
import { type FormField, RenderFormInput, RenderLabelAfter } from './dynamic-form-fields';
import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  FormField as FormFieldPrimitive,
} from './form';

import type * as z4 from 'zod/v4/core';

import { cn } from '../lib/utils';

export type DynamicFormProps<Input extends FieldValues, Output extends FieldValues> = {
  schema: z4.$ZodType<Output, Input>;
  onSubmit?: (values: Output) => Promise<void> | void;
  defaultValues: DefaultValues<Input>;
  fields: Array<FormField<Input>>;
  submitButtonText?: string;
  submitButtonDisabled?: boolean;
  FormFooter?: ({ form }: { form: UseFormReturn<Input, unknown, Output> }) => ReactNode;
  showSubmitButton?: boolean;
  ref?: Ref<UseFormReturn<Input, unknown, Output>>;
  className?: string;
  submissionError?: string;
  getSignedUrlMutation?: DynamicFormSignedUrlMutation;
};

const DynamicForm = <T extends FieldValues, U extends FieldValues>(
  props: DynamicFormProps<T, U>,
) => {
  const { defaultValues } = props;

  const form = useForm<T, unknown, U>({
    resolver: zodResolver(props.schema),
    defaultValues: props.defaultValues,
  });

  useImperativeHandle(props.ref, () => form, [form]);
  const prevDefaultValuesRef = useRef<string>('');

  useEffect(() => {
    const serializedValues = JSON.stringify(defaultValues);
    if (prevDefaultValuesRef.current !== serializedValues) {
      prevDefaultValuesRef.current = serializedValues;
      form.reset({
        ...defaultValues,
      });
    }
  }, [defaultValues, form]);
  const onFormSubmit = props.onSubmit === undefined ? undefined : form.handleSubmit(props.onSubmit);
  // react-hook-form's watch() intentionally returns non-memoizable values
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = form.watch();
  const formId = useId();
  return (
    <DynamicFormContextProvider value={{ getSignedUrlMutation: props.getSignedUrlMutation }}>
      <Form {...form}>
        <form className={cn('grid gap-4')} onSubmit={onFormSubmit}>
          <div className={cn('grid max-h-[70vh] gap-4 overflow-y-auto p-1', props.className)}>
            {props.fields.map((field) => {
              const { displayCondition = true } = field;
              if (
                displayCondition === false ||
                (typeof displayCondition === 'function' && !displayCondition(values))
              ) {
                return null;
              }
              return (
                <FormFieldPrimitive
                  key={field.name}
                  control={form.control}
                  name={field.name}
                  render={({ field: formField }) => (
                    <FormItem
                      className={cn(
                        `${field.type === RenderLabelAfter ? 'flex flex-row' : 'min-w-0'}`,
                      )}
                    >
                      {field.type !== RenderLabelAfter &&
                        (typeof field.label === 'string' ? (
                          <FormLabel htmlFor={`${formId}-${field.name}`}>{field.label}</FormLabel>
                        ) : (
                          field.label
                        ))}
                      <FormControl>
                        <RenderFormInput
                          field={formField}
                          formField={field}
                          id={`${formId}-${field.name}`}
                          type={field.type}
                        />
                      </FormControl>
                      {field.type === RenderLabelAfter &&
                        (typeof field.label === 'string' ? (
                          <FormLabel htmlFor={`${formId}-${field.name}`}>{field.label}</FormLabel>
                        ) : (
                          field.label
                        ))}
                      {field.description !== undefined && (
                        <FormDescription>{field.description}</FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              );
            })}
          </div>
          {props.submissionError !== undefined && (
            <p className={cn('text-destructive text-sm')}>{props.submissionError}</p>
          )}
          {props.showSubmitButton === true && (
            <Button className="mx-1" disabled={props.submitButtonDisabled} type="submit">
              {props.submitButtonText ?? 'Submit'}
            </Button>
          )}
          {props.FormFooter === undefined ? null : (
            <div className="mx-1 grid gap-4">
              <props.FormFooter form={form} />
            </div>
          )}
        </form>
      </Form>
    </DynamicFormContextProvider>
  );
};

export default DynamicForm;
