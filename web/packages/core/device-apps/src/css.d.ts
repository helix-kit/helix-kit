// CSS side-effect imports (e.g. xterm's stylesheet) carry no types; Next bundles
// them, tsc just needs to know the module resolves.
declare module '*.css';
