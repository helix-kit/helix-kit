import type { Column } from '@tanstack/react-table';

/**
 * Computes sticky positioning styles for pinned data-table columns, including
 * optional inset borders for the outermost pinned edges.
 */
export const getCommonPinningStyles = <TData>({
  column,
  withBorder = false,
}: {
  column: Column<TData>;
  withBorder?: boolean;
}): React.CSSProperties => {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left');
  const isFirstRightPinnedColumn = isPinned === 'right' && column.getIsFirstColumn('right');
  let boxShadowValue: string | undefined;
  if (withBorder) {
    if (isLastLeftPinnedColumn) {
      boxShadowValue = '-4px 0 4px -4px var(--border) inset';
    } else if (isFirstRightPinnedColumn) {
      boxShadowValue = '4px 0 4px -4px var(--border) inset';
    }
  }
  return {
    boxShadow: boxShadowValue,
    left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    position: isPinned !== false ? 'sticky' : 'relative',
    width: column.getSize(),
    zIndex: isPinned !== false ? 1 : 0,
  };
};
