// A status typed as string literals, matched with the members of an enum of the same values
// (Infisical's certificate requests, user trial 1.0.2): TypeScript narrows by value.
export enum RequestStatus {
  Pending = "pending",
  Issued = "issued",
  Failed = "failed",
}

type Request = { status: "pending" | "issued" | "failed" };

export function badge(request: Request): string {
  const { status } = request;
  switch (status) {
    case RequestStatus.Issued:
      return "Issued";
    case RequestStatus.Failed:
      return "Failed";
    default:
      return status;
  }
}

/** Every case listed and a `default` that throws: a new value compiles, then throws. */
export function label(status: RequestStatus): string {
  switch (status) {
    case RequestStatus.Pending:
      return "Pending";
    case RequestStatus.Issued:
      return "Issued";
    case RequestStatus.Failed:
      return "Failed";
    default:
      throw new Error(`Unhandled status: ${String(status)}`);
  }
}
