'use client';

import { type ReactNode, useState } from 'react';

import { type FieldValues } from 'react-hook-form';
import { toast } from 'sonner';
import { type z } from 'zod';

import DynamicForm, { type DynamicFormProps } from './dynamic-form';
import { ResponsiveModal } from './responsive-modal';

type MutationModalProps<
  Input extends FieldValues,
  Output extends FieldValues,
  MutationResult,
> = Omit<DynamicFormProps<Input, Output>, 'showSubmitButton'> & {
  mutation: {
    mutateAsync: (values: Output) => Promise<MutationResult>;
    isPending: boolean;
  };
  trigger: ReactNode;
  titleText?: string;
  refresh?: (values: MutationResult) => Promise<void> | void;
  successToast: (mutationResult: MutationResult) => string;
  customDescription?: ReactNode;
  modalClassName?: string;
};

export const MutationModal = <T extends FieldValues, U extends FieldValues, MutationResult>(
  props: MutationModalProps<T, U, MutationResult>,
) => {
  const [open, setOpen] = useState(false);

  const onSubmit = (values: z.infer<typeof props.schema>) => {
    props.mutation
      .mutateAsync(values)
      .then((result) => {
        toast(props.successToast(result));
        setOpen(false);
        return props.refresh?.(result);
      })
      .catch((error) => {
        setOpen(false);
        toast.error(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <ResponsiveModal
      className={props.modalClassName}
      description={props.customDescription}
      open={open}
      title={props.titleText}
      trigger={props.trigger}
      onOpenChange={setOpen}
    >
      <DynamicForm
        {...props}
        showSubmitButton
        submitButtonDisabled={props.mutation.isPending}
        onSubmit={onSubmit}
      />
    </ResponsiveModal>
  );
};
