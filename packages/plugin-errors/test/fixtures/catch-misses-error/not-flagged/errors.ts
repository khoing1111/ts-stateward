export class HttpError extends Error {
  override name = "HttpError";
}
export class TimeoutError extends HttpError {
  override name = "TimeoutError";
}
export class AuthError extends HttpError {
  override name = "AuthError";
}
export class RateLimitError extends Error {
  retry = true;
  override name = "RateLimitError";
}

function tagged<T extends new (...args: never[]) => Error>(base: T): T {
  return base;
}
export class MixedError extends tagged(Error) {}
