import { AppConfigService } from 'src/config';

import { BcryptPasswordHasher } from './bcrypt-password-hasher';
import { PasswordHasher } from './password-hasher.interface';
import { ScryptPasswordHasher } from './scrypt-password-hasher';

/**
 * =============================================================================
 * A CONTRACT TEST
 * =============================================================================
 * One suite, run against EVERY implementation of the port. It asserts the
 * behaviour that `UsersService` relies on, and nothing about how it is achieved.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: the risk in swapping an implementation
 * behind a token is that the new one satisfies the TYPE but not the CONTRACT -
 * it compiles, and it is subtly wrong. A fake that returns `null` where the real
 * one throws is the classic case: green suite, broken application.
 *
 * A contract test is the cheap defence. Add a third implementation (argon2) and
 * you get its coverage by adding one line to the array below - and if it fails,
 * it fails BEFORE you change the one line in `users.module.ts`.
 *
 * `describe.each` is the Jest feature that makes this idiomatic.
 * =============================================================================
 */

// BcryptPasswordHasher injects AppConfigService; we only need `isTest` so the
// cost factor drops to 4 and this suite finishes in milliseconds rather than
// seconds. Constructing it directly (rather than through a TestingModule) is
// fine here: we are testing the CLASS, not its wiring.
const testConfig = { isTest: true } as AppConfigService;

const implementations: Array<[string, () => PasswordHasher]> = [
  ['BcryptPasswordHasher', () => new BcryptPasswordHasher(testConfig)],
  ['ScryptPasswordHasher', () => new ScryptPasswordHasher()],
];

describe.each(implementations)('PasswordHasher contract: %s', (_name, create) => {
  let hasher: PasswordHasher;

  beforeEach(() => {
    hasher = create();
  });

  it('exposes an algorithm label', () => {
    expect(hasher.algorithm).toEqual(expect.any(String));
    expect(hasher.algorithm.length).toBeGreaterThan(0);
  });

  it('never returns the plaintext', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).not.toContain('correct horse');
  });

  it('produces a DIFFERENT hash for the same password each time (random salt)', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same-password'),
      hasher.hash('same-password'),
    ]);

    // If these were equal, the implementation would not be salting - and equal
    // hashes across users would make a rainbow-table attack viable again.
    expect(first).not.toBe(second);
  });

  it('verifies a correct password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.compare('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.compare('wrong password', hash)).resolves.toBe(false);
  });

  it('returns false - never throws - for a hash from a different algorithm', async () => {
    // During a real migration this method WILL be handed foreign hashes.
    // Throwing would turn "this user is on the old algorithm" into a 500.
    await expect(hasher.compare('anything', 'not-a-valid-hash')).resolves.toBe(false);
  });
});
