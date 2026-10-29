import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppConfigService } from './config';

/**
 * =============================================================================
 * OpenAPI / Swagger
 * =============================================================================
 * WHY BOTHER, when the code is right there?
 *
 *   1. IT IS THE CONTRACT. A frontend team, a mobile team and a partner all
 *      need to know the shape of your API without reading your TypeScript. A
 *      document generated FROM the code cannot drift from it - which is the
 *      failure mode of every hand-written API wiki ever created.
 *   2. IT GENERATES CLIENTS. `openapi-generator` turns this into a typed SDK in
 *      a dozen languages. That is also why Phase 9 chose NOT to wrap every
 *      response in an envelope: `GET /users/:id` returning a `User` generates a
 *      client that returns a User.
 *   3. IT IS EXECUTABLE. "Try it out" in the UI is the fastest way for someone
 *      to answer their own question about your API.
 *   4. IT IS A REVIEW SURFACE. Reading the generated document is the quickest
 *      way to spot an endpoint that leaks a field, or one that quietly has no
 *      authentication.
 *
 * HOW MUCH OF THIS IS AUTOMATIC: more than people expect. `nest-cli.json`
 * enables the Swagger CLI PLUGIN, which reads the TypeScript AST at build time
 * and infers `@ApiProperty` for every DTO field - types, optionality, enums,
 * and (with `introspectComments: true`) the JSDoc as the description.
 *
 * So DTOs need almost no Swagger decorators at all. What still has to be
 * written by hand is what the compiler cannot infer: what an endpoint MEANS,
 * which errors it can return, and which security applies.
 * =============================================================================
 */
export function setupSwagger(app: INestApplication, config: AppConfigService): void {
  const logger = new Logger('Swagger');

  /**
   * SERVING DOCS IN PRODUCTION IS A DECISION, not a default.
   *
   * An OpenAPI document is a complete map of your attack surface: every route,
   * every parameter, every field name, every enum value. That is not secret -
   * security through obscurity is not security - but it is a considerable
   * convenience for someone probing you, and there is rarely a reason a public
   * production API needs an interactive explorer.
   *
   * The usual compromises: off in production; or served behind authentication;
   * or published to an internal developer portal instead. `SWAGGER_ENABLED`
   * makes it an explicit, auditable choice rather than an accident.
   */
  if (!config.app.swaggerEnabled) {
    logger.log('Swagger is disabled (SWAGGER_ENABLED=false)');
    return;
  }

  const documentConfig = new DocumentBuilder()
    .setTitle('TaskFlow API')
    .setDescription(
      [
        'A production-style NestJS modular monolith: users, projects, tasks, comments,',
        'notifications, background jobs and real-time delivery.',
        '',
        '**Authentication.** Every endpoint requires a bearer access token unless it is',
        'marked otherwise. Obtain one from `POST /auth/register` or `POST /auth/login`,',
        'then use the **Authorize** button above.',
        '',
        '**Refresh tokens** are delivered as an httpOnly cookie and are not visible to',
        'JavaScript - which is deliberate (see the Phase 7 notes in the repository).',
      ].join('\n'),
    )
    .setVersion('1.0')

    /**
     * `addBearerAuth` declares the security SCHEME; `@ApiBearerAuth()` on a
     * controller says which endpoints USE it.
     *
     * The name (`access-token`) has to match on both sides. Getting it wrong is
     * a silent failure: the Authorize button appears, and the token is simply
     * never attached to requests.
     */
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'The access token returned by /auth/login',
      },
      'access-token',
    )

    /**
     * TAGS group endpoints in the UI. Without them everything lands under
     * "default", which on an API of this size is unusable.
     */
    .addTag('auth', 'Registration, login, token refresh and password changes')
    .addTag('users', 'User administration (admin only)')
    .addTag('projects', 'Projects and their membership')
    .addTag('tasks', 'Tasks and comments')
    .addTag('notifications', 'Notification history and the live SSE stream')
    .addTag('health', 'Liveness and readiness probes')

    .addServer(`http://localhost:${config.app.port}`, 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  SwaggerModule.setup(`${config.app.apiPrefix}/docs`, app, document, {
    /**
     * `persistAuthorization` keeps the token across page reloads. Small quality
     * of life, and the difference between the explorer being usable and being
     * something people give up on after the third re-login.
     */
    swaggerOptions: {
      persistAuthorization: true,
      // Alphabetical, so the same endpoint is in the same place tomorrow.
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'TaskFlow API',
  });

  /**
   * The RAW document, served as JSON.
   *
   * This is the endpoint that matters for tooling: client generators, contract
   * tests, and API gateways consume the JSON, not the HTML. It is also what you
   * would commit to a repository and diff in CI to catch an accidental breaking
   * change - a genuinely underused technique.
   */
  SwaggerModule.setup(`${config.app.apiPrefix}/docs-json`, app, document, {
    jsonDocumentUrl: `${config.app.apiPrefix}/docs-json`,
  });

  logger.log(`Swagger UI available at /${config.app.apiPrefix}/docs`);
}
