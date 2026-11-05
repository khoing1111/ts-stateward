export class NotFoundError extends Error {
  override name = "NotFoundError";
}
export class ParseError extends Error {
  override name = "ParseError";
}
export class ValidationError extends Error {
  override name = "ValidationError";
}
