'use client';

import * as React from 'react';

import {
  closestCorners,
  DndContext,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
  TouchSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Slot } from '@radix-ui/react-slot';
import * as ReactDOM from 'react-dom';

import { useComposedRefs } from '../lib/compose-refs';
import { cn } from '../lib/utils';

const ROOT_NAME = 'Kanban';
const BOARD_NAME = 'KanbanBoard';
const COLUMN_NAME = 'KanbanColumn';
const COLUMN_HANDLE_NAME = 'KanbanColumnHandle';
const COLUMN_CONTENT_NAME = 'KanbanColumnContent';
const ITEM_NAME = 'KanbanItem';
const ITEM_HANDLE_NAME = 'KanbanItemHandle';

const COLUMN_PREFIX = 'column:';
const ITEM_PREFIX = 'item:';
const COLUMN_DROP_PREFIX = 'column-drop:';

const toColumnSortableId = (columnId: string) => `${COLUMN_PREFIX}${columnId}`;
const toColumnDropId = (columnId: string) => `${COLUMN_DROP_PREFIX}${columnId}`;
const toItemSortableId = (itemId: UniqueIdentifier) => `${ITEM_PREFIX}${itemId.toString()}`;

interface KanbanRootContextValue<T> {
  value: Record<string, T[]>;
  itemLookup: Map<string, T>;
  getItemValue: (item: T) => string;
  onItemClick?: (item: T) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  columnOrder: string[];
}

const KanbanRootContext = React.createContext<KanbanRootContextValue<unknown> | null>(null);
KanbanRootContext.displayName = ROOT_NAME;

const useKanbanRootContext = (consumerName: string) => {
  const context = React.useContext(KanbanRootContext);
  if (context === null) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
};

const KanbanColumnContext = React.createContext<string | null>(null);
KanbanColumnContext.displayName = COLUMN_NAME;

const useKanbanColumnContext = (consumerName: string) => {
  const context = React.useContext(KanbanColumnContext);
  if (context === null) {
    throw new Error(`\`${consumerName}\` must be used within \`${COLUMN_NAME}\``);
  }
  return context;
};

interface KanbanSortableHandleContextValue {
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners | undefined;
  isDragging: boolean;
  disabled: boolean;
}

const KanbanColumnHandleContext = React.createContext<KanbanSortableHandleContextValue | null>(
  null,
);
KanbanColumnHandleContext.displayName = COLUMN_HANDLE_NAME;

const KanbanItemHandleContext = React.createContext<KanbanSortableHandleContextValue | null>(null);
KanbanItemHandleContext.displayName = ITEM_HANDLE_NAME;

interface KanbanProps<T> extends Omit<
  React.ComponentPropsWithoutRef<typeof DndContext>,
  'children'
> {
  value: Record<string, T[]>;
  onValueChange: (value: Record<string, T[]>) => void;
  getItemValue: (item: T) => string;
  onItemClick?: (item: T) => void;
  children: React.ReactNode;
}

