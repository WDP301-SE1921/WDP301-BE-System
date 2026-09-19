import { HttpStatus } from '@nestjs/common';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = AppError.name;
  }
}
