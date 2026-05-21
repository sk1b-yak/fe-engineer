// Wrangler/esbuild resolves `.wasm` imports to a compiled WebAssembly.Module.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