const KanbanRoot = <T,>(props: KanbanProps<T>) => {
  const {
    value,
    onValueChange,
    getItemValue,
    onItemClick,
    onDragStart: onDragStartProp,
    onDragEnd: onDragEndProp,
    children,
    ...dndProps
  } = props;

  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columnOrder = React.useMemo(() => Object.keys(value), [value]);

  const itemLookup = React.useMemo(() => {
    const map = new Map<string, T>();
    for (const items of Object.values(value)) {
      for (const item of items) {
        map.set(getItemValue(item), item);
      }
    }
    return map;
  }, [value, getItemValue]);

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      onDragStartProp?.(event);
      setActiveId(event.active.id.toString());
    },
    [onDragStartProp],
  );

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      onDragEndProp?.(event);
      setActiveId(null);

      const { active, over } = event;
      if (over === null || active.id === over.id) {
        return;
      }

      const activeData = active.data.current;
      const overData = over.data.current;

      if (
        (activeData?.type as string | undefined) === 'column' &&
        (overData?.type as string | undefined) === 'column'
      ) {
        const activeColumnId = activeData?.columnId as string;
        const overColumnId = overData?.columnId as string;
        const activeIndex = columnOrder.indexOf(activeColumnId);
        const overIndex = columnOrder.indexOf(overColumnId);
        if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
          return;
        }

        const nextOrder = arrayMove(columnOrder, activeIndex, overIndex);
        const nextValue: Record<string, T[]> = {};
        for (const columnId of nextOrder) {
          nextValue[columnId] = value[columnId] ?? [];
        }
        onValueChange(nextValue);
        return;
      }

      if ((activeData?.type as string | undefined) !== 'item') {
        return;
      }

      const sourceColumnId = activeData?.columnId as string;
      if (sourceColumnId.length === 0) {
        return;
      }

      const overType = overData?.type as string | undefined;
      let targetColumnId = '';
      if (overType === 'item' || overType === 'column-drop' || overType === 'column') {
        targetColumnId = overData?.columnId as string;
      }

      if (targetColumnId.length === 0) {
        return;
      }

      const itemId = activeData?.itemId as string;
      const sourceItems = value[sourceColumnId] ?? [];
      const sourceIndex = sourceItems.findIndex((item) => getItemValue(item) === itemId);
      if (sourceIndex < 0) {
        return;
      }

      const targetItems = value[targetColumnId] ?? [];
      const movingItem = sourceItems[sourceIndex];
      if (movingItem === undefined) {
        return;
      }

      let targetIndex = targetItems.length;
      if ((overData?.type as string | undefined) === 'item') {
        const overItemId = overData?.itemId as string;
        const overIndex = targetItems.findIndex((item) => getItemValue(item) === overItemId);
        targetIndex = overIndex < 0 ? targetItems.length : overIndex;
      }

      if (sourceColumnId === targetColumnId) {
        const nextItems = arrayMove(sourceItems, sourceIndex, targetIndex);
        onValueChange({
          ...value,
          [sourceColumnId]: nextItems,
        });
        return;
      }

      const nextSourceItems = sourceItems.filter((_, index) => index !== sourceIndex);
      const nextTargetItems = [...targetItems];
      nextTargetItems.splice(targetIndex, 0, movingItem);

      onValueChange({
        ...value,
        [sourceColumnId]: nextSourceItems,
        [targetColumnId]: nextTargetItems,
      });
    },
    [onDragEndProp, columnOrder, value, onValueChange, getItemValue],
  );

  const contextValue = React.useMemo<KanbanRootContextValue<T>>(
    () => ({
      value,
      itemLookup,
      getItemValue,
      onItemClick,
      activeId,
      setActiveId,
      columnOrder,
    }),
    [value, itemLookup, getItemValue, onItemClick, activeId, columnOrder],
  );

  return (
    <KanbanRootContext.Provider value={contextValue as KanbanRootContextValue<unknown>}>
      <DndContext
        collisionDetection={closestCorners}
        sensors={sensors}
        {...dndProps}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
      >
        {children}
      </DndContext>
    </KanbanRootContext.Provider>
  );
};

const KanbanBoard = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => {
    const context = useKanbanRootContext(BOARD_NAME);

    return (
      <SortableContext
        items={context.columnOrder.map((columnId) => toColumnSortableId(columnId))}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={ref}
          className={cn('flex items-start gap-4 overflow-x-auto', className)}
          data-slot="kanban-board"
          {...props}
        />
      </SortableContext>
    );
  },
);
KanbanBoard.displayName = BOARD_NAME;

interface KanbanColumnProps extends React.ComponentPropsWithoutRef<'div'> {
  value: string;
}

