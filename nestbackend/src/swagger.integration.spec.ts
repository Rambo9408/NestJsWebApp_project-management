import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { sharedUri } from '../test/shared-mongo';

/**
 * =============================================================================
 * Testing the OpenAPI document itself
 * =============================================================================
 * An underused technique, and the reason it is worth doing: the document is a
 * CONTRACT, and a contract that nothing checks drifts. Two things in particular
 * are worth asserting, because both fail silently:
 *
 *   1. The documented PATHS match the real ones. Setting Swagger up before the
 *      global prefix and versioning publishes a document describing routes that
 *      do not exist - and nobody notices until a client is generated from it.
 *   2. Endpoints that should require authentication actually declare that they
 *      do. A missing `@ApiBearerAuth` is invisible in code review and produces
 *      a generated client that never sends a token.
 *
 * In a real project the strongest version of this is to COMMIT the JSON
 * document and diff it in CI - an unintended breaking change then shows up as a
 * reviewable diff rather than as a support ticket.
 * =============================================================================
 */
describe('OpenAPI document (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_swagger_test');
    // The document is only built when this is on - see the note in swagger.ts
    // about why serving it in production is a decision rather than a default.
    process.env.SWAGGER_ENABLED = 'true';

    const { AppModule } = await import('./app.module');
    const { setupSwagger } = await import('./swagger');
    const { AppConfigService } = await import('./config');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    // AFTER the prefix and versioning, exactly as in main.ts.
    setupSwagger(app, app.get(AppConfigService));
    await app.init();
  }, 180_000);

  afterAll(async () => {
    delete process.env.SWAGGER_ENABLED;
    await app?.close();
  }, 60_000);

  it('serves a JSON document', async () => {
    const response = await request(http()).get('/api/docs-json').expect(200);

    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.info.title).toBe('TaskFlow API');
  });

  it('documents the REAL paths, including prefix and version', async () => {
    const response = await request(http()).get('/api/docs-json').expect(200);
    const paths = Object.keys(response.body.paths as Record<string, unknown>);

    // If Swagger were set up before `setGlobalPrefix`/`enableVersioning`, these
    // would be `/users` and `/auth/login` - a document describing routes that
    // do not exist.
    expect(paths).toContain('/api/v1/users');
    expect(paths).toContain('/api/v1/auth/login');
    expect(paths).toContain('/api/v1/tasks/{id}');
  });

  it('declares the bearer security scheme', async () => {
    const response = await request(http()).get('/api/docs-json').expect(200);

    expect(response.body.components.securitySchemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('marks protected endpoints as requiring the token', async () => {
    const response = await request(http()).get('/api/docs-json').expect(200);

    const listUsers = response.body.paths['/api/v1/users'].get as {
      security?: Array<Record<string, unknown>>;
    };

    // The scheme NAME must match `addBearerAuth(..., 'access-token')`. A
    // mismatch is a silent failure: the Authorize button appears and the token
    // is simply never attached.
    expect(listUsers.security?.[0]).toHaveProperty('access-token');
  });

  it('registers DTO schemas - and reveals that the CLI plugin is BUILD-TIME only', async () => {
    const response = await request(http()).get('/api/docs-json').expect(200);
    const schemas = response.body.components.schemas as Record<string, { properties: object }>;

    // The schema entry exists, because the controller references the DTO type.
    expect(schemas.CreateUserDto).toBeDefined();

    /**
     * A FINDING WORTH KEEPING, discovered by writing this test.
     *
     * Under ts-jest the DTO has NO PROPERTIES. The Swagger CLI plugin (enabled
     * in `nest-cli.json`) is an AST transform that runs during `nest build` -
     * it rewrites the TypeScript to inject `@ApiProperty` before compilation.
     * Jest compiles the sources itself and never runs it.
     *
     * (Wiring the plugin into ts-jest via `astTransformers` is the documented
     * workaround, and it does not work with ts-jest 29: the plugin's entry
     * point does not expose the `factory`/`version`/`name` shape ts-jest
     * expects, and the run fails with
     * `beforeTransformer.factory is not a function`.)
     *
     * THE PRACTICAL CONSEQUENCES, which is why this is documented rather than
     * quietly deleted:
     *   1. The document you SHIP is the one produced by `nest build`, not the
     *      one produced under test. Generate the JSON from the BUILT artefact
     *      in CI, never from a test run.
     *   2. A test can safely assert PATHS, TAGS and SECURITY - all of which come
     *      from decorators the compiler keeps - but not inferred DTO properties.
     *   3. If DTO schemas genuinely matter to a contract test, write explicit
     *      `@ApiProperty()` decorators on those DTOs rather than relying on the
     *      plugin for them.
     */
    expect(Object.keys(schemas.CreateUserDto.properties)).toEqual([]);
  });

  it('serves the interactive UI', async () => {
    await request(http()).get('/api/docs').expect(200);
  });
});
