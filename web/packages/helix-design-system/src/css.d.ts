// Allow side-effect imports of stylesheets (e.g. `maplibre-gl/dist/maplibre-gl.css`
// pulled in by the map component). Bundlers handle these at runtime; this just
// gives `tsc` an ambient declaration so the type-check passes.
declare module '*.css';