const KanbanColumn = React.forwardRef<HTMLDivElement, KanbanColumnProps>(
  ({ value, className, style, ...props }, forwardedRef) => {
    if (value === '') {
      throw new Error(`\`${COLUMN_NAME}\` value cannot be an empty string`);
    }

    const {
      attributes,
      listeners,
      setNodeRef,
      setActivatorNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: toColumnSortableId(value),
      data: { type: 'column', columnId: value },
    });

    const ref = useComposedRefs(forwardedRef, setNodeRef);

    const composedStyle = React.useMemo<React.CSSProperties>(
      () => ({
        transform: CSS.Translate.toString(transform),
        transition,
        ...style,
      }),
      [transform, transition, style],
    );

    const handleContext = React.useMemo<KanbanSortableHandleContextValue>(
      () => ({
        setActivatorNodeRef,
        attributes,
        listeners,
        isDragging,
        disabled: false,
      }),
      [setActivatorNodeRef, attributes, listeners, isDragging],
    );

    return (
      <KanbanColumnContext.Provider value={value}>
        <KanbanColumnHandleContext.Provider value={handleContext}>
          <div
            ref={ref}
            className={cn('shrink-0 basis-72', isDragging && 'opacity-60', className)}
            data-dragging={isDragging ? '' : undefined}
            data-slot="kanban-column"
            style={composedStyle}
            {...props}
          />
        </KanbanColumnHandleContext.Provider>
      </KanbanColumnContext.Provider>
    );
  },
);
KanbanColumn.displayName = COLUMN_NAME;

interface KanbanColumnHandleProps extends React.ComponentPropsWithoutRef<'button'> {
  asChild?: boolean;
}

const KanbanColumnHandle = React.forwardRef<HTMLButtonElement, KanbanColumnHandleProps>(
  ({ asChild, className, disabled, ...props }, forwardedRef) => {
    useKanbanRootContext(COLUMN_HANDLE_NAME);
    const handleContext = React.useContext(KanbanColumnHandleContext);
    if (handleContext === null) {
      throw new Error(`\`${COLUMN_HANDLE_NAME}\` must be used within \`${COLUMN_NAME}\``);
    }

    const isDisabled = disabled ?? handleContext.disabled;
    const ref = useComposedRefs(forwardedRef, (node) => {
      if (!isDisabled) {
        handleContext.setActivatorNodeRef(node);
      }
    });

    const Comp = (asChild ?? false) ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(
          'cursor-grab touch-none rounded-md text-left select-none disabled:opacity-50 data-dragging:cursor-grabbing',
          className,
        )}
        data-slot="kanban-column-handle"
        disabled={isDisabled}
        type="button"
        {...(!isDisabled ? handleContext.attributes : {})}
        {...(!isDisabled ? handleContext.listeners : {})}
        {...props}
      />
    );
  },
);
KanbanColumnHandle.displayName = COLUMN_HANDLE_NAME;

interface KanbanColumnContentProps extends React.ComponentPropsWithoutRef<'div'> {
  value: string;
}

