'use client';

import * as React from 'react';

import {
  type Announcements,
  closestCenter,
  closestCorners,
  DndContext,
  type DndContextProps,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  type ScreenReaderInstructions,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  type SortableContextProps,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Slot } from '@radix-ui/react-slot';
import * as ReactDOM from 'react-dom';

import { useComposedRefs } from '../lib/compose-refs';
import { cn } from '../lib/utils';

const orientationConfig = {
  vertical: {
    modifiers: [restrictToVerticalAxis, restrictToParentElement],
    strategy: verticalListSortingStrategy,
    collisionDetection: closestCenter,
  },
  horizontal: {
    modifiers: [restrictToHorizontalAxis, restrictToParentElement],
    strategy: horizontalListSortingStrategy,
    collisionDetection: closestCenter,
  },
  mixed: {
    modifiers: [restrictToParentElement],
    strategy: undefined,
    collisionDetection: closestCorners,
  },
};

const ROOT_NAME = 'Sortable';
const CONTENT_NAME = 'SortableContent';
const ITEM_NAME = 'SortableItem';
const ITEM_HANDLE_NAME = 'SortableItemHandle';
const OVERLAY_NAME = 'SortableOverlay';

interface SortableRootContextValue<T> {
  id: string;
  items: UniqueIdentifier[];
  modifiers: DndContextProps['modifiers'];
  strategy: SortableContextProps['strategy'];
  activeId: UniqueIdentifier | null;
  setActiveId: (id: UniqueIdentifier | null) => void;
  getItemValue: (item: T) => UniqueIdentifier;
  flatCursor: boolean;
}

const SortableRootContext = React.createContext<SortableRootContextValue<unknown> | null>(null);
SortableRootContext.displayName = ROOT_NAME;

const useSortableContext = (consumerName: string) => {
  const context = React.useContext(SortableRootContext);
  if (context === null) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
};

interface GetItemValue<T> {
  /**
   * Callback that returns a unique identifier for each sortable item. Required for array of objects.
   * @example getItemValue={(item) => item.id}
   */
  getItemValue: (item: T) => UniqueIdentifier;
}

type SortableRootProps<T> = DndContextProps & {
  value: T[];
  onValueChange?: (items: T[]) => void;
  onMove?: (event: DragEndEvent & { activeIndex: number; overIndex: number }) => void;
  strategy?: SortableContextProps['strategy'];
  orientation?: 'vertical' | 'horizontal' | 'mixed';
  flatCursor?: boolean;
} & (T extends object ? GetItemValue<T> : Partial<GetItemValue<T>>);

// Helper to safely get sortable index from drag data
const getSortableIndex = (data: unknown): number => {
  if (typeof data === 'object' && data !== null && 'current' in data) {
    const { current } = data as { current?: unknown };
    if (typeof current === 'object' && current !== null && 'sortable' in current) {
      const { sortable } = current as { sortable?: unknown };
      if (typeof sortable === 'object' && sortable !== null && 'index' in sortable) {
        const { index } = sortable as { index?: unknown };
        if (typeof index === 'number') {
          return index;
        }
      }
    }
  }
  return 0;
};

/**
 * Accessible drag-and-drop root built on top of `@dnd-kit`.
 *
 * Object arrays must provide `getItemValue` so the sortable ids remain stable
 * across reorders. When `onMove` is omitted, the component applies `arrayMove`
 * and emits the reordered collection through `onValueChange`.
 */
