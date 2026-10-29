import { Test, TestingModule } from '@nestjs/testing';

import { AppService } from './app.service';
import { APP_METADATA } from './common/constants';
import { AppMetadata } from './common/providers/app-metadata.provider';
import { AppConfigService } from './config';

/**
 * =============================================================================
 * The payoff of dependency injection, demonstrated in 30 lines.
 * =============================================================================
 * Full testing strategy is Phase 14. This single spec exists in Phase 1 for one
 * reason: to make the argument for DI concrete rather than theoretical.
 *
 * AppService depends on AppConfigService, which depends on ConfigService, which
 * reads and validates the whole environment. To unit-test AppService in an
 * Express-style codebase where config is `require()`d, you would have to either
 * set up the entire environment or reach for `jest.mock()` and hope no other
 * module imported the real one first.
 *
 * Here we simply hand the container a different object for that token. No
 * environment, no .env file, no mocking library.
 *
 * NOTE what is really happening in `providers` below: `{ provide, useValue }`
 * is a CUSTOM PROVIDER - the exact mechanism Phase 3 covers. `provide` is the
 * TOKEN (here, the class object used purely as a lookup key) and `useValue` is
 * the RECIPE. Nest never constructs the real AppConfigService, because nothing
 * asked it to build the token - it was given an instance instead.
 *
 * This is also the cleanest illustration of why token and implementation are
 * two different ideas: the token stayed the same, the implementation changed.
 * =============================================================================
 */
describe('AppService', () => {
  let service: AppService;

  /**
   * `Test.createTestingModule()` builds a real Nest DI container from a module
   * definition - the same resolution algorithm the application uses, so this
   * test would also catch a genuine wiring mistake.
   *
   * That is the difference between a Nest unit test and hand-constructing
   * `new AppService(fake)`: both work, but the testing module also verifies
   * that the graph is resolvable.
   */
  beforeEach(async () => {
    const mockConfig = {
      app: {
        nodeEnv: 'test' as const,
        port: 3001,
        name: 'taskflow-api-test',
        apiPrefix: 'api',
        corsOrigins: ['*'],
        logLevel: 'silent' as const,
        swaggerEnabled: false,
      },
    };

    const stubMetadata: AppMetadata = {
      name: 'taskflow-api',
      version: '9.9.9',
      commit: 'deadbeef',
      builtAt: '2026-01-01T00:00:00.000Z',
      nodeVersion: process.version,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: AppConfigService, useValue: mockConfig },
        // A string-token `useValue` stub. Note how little ceremony this needs
        // compared with mocking a module-level `process.env` read.
        { provide: APP_METADATA, useValue: stubMetadata },
      ],
    }).compile();

    service = moduleRef.get(AppService);
  });

  it('resolves through the DI container', () => {
    expect(service).toBeInstanceOf(AppService);
  });

  it('reports the injected application metadata', () => {
    const info = service.getAppInfo();

    expect(info.name).toBe('taskflow-api-test');
    expect(info.environment).toBe('test');
    expect(info.version).toBe('9.9.9');
    expect(info.commit).toBe('deadbeef');
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // ISO-8601, e.g. 2026-01-01T00:00:00.000Z
    expect(Date.parse(info.timestamp)).not.toBeNaN();
  });
});
