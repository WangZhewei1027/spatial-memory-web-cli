export class CliError extends Error {
  constructor(message: string, public readonly exitCode = 2, public readonly details?: unknown) {
    super(message);
  }
}

export class HttpError extends CliError {
  constructor(public readonly status: number, message: string, details?: unknown) {
    super(message, status === 401 ? 3 : status === 403 ? 4 : 1, details);
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("需要 JSON 对象");
  return value as Record<string, unknown>;
}
