export class HttpError extends Error {
  override name = "HttpError";
}
export class NotFoundError extends HttpError {
  override name = "NotFoundError";
}
