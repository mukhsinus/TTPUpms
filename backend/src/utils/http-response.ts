export interface ApiErrorObject {
  message: string;
  code: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  error: null;
}

export interface ApiFailureResponse {
  data: null;
  error: ApiErrorObject;
}

export function success<T>(data: T): ApiSuccessResponse<T> {
  return {
    data,
    error: null,
  };
}

export function failure(message: string, code: string): ApiFailureResponse {
  return {
    data: null,
    error: {
      message,
      code,
    },
  };
}

export function errorCodeFromStatus(statusCode: number): string {
  if (statusCode === 400) return "BAD_REQUEST";
  if (statusCode === 401) return "UNAUTHORIZED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode >= 500) return "INTERNAL_SERVER_ERROR";
  return "REQUEST_FAILED";
}
