import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException } from '../errors/domain.exception.js';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json({
      ...body,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private toBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      };
    }

    if (exception instanceof DomainException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const rawMessage =
      typeof payload === 'string'
        ? payload
        : ((payload as { message?: string | string[] }).message ??
          exception.message);

    // ValidationPipe is the only source of an array of messages.
    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        code: 'VALIDATION_FAILED',
        message: rawMessage.join('; '),
      };
    }

    return {
      statusCode,
      code: HttpStatus[statusCode] ?? 'ERROR',
      message: rawMessage,
    };
  }
}
