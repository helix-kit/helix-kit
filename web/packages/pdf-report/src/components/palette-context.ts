import { createContext, useContext } from 'react';

import { defaultReportPalette, type ReportPalette } from './theme';

/**
 * The palette in force for the document being drawn.
 *
 * Provided by `ReportPage`, which is where the caller's branding lands, so every
 * component below a page picks it up without the render entry threading it
 * through. Defaults to Helix's own, which is what an unbranded render gets.
 */
export const ReportPaletteContext = createContext<ReportPalette>(defaultReportPalette);

export const useReportPalette = (): ReportPalette => useContext(ReportPaletteContext);
