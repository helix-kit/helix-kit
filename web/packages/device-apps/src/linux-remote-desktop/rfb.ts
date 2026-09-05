// noVNC ships no type declarations. An ambient .d.ts would not help consumers —
// they compile this package from source, and an ambient file nothing imports never
// reaches their program — so the slice we use is typed here and loaded through one
// cast at a single site.

export type RFBOptions = Readonly<{
  shared?: boolean;
  credentials?: { username?: string; password?: string; target?: string };
}>;

export type RFBInstance = EventTarget & {
  viewOnly: boolean;
  clipViewport: boolean;
  scaleViewport: boolean;
  resizeSession: boolean;
  background: string;
  qualityLevel: number;
  compressionLevel: number;
  disconnect: () => void;
  focus: () => void;
  blur: () => void;
  sendCtrlAltDel: () => void;
  clipboardPasteFrom: (text: string) => void;
};

export type RFBConstructor = new (
  target: Element,
  urlOrChannel: unknown,
  options?: RFBOptions,
) => RFBInstance;

/** Load noVNC's RFB client. Dynamic because it touches the DOM at module scope. */
export const loadRFB = async (): Promise<RFBConstructor> => {
  // @ts-expect-error -- @novnc/novnc has no type declarations
  const module = (await import('@novnc/novnc')) as unknown;
  return (module as { default: RFBConstructor }).default;
};
