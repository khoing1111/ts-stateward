export class RateLimitError extends Error {
  override name = "RateLimitError";
}
export class AuthError extends Error {
  override name = "AuthError";
}
export class ParseError extends Error {
  override name = "ParseError";
}
export class QuotaError extends Error {
  override name = "QuotaError";
}
export class ConflictError extends Error {
  override name = "ConflictError";
}
export class FirstError extends Error {
  override name = "FirstError";
}
export class SecondError extends Error {
  override name = "SecondError";
}
