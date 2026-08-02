/**
 * The mount contract between this feature package and its host app. The host composes
 * `blogAdminRouter` / `blogPublicRouter` into its root router under exactly these keys;
 * the blog's client components resolve them back out by the same keys, which is how the
 * package stays typed without ever importing the host's `AppRouter`.
 */
export const BLOG_ADMIN_ROUTER_KEY = 'blog';
export const BLOG_PUBLIC_ROUTER_KEY = 'blogPublic';
