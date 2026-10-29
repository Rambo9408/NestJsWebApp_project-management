import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';

import { RequestContextService } from '../context/request-context.service';
import { LoggingInterceptor } from './logging.interceptor';

/**
 * =============================================================================
 * UNIT-TESTING AN INTERCEPTOR
 * =============================================================================
 * Same technique as the guard spec: a fake `ExecutionContext` plus a fake
 * `CallHandler` whose `handle()` returns whatever Observable the test wants.
 *
 * `of(value)` simulates a successful handler; `throwError(() => e)` simulates a
 * failing one. Being able to drive both is what makes the interesting
 * assertions possible - the one below about failed requests still being logged
 * is a real bug this catches.
 * =============================================================================
 */
describe('LoggingInterceptor', () => {
  const requestContext = { requestId: 'req-123' } as unknown as RequestContextService;

  const contextFor = (statusCode = 200, type: 'http' | 'ws' = 'http'): ExecutionContext =>
    ({
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/api/v1/tasks',
          user: { id: 'u1' },
        }),
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  const handlerReturning = (observable: Observable<unknown>): CallHandler =>
    ({ handle: () => observable }) as CallHandler;

  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs a successful request at LOG level, with the correlation id', async () => {
    const interceptor = new LoggingInterceptor(requestContext);

    await firstValueFrom(
      interceptor.intercept(contextFor(200), handlerReturning(of({ ok: true }))),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;

    expect(line).toContain('GET /api/v1/tasks 200');
    expect(line).toContain('req=req-123');
    // The user ID, not the email - emails are personal data and end up in log
    // aggregators, backups and third-party tools.
    expect(line).toContain('user=u1');
  });

  it('logs a 4xx at WARN, not ERROR', async () => {
    /**
     * Logging client errors as errors is the fastest way to make an error
     * dashboard meaningless - a bot probing for /wp-admin should not look like
     * an outage.
     */
    const interceptor = new LoggingInterceptor(requestContext);

    await firstValueFrom(interceptor.intercept(contextFor(404), handlerReturning(of(null))));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs a 5xx at ERROR', async () => {
    const interceptor = new LoggingInterceptor(requestContext);

    await firstValueFrom(interceptor.intercept(contextFor(500), handlerReturning(of(null))));

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('STILL LOGS when the handler throws', async () => {
    /**
     * The classic mistake is `tap(() => log(...))` with only a success handler:
     * failed requests then produce no timing line at all - and errors are
     * exactly the requests whose duration you want.
     */
    const interceptor = new LoggingInterceptor(requestContext);
    const failure = Object.assign(new Error('boom'), { status: 503 });

    await expect(
      firstValueFrom(
        interceptor.intercept(contextFor(200), handlerReturning(throwError(() => failure))),
      ),
    ).rejects.toThrow('boom');

    // Logged as 503 (read from the error), not as the response's default 200.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('503');
  });

  it('RE-THROWS the original error, unchanged', async () => {
    // An interceptor that swallows or rewrites an error is how a 404 reaches a
    // client as a 500 - or worse, as a 200 with an empty body.
    const interceptor = new LoggingInterceptor(requestContext);
    const original = new Error('original');

    await expect(
      firstValueFrom(
        interceptor.intercept(contextFor(200), handlerReturning(throwError(() => original))),
      ),
    ).rejects.toBe(original);
  });

  it('does nothing for a NON-HTTP context', async () => {
    /**
     * Interceptors run for WebSocket and RPC contexts too, where
     * `switchToHttp().getRequest()` returns something meaningless. Forgetting
     * the `getType()` check is a common source of "why is my interceptor
     * crashing on WebSocket frames?".
     */
    const interceptor = new LoggingInterceptor(requestContext);

    await firstValueFrom(
      interceptor.intercept(contextFor(200, 'ws'), handlerReturning(of('ws payload'))),
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});
