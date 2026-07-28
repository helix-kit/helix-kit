/* Fixed ambient background for the marketing surface: a deep near-black canvas
 * with a faint dot grid, a top brand glow, two slowly drifting colour blobs, and
 * a vignette. Pure CSS — no JS — so it's always present and cheap. */
export const SiteBackground = () => (
  <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#04070b]">
    {/* dot grid, fading toward the bottom */}
    <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,var(--color-border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_100%_75%_at_50%_0%,black,transparent_80%)] [background-size:34px_34px] opacity-40" />

    {/* top brand glow */}
    <div className="bg-brand/10 absolute -top-48 left-1/2 h-[520px] w-[960px] -translate-x-1/2 rounded-full blur-[130px]" />

    {/* drifting colour blobs */}
    <div className="bg-brand-cyan/10 absolute top-[28%] left-[8%] size-72 [animation:blob-drift_20s_ease-in-out_infinite] rounded-full blur-3xl motion-reduce:animate-none" />
    <div className="bg-brand-deep/10 absolute top-[58%] right-[6%] size-80 [animation:blob-drift_26s_ease-in-out_infinite_reverse] rounded-full blur-3xl motion-reduce:animate-none" />

    {/* vignette to settle the edges */}
    <div className="absolute inset-0 [background:radial-gradient(ellipse_85%_65%_at_50%_35%,transparent,#04070b_92%)]" />
  </div>
);
