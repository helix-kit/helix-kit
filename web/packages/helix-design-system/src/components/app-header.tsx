'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { cn } from '@helix-hq/design-system/lib/utils';
import { createPortal } from 'react-dom';

type HeaderPortalContextValue = {
  leftPortalRef: HTMLDivElement | null;
  rightPortalRef: HTMLDivElement | null;
  setLeftPortalRef: (ref: HTMLDivElement | null) => void;
  setRightPortalRef: (ref: HTMLDivElement | null) => void;
};

const HeaderPortalContext = createContext<HeaderPortalContextValue | undefined>(undefined);

const useHeaderPortalContext = () => {
  const context = useContext(HeaderPortalContext);
  if (context === undefined) {
    throw new Error('Header portal components must be used within HeaderPortalProvider.');
  }

  return context;
};

export const HeaderPortalProvider = ({ children }: { children: ReactNode }) => {
  const [leftPortalRef, setLeftPortalRef] = useState<HTMLDivElement | null>(null);
  const [rightPortalRef, setRightPortalRef] = useState<HTMLDivElement | null>(null);

  return (
    <HeaderPortalContext.Provider
      value={{ leftPortalRef, rightPortalRef, setLeftPortalRef, setRightPortalRef }}
    >
      {children}
    </HeaderPortalContext.Provider>
  );
};

export const HeaderLeftPortalTarget = ({ className }: { className?: string }) => {
  const { setLeftPortalRef } = useHeaderPortalContext();
  return <div ref={setLeftPortalRef} className={cn('flex items-center gap-2', className)} />;
};

export const HeaderRightPortalTarget = ({ className }: { className?: string }) => {
  const { setRightPortalRef } = useHeaderPortalContext();
  return <div ref={setRightPortalRef} className={cn('flex items-center gap-2', className)} />;
};

export const HeaderLeftPortal = ({ children }: { children: ReactNode }) => {
  const { leftPortalRef } = useHeaderPortalContext();

  if (leftPortalRef === null) {
    return null;
  }

  return createPortal(children, leftPortalRef);
};

export const HeaderRightPortal = ({ children }: { children: ReactNode }) => {
  const { rightPortalRef } = useHeaderPortalContext();

  if (rightPortalRef === null) {
    return null;
  }

  return createPortal(children, rightPortalRef);
};

type AppHeaderProps = React.ComponentProps<'header'> & {
  leftContent?: ReactNode;
  rightContent?: ReactNode;
};

export const AppHeader = ({ className, leftContent, rightContent, ...props }: AppHeaderProps) => (
  <header
    className={cn(
      'bg-background sticky top-0 flex min-h-16 flex-col items-center justify-center border-b',
      className,
    )}
    data-slot="app-header"
    {...props}
  >
    <div className="flex h-full w-full items-center justify-between gap-4 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {leftContent}
        <HeaderLeftPortalTarget className="min-w-0" />
      </div>
      <div className="flex items-center gap-2">
        <HeaderRightPortalTarget />
        {rightContent}
      </div>
    </div>
  </header>
);
