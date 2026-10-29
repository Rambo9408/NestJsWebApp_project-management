import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { AppConfigService } from 'src/config';

import { PasswordHasher } from './password-hasher.interface';

/**
 * =============================================================================
 * The DEFAULT implementation of the PasswordHasher port.
 * =============================================================================
 * Registered in `users.module.ts` as:
 *
 *     { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
 *
 * -----------------------------------------------------------------------------
 * WHY bcryptjs HERE, AND WHY IT IS NOT THE PRODUCTION ANSWER
 * -----------------------------------------------------------------------------
 * `bcryptjs` is pure JavaScript: no native build step, so it installs on any
 * machine - which is why a learning repo uses it. It is meaningfully SLOWER
 * than native `bcrypt`, and slow hashing on the main thread is an availability
 * problem, not just an inconvenience.
 *
 * Ranked for production:
 *   1. argon2id (`argon2`) - current OWASP recommendation. Memory-hard, so
 *      GPU/ASIC cracking is far more expensive than with bcrypt.
 *   2. native `bcrypt` - still perfectly acceptable and battle-tested.
 *   3. scrypt - also memory-hard, and built into Node (see the sibling file).
 *   4. bcryptjs - development and low volume.
 * Never: MD5, SHA-1, SHA-256 or any fast hash. Fast is the opposite of the goal.
 *
 * THE COST FACTOR IS AN AVAILABILITY DECISION.
 * Hashing is CPU-bound and Node runs your JavaScript on ONE thread. Cost 12 is
 * roughly 250ms; 40 concurrent logins is 10 seconds of blocked event loop, and
 * every unrelated request queues behind it. The senior answer names three
 * mitigations:
 *   - always use the ASYNC api (native bcrypt offloads to libuv's threadpool,
 *     sized by UV_THREADPOOL_SIZE); never `hashSync` in a request path;
 *   - rate-limit auth endpoints hard (Phase 10) - login is the one route where
 *     an attacker chooses how much CPU you burn;
 *   - at high volume, move hashing out of the API process entirely.
 * NOTE the honest caveat: bcryptJS is pure JS, so its "async" API still runs on
 * the main thread in chunks. That is another reason the native library wins in
 * production, and a good detail to know.
 * =============================================================================
 */
@Injectable()
export class BcryptPasswordHasher implements PasswordHasher, OnModuleInit {
  private readonly logger = new Logger(BcryptPasswordHasher.name);

  /**
   * Work factor. Each +1 DOUBLES the time to hash.
   *
   * Lower in tests, because a suite that runs 50 registrations at cost 12 spends
   * 12 seconds hashing and tests nothing. This behaviour switch is only possible
   * because the value is injected rather than hard-coded - a small but concrete
   * example of what DI buys.
   */
  private readonly rounds: number;

  readonly algorithm: string;

  constructor(private readonly config: AppConfigService) {
    this.rounds = this.config.isTest ? 4 : 12;
    this.algorithm = `bcrypt(${this.rounds})`;
  }

  /**
   * PROVIDER LIFECYCLE HOOK. Nest calls hooks in a defined order:
   *
   *   onModuleInit           - once per module, after its providers exist
   *   onApplicationBootstrap - once, after EVERY module is initialised
   *   onModuleDestroy        - on shutdown, before connections close
   *   beforeApplicationShutdown / onApplicationShutdown - final cleanup
   *
   * Use `onModuleInit` for work needing only this module's dependencies;
   * `onApplicationBootstrap` when other modules must already be ready. Never do
   * I/O in a constructor: it cannot be async, it runs mid-graph-construction,
   * and failures produce far worse errors.
   */
  onModuleInit(): void {
    this.logger.debug(`Password hashing configured: ${this.algorithm}`);
  }

  /**
   * `bcrypt.hash` generates a random salt and embeds it in the output, which is
   * why there is no separate salt column - the hash carries its own algorithm,
   * cost and salt:
   *
   *     $2b$12$<22-char salt><31-char hash>
   *      |   |
   *      |   cost factor
   *      algorithm
   *
   * That self-describing format is what makes cost upgrades possible: on a
   * successful login you can detect a stored cost below your current target and
   * transparently re-hash the (just verified) plaintext.
   */
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.rounds);
  }

  /**
   * WHY NOT `hash(candidate) === stored`? The salt is random, so re-hashing
   * produces a different string; and `===` on secrets leaks timing information.
   * `bcrypt.compare` extracts salt and cost from the stored hash and compares in
   * constant time.
   */
  compare(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