const SortableRoot = <T,>(props: SortableRootProps<T>) => {
  const {
    value,
    onValueChange,
    collisionDetection,
    modifiers,
    strategy,
    onMove,
    orientation = 'vertical',
    flatCursor = false,
    getItemValue: getItemValueProp,
    accessibility,
    ...sortableProps
  } = props;

  const id = React.useId();
  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const config = React.useMemo(() => orientationConfig[orientation], [orientation]);

  const getItemValue: (item: T) => UniqueIdentifier = React.useCallback(
    (item: T) => {
      if (typeof item === 'object' && item != null && getItemValueProp === undefined) {
        throw new Error('getItemValue is required when using array of objects');
      }

      return getItemValueProp !== undefined ? getItemValueProp(item) : (item as UniqueIdentifier);
    },
    [getItemValueProp],
  );

  const items = React.useMemo(() => {
    return value.map((item) => getItemValue(item));
  }, [value, getItemValue]);

  const {
    onDragStart: onDragStartProp,
    onDragEnd: onDragEndProp,
    onDragCancel: onDragCancelProp,
  } = sortableProps;

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      onDragStartProp?.(event);

      if (event.activatorEvent.defaultPrevented) {
        return;
      }

      setActiveId(event.active.id);
    },
    [onDragStartProp],
  );

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      onDragEndProp?.(event);

      if (event.activatorEvent.defaultPrevented) {
        return;
      }

      const { active, over } = event;
      if (over !== null && active.id !== over.id) {
        const activeIndex = value.findIndex((item) => getItemValue(item) === active.id);
        const overIndex = value.findIndex((item) => getItemValue(item) === over.id);

        if (onMove !== undefined) {
          onMove({ ...event, activeIndex, overIndex });
        } else {
          onValueChange?.(arrayMove(value, activeIndex, overIndex));
        }
      }
      setActiveId(null);
    },
    [value, onValueChange, onMove, getItemValue, onDragEndProp],
  );

  const onDragCancel = React.useCallback(
    (event: DragEndEvent) => {
      onDragCancelProp?.(event);

      if (event.activatorEvent.defaultPrevented) {
        return;
      }

      setActiveId(null);
    },
    [onDragCancelProp],
  );

  const announcements: Announcements = React.useMemo(
    () => ({
      onDragStart: ({ active }) => {
        const activeValue = active.id.toString();
        return `Grabbed sortable item "${activeValue}". Current position is ${getSortableIndex(active.data) + 1} of ${value.length}. Use arrow keys to move, space to drop.`;
      },
      onDragOver: ({ active, over }) => {
        if (over !== null) {
          const overIndex = getSortableIndex(over.data);
          const activeIndex = getSortableIndex(active.data);
          const moveDirection = overIndex > activeIndex ? 'down' : 'up';
          const activeValue = active.id.toString();
          return `Sortable item "${activeValue}" moved ${moveDirection} to position ${overIndex + 1} of ${value.length}.`;
        }
        return 'Sortable item is no longer over a droppable area. Press escape to cancel.';
      },
      onDragEnd: ({ active, over }) => {
        const activeValue = active.id.toString();
        if (over !== null) {
          const overIndex = getSortableIndex(over.data);
          return `Sortable item "${activeValue}" dropped at position ${overIndex + 1} of ${value.length}.`;
        }
        return `Sortable item "${activeValue}" dropped. No changes were made.`;
      },
      onDragCancel: ({ active }) => {
        const activeIndex = getSortableIndex(active.data);
        const activeValue = active.id.toString();
        return `Sorting cancelled. Sortable item "${activeValue}" returned to position ${activeIndex + 1} of ${value.length}.`;
      },
      onDragMove: ({ active, over }) => {
        if (over !== null) {
          const overIndex = getSortableIndex(over.data);
          const activeIndex = getSortableIndex(active.data);
          const moveDirection = overIndex > activeIndex ? 'down' : 'up';
          const activeValue = active.id.toString();
          return `Sortable item "${activeValue}" is moving ${moveDirection} to position ${overIndex + 1} of ${value.length}.`;
        }
        return 'Sortable item is no longer over a droppable area. Press escape to cancel.';
      },
    }),
    [value],
  );

  const screenReaderInstructions: ScreenReaderInstructions = React.useMemo(() => {
    let directionKeys = 'arrow';
    if (orientation === 'vertical') {
      directionKeys = 'up and down';
    } else if (orientation === 'horizontal') {
      directionKeys = 'left and right';
    }

    return {
      draggable: `
          To pick up a sortable item, press space or enter.
          While dragging, use the ${directionKeys} keys to move the item.
          Press space or enter again to drop the item in its new position, or press escape to cancel.
        `,
    };
  }, [orientation]);

  const contextValue = React.useMemo(
    () => ({
      id,
      items,
      modifiers: modifiers ?? config.modifiers,
      strategy: strategy ?? config.strategy,
      activeId,
      setActiveId,
      getItemValue,
      flatCursor,
    }),
    [
      id,
      items,
      modifiers,
      strategy,
      config.modifiers,
      config.strategy,
      activeId,
      getItemValue,
      flatCursor,
    ],
  );

  return (
    <SortableRootContext.Provider value={contextValue as SortableRootContextValue<unknown>}>
      <DndContext
        collisionDetection={collisionDetection ?? config.collisionDetection}
        modifiers={modifiers ?? config.modifiers}
        sensors={sensors}
        {...sortableProps}
        accessibility={{
          announcements,
          screenReaderInstructions,
          ...accessibility,
        }}
        id={id}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
      />
    </SortableRootContext.Provider>
  );
};

