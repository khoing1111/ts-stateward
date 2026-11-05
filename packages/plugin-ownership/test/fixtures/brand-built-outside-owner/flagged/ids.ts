import type { Brand } from "./brand.js";

export type UserId = Brand<string, "UserId">;
export type OrderId = Brand<string, "OrderId">;

export function userId(text: string): UserId | undefined {
  return text.startsWith("u_") ? (text as UserId) : undefined;
}

// Exported by name, with the return type left to inference: still the brand's constructor.
function makeOrderId(text: string) {
  return text.startsWith("o_") ? (text as OrderId) : undefined;
}

export { makeOrderId as orderId };
