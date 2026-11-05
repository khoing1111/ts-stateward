import { CardExpiredError } from "./errors.js";
import type { Card } from "./gateway.js";

export function assertNotExpired(card: Card, today: string): void {
  if (card.expires < today) throw new CardExpiredError(card.expires);
}
