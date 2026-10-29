import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_METADATA } from './common/constants';
import { AppMetadata } from './common/providers/app-metadata.provider';
import { AppConfigService } from './config';

/**
 * A tiny read-only service whose real job in Phase 1 is to be a WORKING,
 * end-to-end demonstration of dependency injection:
 *
 *     AppController  --needs-->  AppService  --needs-->  AppConfigService
 *                                                   --needs--> ConfigService
 *
 * Nest resolves that chain from the leaf inwards. Trace it once and the whole
 * container stops being magic.
 */
export interface AppInfo {
  name: string;
  environment: string;
  version: string;
  commit: string;
  builtAt: string;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class AppService {
  /**
   * `Logger` is Nest's built-in logger. Passing the class name as the context
   * makes every line render as `[AppService] message`, which is what lets you
   * grep a production log for one component.
   *
   * Note this one is created with `new`, NOT injected. That is deliberate and
   * idiomatic: Logger holds no state worth sharing and no dependencies worth
   * inverting, so pushing it through the container would be ceremony without
   * benefit. Nest DOES let you inject it (`@Inject(Logger)`) when you want a
   * custom global logger implementation - we do exactly that in Phase 18 when
   * we swap in pino for structured JSON logs.
   *
   * INTERVIEW ANGLE: "Should everything go through DI?" No. Inject things that
   * (a) have dependencies of their own, (b) hold shared state or connections,
   * or (c) you want to replace in tests. A pure function or a stateless
   * formatter does not need the container.
   */
  private readonly logger = new Logger(AppService.name);

  /** Captured once, when the container instantiates this singleton. */
  private readonly startedAt = Date.now();

  /**
   * CONSTRUCTOR INJECTION - what actually happens here, step by step:
   *
   * 1. tsc, because of `emitDecoratorMetadata`, emits alongside this class:
   *        Reflect.metadata('design:paramtypes', [AppConfigService])
   * 2. At bootstrap Nest instantiates AppModule's providers. To build
   *    AppService it reads that metadata and sees it needs an AppConfigService.
   * 3. It looks that token up: first in this module's own providers, then in
   *    the exports of every imported module, then among global modules.
   *    AppConfigModule is @Global() and exports AppConfigService, so it is
   *    found there.
   * 4. AppConfigService itself needs a ConfigService, so Nest resolves that
   *    first (depth-first), instantiating each provider at most once.
   * 5. Finally: `new AppService(theAppConfigServiceInstance)`.
   *
   * If step 3 fails you get the error every Nest developer meets on day one:
   *
   *     Nest can't resolve dependencies of the AppService (?).
   *     Please make sure that the argument AppConfigService at index [0] is
   *     available in the AppModule context.
   *
   * The `?` marks WHICH constructor argument could not be resolved - that is
   * the most useful part of the message and the first thing to read. Phase 4
   * is a full debugging guide for this error.
   */
  constructor(
    private readonly config: AppConfigService,
    /**
     * PHASE 3: a `useValue` provider, injected by string token.
     *
     * `AppMetadata` is an INTERFACE, so - exactly as with `PasswordHasher` and
     * `NotificationChannel` - there is no class token for Nest to look up, and
     * `@Inject(APP_METADATA)` has to supply the runtime key.
     *
     * WHY NOT JUST READ `process.env.GIT_COMMIT` HERE? Because then this class
     * would depend on the environment directly: unmockable without mutating
     * globals, invisible in the constructor signature, and impossible to
     * validate at boot. Injected, it is one line to stub in a test and one
     * place to change how it is produced.
     */
    @Inject(APP_METADATA) private readonly metadata: AppMetadata,
  ) {
    this.logger.log(
      `Booted in "${this.config.app.nodeEnv}" mode (v${this.metadata.version}, commit ${this.metadata.commit})`,
    );
  }

  getAppInfo(): AppInfo {
    return {
      name: this.config.app.name,
      environment: this.config.app.nodeEnv,
      version: this.metadata.version,
      // Surfacing the commit is not decoration: during an incident, "which
      // build is actually running?" is one of the first questions, and a
      // deployment that silently did not roll out is a very common answer.
      commit: this.metadata.commit,
      builtAt: this.metadata.builtAt,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
