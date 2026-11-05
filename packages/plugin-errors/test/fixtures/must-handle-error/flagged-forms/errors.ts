/** @mustHandle Tell the user the card was declined. */
export class Declined extends Error {}

/** A declined card the user fixes by renewing it. */
export class Expired extends Declined {}

declare const flag: boolean;

export function pay(): number {
  if (flag) throw new Declined("declined");
  return 1;
}