const SortableContentContext = React.createContext<boolean>(false);
SortableContentContext.displayName = CONTENT_NAME;

interface SortableContentProps extends React.ComponentPropsWithoutRef<'div'> {
  strategy?: SortableContextProps['strategy'];
  children: React.ReactNode;
  asChild?: boolean;
  withoutSlot?: boolean;
}

/** Declares the sortable items container and wires the chosen sorting strategy. */
const SortableContent = React.forwardRef<HTMLDivElement, SortableContentProps>(
  (props, forwardedRef) => {
    const { strategy: strategyProp, asChild, withoutSlot, children, ...contentProps } = props;

    const context = useSortableContext(CONTENT_NAME);

    const ContentPrimitive = (asChild ?? false) ? Slot : 'div';

    return (
      <SortableContentContext.Provider value>
        <SortableContext items={context.items} strategy={strategyProp ?? context.strategy}>
          {(withoutSlot ?? false) ? (
            children
          ) : (
            <ContentPrimitive data-slot="sortable-content" {...contentProps} ref={forwardedRef}>
              {children}
            </ContentPrimitive>
          )}
        </SortableContext>
      </SortableContentContext.Provider>
    );
  },
);
SortableContent.displayName = CONTENT_NAME;

interface SortableItemContextValue {
  id: string;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners | undefined;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  disabled?: boolean;
}

const SortableItemContext = React.createContext<SortableItemContextValue | null>(null);
SortableItemContext.displayName = ITEM_NAME;

const useSortableItemContext = (consumerName: string) => {
  const context = React.useContext(SortableItemContext);
  if (context === null) {
    throw new Error(`\`${consumerName}\` must be used within \`${ITEM_NAME}\``);
  }
  return context;
};

interface SortableItemProps extends React.ComponentPropsWithoutRef<'div'> {
  value: UniqueIdentifier;
  asHandle?: boolean;
  asChild?: boolean;
  disabled?: boolean;
}

/**
 * Registers a draggable item with the surrounding sortable context.
 *
 * `value` must match one of the ids produced by the root `value` array.
 */
const SortableItem = React.forwardRef<HTMLDivElement, SortableItemProps>((props, forwardedRef) => {
  const { value, style, asHandle, asChild, disabled, className, ...itemProps } = props;

  const inSortableContent = React.useContext(SortableContentContext);
  const inSortableOverlay = React.useContext(SortableOverlayContext);

  if (!inSortableContent && !inSortableOverlay) {
    throw new Error(
      `\`${ITEM_NAME}\` must be used within \`${CONTENT_NAME}\` or \`${OVERLAY_NAME}\``,
    );
  }

  if (value === '') {
    throw new Error(`\`${ITEM_NAME}\` value cannot be an empty string`);
  }

  const context = useSortableContext(ITEM_NAME);
  const id = React.useId();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value, disabled });

  const composedRef = useComposedRefs(forwardedRef, (node) => {
    if (disabled ?? false) {
      return;
    }
    setNodeRef(node);
    if (asHandle ?? false) {
      setActivatorNodeRef(node);
    }
  });

  const composedStyle = React.useMemo<React.CSSProperties>(() => {
    return {
      transform: CSS.Translate.toString(transform),
      transition,
      ...style,
    };
  }, [transform, transition, style]);

  const itemContext = React.useMemo<SortableItemContextValue>(
    () => ({
      id,
      attributes,
      listeners,
      setActivatorNodeRef,
      isDragging,
      disabled,
    }),
    [id, attributes, listeners, setActivatorNodeRef, isDragging, disabled],
  );

  const ItemPrimitive = (asChild ?? false) ? Slot : 'div';

  return (
    <SortableItemContext.Provider value={itemContext}>
      <ItemPrimitive
        data-disabled={disabled}
        data-dragging={isDragging ? '' : undefined}
        data-slot="sortable-item"
        id={id}
        {...itemProps}
        {...((asHandle ?? false) && !(disabled ?? false) ? attributes : {})}
        {...((asHandle ?? false) && !(disabled ?? false) ? listeners : {})}
        ref={composedRef}
        className={cn(
          'focus-visible:ring-ring focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden',
          {
            'touch-none select-none': asHandle,
            'cursor-default': context.flatCursor,
            'data-dragging:cursor-grabbing': !context.flatCursor,
            'cursor-grab': !isDragging && (asHandle ?? false) && !context.flatCursor,
            'opacity-50': isDragging,
            'pointer-events-none opacity-50': disabled,
          },
          className,
        )}
        style={composedStyle}
      />
    </SortableItemContext.Provider>
  );
});
SortableItem.displayName = ITEM_NAME;

