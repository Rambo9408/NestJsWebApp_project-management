import { ArgumentsHost, Catch, ExceptionFilter, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * =============================================================================
 * A CONTROLLER-SCOPED FILTER - and the bug that made it necessary
 * =============================================================================
 * THE SYMPTOM, found by writing the health e2e test: `/health/detail` returned
 * 503 with this body -
 *
 *     { "success": false, "statusCode": 503, "message": "Service Unavailable",
 *       "error": "ServiceUnavailableException", "path": "/health/detail" }
 *
 * - and the entire diagnostic payload was gone. Which indicator failed? How
 * slow was it? Unknown. The one endpoint whose whole purpose is to say WHAT is
 * wrong had been reduced to saying THAT something is.
 *
 * THE CAUSE: Terminus signals an unhealthy result by throwing
 * `ServiceUnavailableException` whose response body is the full report. The
 * global `AllExceptionsFilter` (Phase 9) then catches it and rewrites it into
 * the project's standard error envelope - correctly, by its own rules, because
 * a uniform error shape is exactly what it exists to enforce.
 *
 * THE GENERAL LESSON, which is worth more than the fix: **a global enhancer is
 * a policy, and some endpoints have a different contract.** Health checks,
 * webhook receivers that must answer in a provider's format, and file downloads
 * are the usual three. Scoping is how you say so - not by adding an `if` to the
 * global filter, which would make one file responsible for knowing about every
 * exception to its own rule.
 *
 * -----------------------------------------------------------------------------
 * FILTER PRECEDENCE - the rule this depends on
 * -----------------------------------------------------------------------------
 * Nest resolves filters from the most specific scope outwards:
 *
 *     @UseFilters() on the HANDLER  ->  on the CONTROLLER  ->  APP_FILTER (global)
 *
 * The first one whose `@Catch()` matches handles the exception, and the global
 * filter never sees it. So `@Catch(ServiceUnavailableException)` here beats
 * `@Catch()` there - **for this controller only.** Every other 503 in the
 * application still gets the standard envelope.
 *
 * NOTE THE ASYMMETRY WITH THE GLOBAL-REGISTRATION RULE: when two filters are
 * registered at the SAME scope, the LAST registered wins. Across scopes, the
 * MOST SPECIFIC wins. Those are two different rules and mixing them up is a
 * genuinely common source of "my filter never runs".
 * =============================================================================
 */
@Catch(ServiceUnavailableException)
export class HealthCheckExceptionFilter implements ExceptionFilter {
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    /**
     * Pass the Terminus report through UNCHANGED, at its original status.
     *
     * 503 is the right status and is deliberately kept: a monitoring system
     * should see the failure in the status code without parsing the body, and
     * `/health/detail` is not wired to a load balancer precisely so that this
     * 503 does not remove the instance from rotation (see the controller).
     */
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
