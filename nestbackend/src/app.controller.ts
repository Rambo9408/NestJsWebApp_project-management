import { Controller, Get, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from './auth/decorators/public.decorator';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { AppInfo, AppService } from './app.service';

/**
 * =============================================================================
 * AppController - the root controller
 * =============================================================================
 * WHAT IS A CONTROLLER?
 * The HTTP boundary of the application. Its only responsibilities are:
 *   1. Map a route to a method.
 *   2. Extract and validate input (via pipes - Phase 6).
 *   3. Delegate to a service.
 *   4. Return a value, which Nest serialises to the response body.
 *
 * Everything else - business rules, database access, caching, queueing - lives
 * in providers. WHY? Because a controller is coupled to HTTP, and business
 * logic that lives inside one can only ever be triggered by an HTTP request.
 * The moment the same rule must also run from a queue worker (Phase 12), a
 * WebSocket message (Phase 11) or a CLI script, you have to move it anyway.
 * Keeping controllers thin from day one means you never have to.
 *
 * EXPRESS COMPARISON
 * -----------------------------------------------------------------------------
 *   // Express
 *   const router = express.Router();
 *   router.get('/', (req, res) => res.json(getAppInfo()));
 *   app.use('/api/v1', router);
 *
 *   // Nest
 *   @Controller()            // <- the router
 *   class AppController {
 *     @Get()                 // <- router.get('/')
 *     info() { return this.appService.getAppInfo(); }   // <- the handler
 *   }
 *
 * Three differences worth being able to articulate:
 *   - The route table is DECLARED as metadata, not built by imperative calls.
 *     Nest reads that metadata at bootstrap to build the router, which is also
 *     what makes Swagger generation (Phase 15) possible with no extra work.
 *   - Handlers RETURN values instead of calling `res.json()`. Nest serialises
 *     the return value, and a thrown exception is turned into an HTTP response
 *     by an exception filter (Phase 9). Returning a promise or an Observable
 *     works too - Nest awaits/subscribes for you.
 *   - The handler gets its collaborators injected, so the controller never
 *     constructs a service, and a unit test can pass a fake one.
 *
 * ROUTE PATH: this controller has no path argument, so its base path is the
 * empty string. With the global prefix (`api`) and URI versioning (`v1`) set in
 * main.ts, the final routes are:
 *
 *     GET /api/v1
 *     GET /api/v1/ping
 * =============================================================================
 */
/**
 * PHASE 9: this ONE controller opts into the response envelope, so the pattern
 * is demonstrable without imposing it on the whole API.
 *
 * See transform-response.interceptor.ts for why it is not global: success
 * responses stay plain resources (REST-correct, works with generated clients),
 * while ERRORS are standardised everywhere by AllExceptionsFilter - which is
 * where a consistent shape actually helps, because clients must branch on them.
 */
@ApiTags('health')
@UseInterceptors(TransformResponseInterceptor)
@Controller()
export class AppController {
  /**
   * Same injection mechanics as AppService. Note the controller depends on the
   * SERVICE, never on AppConfigService directly - each layer talks only to the
   * layer beneath it. That is separation of concerns in practice, and it is
   * what makes the service reusable outside HTTP.
   */
  constructor(private readonly appService: AppService) {}

  /**
   * `@Get()` with no argument = the controller's base path.
   *
   * The return value is a plain object. Nest's built-in serialiser turns it
   * into JSON and sets `Content-Type: application/json` - no `res.json()`.
   * Status defaults to 200 for GET and 201 for POST (change it with
   * @HttpCode()).
   */
  /**
   * PHASE 7: @Public() because a service-info endpoint that requires a token is
   * useless to the load balancer and to anyone debugging a deployment. Note it
   * deliberately exposes NOTHING sensitive - see app.service.ts.
   */
  @Public()
  @Get()
  getInfo(): AppInfo {
    return this.appService.getAppInfo();
  }

  /**
   * A liveness probe: "is this process up and able to answer?"
   *
   * `@HttpCode(HttpStatus.OK)` is redundant on a GET (200 is already the
   * default) but it is here to make the decorator visible, and to note the
   * rule: a health endpoint must be CHEAP. It must not touch the database,
   * because a liveness probe that fails when the database is slow will make
   * Kubernetes restart perfectly healthy pods, turning a database blip into an
   * application outage.
   *
   * Phase 18 replaces this with @nestjs/terminus and splits liveness (is the
   * process alive?) from readiness (can it serve traffic right now?) - the
   * distinction that prevents exactly that outage.
   */
  @Public()
  @Get('ping')
  @HttpCode(HttpStatus.OK)
  ping(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
