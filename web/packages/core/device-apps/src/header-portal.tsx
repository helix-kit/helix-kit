'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { createPortal } from 'react-dom';

// A slot in a parent-mounted header that child surfaces can render into, so a full-bleed app can put controls in the app header.
type HeaderPortalContextValue = {
  portalRef: HTMLElement | null;
  setPortalRef: (ref: HTMLElement | null) => void;
};

const HeaderPortalContext = createContext<HeaderPortalContextValue | null>(null);

export const HeaderPortalProvider = ({ children }: { children: ReactNode }) => {
  const [portalRef, setPortalRef] = useState<HTMLElement | null>(null);
  return (
    <HeaderPortalContext.Provider value={{ portalRef, setPortalRef }}>
      {children}
    </HeaderPortalContext.Provider>
  );
};

const useHeaderPortal = (): HeaderPortalContextValue => {
  const context = useContext(HeaderPortalContext);
  if (context === null) {
    throw new Error('useHeaderPortal must be used within a HeaderPortalProvider');
  }
  return context;
};

// Mounted in the header; children of <HeaderPortal> render here.
export const HeaderPortalTarget = ({ className }: { className?: string }) => {
  const { setPortalRef } = useHeaderPortal();
  return <div ref={setPortalRef} className={className} />;
};

// Rendered by a surface; teleports its children into the header target.
export const HeaderPortal = ({ children }: { children: ReactNode }) => {
  const { portalRef } = useHeaderPortal();
  return portalRef === null ? null : createPortal(children, portalRef);
};
