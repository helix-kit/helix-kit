'use client';

import type { ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

type DeleteConfirmDialogProps = {
  trigger: ReactNode;
  title: ReactNode;
  description: ReactNode;
  onConfirm: () => void;
  isPending?: boolean;
  confirmText?: string;
  pendingText?: string;
};

export const DeleteConfirmDialog = ({
  trigger,
  title,
  description,
  onConfirm,
  isPending = false,
  confirmText = 'Delete',
  pendingText = 'Deleting...',
}: DeleteConfirmDialogProps) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={isPending} variant="destructive" onClick={onConfirm}>
          {isPending ? pendingText : confirmText}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
