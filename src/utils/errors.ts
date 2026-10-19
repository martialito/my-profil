export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'BAD_REQUEST',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 404, 'NOT_FOUND');
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string, phase: number) {
    super(`${feature} is not implemented yet (planned for Phase ${phase}).`, 501, 'NOT_IMPLEMENTED');
  }
}
