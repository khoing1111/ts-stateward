declare module "cart-kit" {
  export function useKitCart(): { save: () => Promise<void>; items: readonly string[] };
}
