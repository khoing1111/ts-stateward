import { FIRST, orderId, type OrderId } from "./order-id.js";
import type { Label } from "./label.js";
import { point, type Point } from "./point.js";

type Id = OrderId;

export function save(id: OrderId): OrderId {
  return id;
}

export function flagged(raw: string, text: string, flag: boolean): void {
  save("o-2");
  const cast: OrderId = raw as OrderId;
  const parsed: OrderId = JSON.parse(text);
  const where: Point = { x: 1, y: 2 };
  const maybe: OrderId | undefined = flag ? raw : undefined;
  const label: Label = "urgent";
  const renamed: Id = raw;
  void [cast, parsed, where, maybe, label, renamed];
}

export function notFlagged(raw: string): void {
  const checked = orderId(raw);
  if (checked !== undefined) save(checked);
  save(FIRST);
  const found = point(1, 2);
  const kept: OrderId | undefined = checked;
  const plain: string = FIRST;
  void [found, kept, plain];
}
