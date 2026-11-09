type Status = { kind: "idle" } | { kind: "retry" } | { kind: "cancel" };

export function ownLine(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default:
      return 0;
  }
}

export function sameLine(status: Status): number {
  switch (status.kind) {
    case "idle":
    case "retry":
    case "cancel":
      return 3;
    default: return 0;
  }
}

export function tabs(flag: boolean): number {
	switch (flag) {
		case true:
			return 1;
		case false:
			return 2;
		default:
			return 0;
	}
}

export function empty(flag: boolean): number {
  switch (flag) {
    case true:
      return 1;
    case false:
      return 2;
    default:
  }
  return 0;
}

export function blockBody(flag: boolean): number {
  switch (flag) {
    case true:
      return 1;
    case false:
      return 2;
    default: {
      return 0;
    }
  }
}
