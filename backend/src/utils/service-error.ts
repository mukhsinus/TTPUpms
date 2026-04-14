export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Stable machine-readable code for clients (defaults to generic status mapping if omitted). */
    public readonly clientCode?: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
