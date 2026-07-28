export const SiteBackground = () => (
  <div aria-hidden className="bg-background pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,var(--color-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_100%_75%_at_50%_0%,black,transparent_80%)] [background-size:34px_34px] opacity-40" />

    <div className="bg-brand/10 absolute -top-48 left-1/2 h-[520px] w-[960px] -translate-x-1/2 rounded-full blur-[130px]" />

    <div className="bg-brand-cyan/10 absolute top-[28%] left-[8%] size-72 [animation:blob-drift_20s_ease-in-out_infinite] rounded-full blur-3xl motion-reduce:animate-none" />
    <div className="bg-brand-deep/10 absolute top-[58%] right-[6%] size-80 [animation:blob-drift_26s_ease-in-out_infinite_reverse] rounded-full blur-3xl motion-reduce:animate-none" />

    <div className="absolute inset-0 [background:radial-gradient(ellipse_85%_65%_at_50%_35%,transparent,var(--background)_92%)]" />
  </div>
);
