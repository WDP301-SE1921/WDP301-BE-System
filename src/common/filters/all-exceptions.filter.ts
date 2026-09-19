import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppError } from '../errors/app.error';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = String(response.locals.requestId ?? 'unknown');
    const normalized = this.normalizeException(exception);

    if (normalized.statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error({
        requestId,
        method: request.method,
        route: request.originalUrl,
        errorName: exception instanceof Error ? exception.name : 'UnknownError',
      });
    }

    const body: ErrorBody = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    };
    response.status(normalized.statusCode).json(body);
  }

  private normalizeException(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const details = typeof response === 'object' ? response : undefined;
      return {
        statusCode,
        code: statusCode === Number(HttpStatus.BAD_REQUEST) ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
        message:
          statusCode === Number(HttpStatus.BAD_REQUEST)
            ? 'Request validation failed'
            : exception.message,
        details,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }
}
