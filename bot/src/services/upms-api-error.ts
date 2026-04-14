/** Structured failure from the UPMS bot HTTP API (or local parse layer). */
export class UpmsApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: {
      code: string;
      httpStatus: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "UpmsApiError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.details = opts.details;
  }
}