interface SortableItemHandleProps extends React.ComponentPropsWithoutRef<'button'> {
  asChild?: boolean;
}

/** Optional drag handle for a `SortableItem` when dragging should not start from the whole row. */
const SortableItemHandle = React.forwardRef<HTMLButtonElement, SortableItemHandleProps>(
  (props, forwardedRef) => {
    const { asChild, disabled, className, ...itemHandleProps } = props;

    const context = useSortableContext(ITEM_HANDLE_NAME);
    const itemContext = useSortableItemContext(ITEM_HANDLE_NAME);

    const isDisabled = disabled ?? itemContext.disabled;

    const composedRef = useComposedRefs(forwardedRef, (node) => {
      if (!(isDisabled ?? false)) {
        return;
      }
      itemContext.setActivatorNodeRef(node);
    });

    const HandlePrimitive = (asChild ?? false) ? Slot : 'button';

    return (
      <HandlePrimitive
        aria-controls={itemContext.id}
        data-disabled={isDisabled}
        data-dragging={(itemContext.isDragging ?? false) ? '' : undefined}
        data-slot="sortable-item-handle"
        type="button"
        {...itemHandleProps}
        {...((isDisabled ?? false) ? {} : itemContext.attributes)}
        {...((isDisabled ?? false) ? {} : itemContext.listeners)}
        ref={composedRef}
        className={cn(
          'select-none disabled:pointer-events-none disabled:opacity-50',
          context.flatCursor ? 'cursor-default' : 'cursor-grab data-dragging:cursor-grabbing',
          className,
        )}
        disabled={isDisabled}
      />
    );
  },
);
SortableItemHandle.displayName = ITEM_HANDLE_NAME;

const SortableOverlayContext = React.createContext(false);
SortableOverlayContext.displayName = OVERLAY_NAME;

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4',
      },
    },
  }),
};

interface SortableOverlayProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DragOverlay>,
  'children'
> {
  container?: Element | DocumentFragment | null;
  children?: ((params: { value: UniqueIdentifier }) => React.ReactNode) | React.ReactNode;
}

/**
 * Portal-based drag preview for the active sortable item.
 *
 * When no `container` is supplied it renders into `document.body` after mount.
 */
const SortableOverlay = (props: SortableOverlayProps) => {
  const { container: containerProp, children, ...overlayProps } = props;

  const context = useSortableContext(OVERLAY_NAME);

  const container = containerProp ?? (typeof document !== 'undefined' ? document.body : null);

  if (container === null) {
    return null;
  }

  return ReactDOM.createPortal(
    <DragOverlay
      className={cn(!context.flatCursor && 'cursor-grabbing')}
      dropAnimation={dropAnimation}
      modifiers={context.modifiers}
      {...overlayProps}
    >
      <SortableOverlayContext.Provider value>
        {context.activeId !== null &&
          (typeof children === 'function' ? children({ value: context.activeId }) : children)}
      </SortableOverlayContext.Provider>
    </DragOverlay>,
    container,
  );
};

export {
  SortableRoot as Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
  //
  SortableRoot as Root,
  SortableContent as Content,
  SortableItem as Item,
  SortableItemHandle as ItemHandle,
  SortableOverlay as Overlay,
};
