import type { ReactNode } from 'react';

export const SpecSection = ({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) => (
  <section className="space-y-3">
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint == null ? null : <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
    {children}
  </section>
);

export const SpecTable = ({
  headers,
  rows,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}) => {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No data recorded.</p>;
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 text-left font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- rows are positional spec data with no stable key
            <tr key={rowIndex} className="border-border border-t">
              {row.map((cell, cellIndex) => (
                // eslint-disable-next-line react/no-array-index-key -- same
                <td key={cellIndex} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
