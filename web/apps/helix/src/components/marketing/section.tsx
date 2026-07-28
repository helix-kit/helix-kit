import { cn } from '@helix/design-system/lib/utils';

export const Section = ({ className, children, ...props }: React.ComponentProps<'section'>) => (
  <section className={cn('border-border/60 border-b', className)} {...props}>
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">{children}</div>
  </section>
);

export const SectionHeading = ({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('max-w-2xl', className)}>
    {eyebrow != null && eyebrow !== '' ? (
      <p className="text-brand mb-3 text-xs font-medium tracking-widest uppercase">{eyebrow}</p>
    ) : null}
    <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
      {title}
    </h2>
    {description != null ? (
      <p className="text-muted-foreground mt-4 text-base/7 text-pretty">{description}</p>
    ) : null}
  </div>
);
