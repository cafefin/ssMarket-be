import {
  type ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DomainException } from '../errors/domain.exception.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function hostFor(url: string) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  const logError = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);

  beforeEach(() => {
    logError.mockClear();
  });

  it('formats an HttpException with a stable code', () => {
    const { host, status, json } = hostFor('/users/me');

    filter.catch(new NotFoundException('User not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'User not found',
      timestamp: expect.any(String),
      path: '/users/me',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('uses the code carried by a DomainException', () => {
    const { host, status, json } = hostFor('/listings');

    filter.catch(
      new DomainException(422, 'BANK_PROFILE_REQUIRED', 'Add bank details'),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        code: 'BANK_PROFILE_REQUIRED',
        message: 'Add bank details',
      }),
    );
  });

  it('reports validation errors as VALIDATION_FAILED with joined messages', () => {
    const { host, json } = hostFor('/items');

    filter.catch(
      new BadRequestException({
        message: ['title must be a string', 'price must be positive'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'title must be a string; price must be positive',
      }),
    );
  });

  it('hides the details of unexpected errors and logs them', () => {
    const { host, status, json } = hostFor('/boom');

    filter.catch(new Error('connection string leaked'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('logs non-Error values thrown by code', () => {
    const { host } = hostFor('/boom');

    filter.catch('a thrown string', host);

    expect(logError).toHaveBeenCalledWith('a thrown string');
  });
});
