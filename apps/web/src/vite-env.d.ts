/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "*.css" {
  const css: string;
  export default css;
}
