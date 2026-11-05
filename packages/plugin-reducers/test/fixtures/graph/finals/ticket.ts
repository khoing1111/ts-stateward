export type TicketState = { status: "open" } | { status: "closed" } | { status: "stuck" };

export type TicketEvent = { type: "close" } | { type: "reopen" } | { type: "park" };

// One name a line; "closed" is listed but the reducer leaves it.
export const TICKET_FINAL_STATUSES = [
  "closed",
] as const satisfies readonly TicketState["status"][];

// Not typed against the union: nothing checks these names, so the list is not read.
export const LOOSE_FINAL_STATES = ["stuck"];

export function ticketReducer(
  state: TicketState = { status: "open" },
  event: TicketEvent,
): TicketState {
  switch (state.status) {
    case "open":
      return event.type === "close" ? { status: "closed" } : { status: "stuck" };
    case "closed":
      return event.type === "reopen" ? { status: "open" } : state;
    case "stuck":
      return state;
  }
}
