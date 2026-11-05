export class ParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParseError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class HttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export class TimeoutError extends HttpError {}
