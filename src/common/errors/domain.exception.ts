import { HttpException } from '@nestjs/common';

/** An HTTP error with a stable machine-readable code for the frontend. */
export class DomainException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}
