// Thrown by services for expected business-rule failures (404/422/...); the
// central error handler in app.ts maps it straight to the given status/body,
// keeping routes thin (services own the status code, not the route).
export class HttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'string' ? body : JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}
