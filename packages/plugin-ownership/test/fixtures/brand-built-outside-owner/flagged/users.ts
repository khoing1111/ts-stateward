import type { OrderId, UserId } from "./ids.js";
import type { Email } from "./email.js";
import type { Qty } from "./qty.js";

declare const text: string;
declare const input: number;

export const user = text as UserId;
export const order = <OrderId>text;
export const qty = input as Qty;
export const both = text as UserId & OrderId;
export const address = text as Email;
