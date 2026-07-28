import { cn } from '@helix/design-system/lib/utils';

/** GitHub mark — inlined because lucide-react v1 removed brand glyphs. */
export const GithubIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden className={cn('size-4', className)} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);

/** X / Twitter mark — inlined (lucide-react v1 removed brand glyphs). */
export const TwitterIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden className={cn('size-4', className)} fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.9 1.5h3.68l-8.04 9.19L24 22.5h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.5h7.59l5.24 6.93ZM17.6 20.3h2.04L6.49 3.6H4.3Z" />
  </svg>
);

/** Discord mark — inlined (lucide-react v1 removed brand glyphs). */
export const DiscordIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden className={cn('size-4', className)} fill="currentColor" viewBox="0 0 24 24">
    <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3l-.24.44a18.3 18.3 0 0 1 4.34 1.35 16.6 16.6 0 0 0-14.1 0A18.3 18.3 0 0 1 9.8 3.44L9.55 3a19.8 19.8 0 0 0-4.87 1.37C1.58 8.97.73 13.44 1.16 17.85a19.9 19.9 0 0 0 6.03 3.06l.48-.66a13 13 0 0 1-2.29-1.1l.56-.44a14.2 14.2 0 0 0 12.12 0l.56.44c-.72.43-1.49.8-2.29 1.1l.48.66a19.9 19.9 0 0 0 6.03-3.06c.5-5.1-.85-9.53-3.52-13.48ZM8.52 15.33c-1.18 0-2.15-1.08-2.15-2.4s.95-2.42 2.15-2.42 2.17 1.1 2.15 2.42c0 1.32-.96 2.4-2.15 2.4Zm6.96 0c-1.18 0-2.15-1.08-2.15-2.4s.95-2.42 2.15-2.42 2.17 1.1 2.15 2.42c0 1.32-.95 2.4-2.15 2.4Z" />
  </svg>
);
