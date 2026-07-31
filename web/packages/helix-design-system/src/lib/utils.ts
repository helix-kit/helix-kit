import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names and resolves Tailwind utility conflicts. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
