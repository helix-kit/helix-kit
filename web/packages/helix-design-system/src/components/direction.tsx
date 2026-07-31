'use client';

import type * as React from 'react';

import { Direction } from 'radix-ui';

const DirectionProvider = ({
  dir,
  direction,
  children,
}: React.ComponentProps<typeof Direction.DirectionProvider> & {
  direction?: React.ComponentProps<typeof Direction.DirectionProvider>['dir'];
}) => <Direction.DirectionProvider dir={direction ?? dir}>{children}</Direction.DirectionProvider>;

const { useDirection } = Direction;

export { DirectionProvider, useDirection };