const KanbanColumnContent = React.forwardRef<HTMLDivElement, KanbanColumnContentProps>(
  ({ value, className, ...props }, forwardedRef) => {
    const context = useKanbanRootContext(COLUMN_CONTENT_NAME);
    const items = context.value[value] ?? [];

    const droppableId = toColumnDropId(value);
    const { setNodeRef } = useDroppable({
      id: droppableId,
      data: { type: 'column-drop', columnId: value },
    });

    const ref = useComposedRefs(forwardedRef, setNodeRef);

    return (
      <SortableContext
        items={items.map((item) => toItemSortableId(context.getItemValue(item)))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={ref}
          className={cn('flex min-h-24 flex-col gap-2', className)}
          data-slot="kanban-column-content"
          {...props}
        />
      </SortableContext>
    );
  },
);
KanbanColumnContent.displayName = COLUMN_CONTENT_NAME;

interface KanbanItemProps extends React.ComponentPropsWithoutRef<'div'> {
  value: string;
  disabled?: boolean;
}

const KanbanItem = React.forwardRef<HTMLDivElement, KanbanItemProps>(
  ({ value, className, style, disabled = false, onClick, ...props }, forwardedRef) => {
    const rootContext = useKanbanRootContext(ITEM_NAME);
    const columnId = useKanbanColumnContext(ITEM_NAME);

    const item = rootContext.itemLookup.get(value);
    if (item === undefined) {
      throw new Error(`\`${ITEM_NAME}\` value "${value}" not found in Kanban value map`);
    }

    const {
      attributes,
      listeners,
      setNodeRef,
      setActivatorNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: toItemSortableId(value),
      data: { type: 'item', itemId: value, columnId },
      disabled,
    });

    const ref = useComposedRefs(forwardedRef, setNodeRef);

    const composedStyle = React.useMemo<React.CSSProperties>(
      () => ({
        transform: CSS.Translate.toString(transform),
        transition,
        ...style,
      }),
      [transform, transition, style],
    );

    const handleContext = React.useMemo<KanbanSortableHandleContextValue>(
      () => ({
        setActivatorNodeRef,
        attributes,
        listeners,
        isDragging,
        disabled,
      }),
      [setActivatorNodeRef, attributes, listeners, isDragging, disabled],
    );

    const handleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      rootContext.onItemClick?.(item);
    };

    return (
      <KanbanItemHandleContext.Provider value={handleContext}>
        <div
          ref={ref}
          className={cn('rounded-md', isDragging && 'opacity-60', className)}
          data-disabled={disabled ? '' : undefined}
          data-dragging={isDragging ? '' : undefined}
          data-slot="kanban-item"
          role="button"
          style={composedStyle}
          tabIndex={disabled ? -1 : 0}
          {...props}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              rootContext.onItemClick?.(item);
            }
          }}
        />
      </KanbanItemHandleContext.Provider>
    );
  },
);
KanbanItem.displayName = ITEM_NAME;

interface KanbanItemHandleProps extends React.ComponentPropsWithoutRef<'button'> {
  asChild?: boolean;
}

const KanbanItemHandle = React.forwardRef<HTMLButtonElement, KanbanItemHandleProps>(
  ({ asChild, className, disabled, ...props }, forwardedRef) => {
    const handleContext = React.useContext(KanbanItemHandleContext);
    if (handleContext === null) {
      throw new Error(`\`${ITEM_HANDLE_NAME}\` must be used within \`${ITEM_NAME}\``);
    }

    const isDisabled = disabled ?? handleContext.disabled;

    const ref = useComposedRefs(forwardedRef, (node) => {
      if (!isDisabled) {
        handleContext.setActivatorNodeRef(node);
      }
    });

    const Comp = (asChild ?? false) ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(
          'cursor-grab touch-none select-none disabled:opacity-50 data-dragging:cursor-grabbing',
          className,
        )}
        data-slot="kanban-item-handle"
        disabled={isDisabled}
        type="button"
        {...(!isDisabled ? handleContext.attributes : {})}
        {...(!isDisabled ? handleContext.listeners : {})}
        {...props}
      />
    );
  },
);
KanbanItemHandle.displayName = ITEM_HANDLE_NAME;

interface KanbanOverlayProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DragOverlay>,
  'children'
> {
  container?: Element | DocumentFragment | null;
  children?: ((params: { item: null }) => React.ReactNode) | React.ReactNode;
}

const KanbanOverlay = (props: KanbanOverlayProps) => {
  const { container: containerProp, children, ...overlayProps } = props;
  const context = useKanbanRootContext('KanbanOverlay');

  const container = containerProp ?? (typeof document !== 'undefined' ? document.body : null);
  if (container === null) {
    return null;
  }

  return ReactDOM.createPortal(
    <DragOverlay {...overlayProps}>
      {context.activeId?.startsWith(ITEM_PREFIX) === true &&
        (typeof children === 'function' ? children({ item: null }) : children)}
    </DragOverlay>,
    container,
  );
};

export {
  KanbanRoot as Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanColumnContent,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
  KanbanRoot as Root,
  KanbanBoard as Board,
  KanbanColumn as Column,
  KanbanColumnHandle as ColumnHandle,
  KanbanColumnContent as ColumnContent,
  KanbanItem as Item,
  KanbanItemHandle as ItemHandle,
  KanbanOverlay as Overlay,
};
