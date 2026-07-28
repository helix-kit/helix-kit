/**
 * Formats a date-like value for the data-table UI.
 *
 * Invalid or missing values resolve to an empty string so cell renderers can
 * stay defensive without extra guards.
 */
export const formatDate = (
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {},
) => {
  if (date === undefined) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: opts.month ?? 'long',
      day: opts.day ?? 'numeric',
      year: opts.year ?? 'numeric',
      ...opts,
    }).format(new Date(date));
  } catch {
    return '';
  }
};
