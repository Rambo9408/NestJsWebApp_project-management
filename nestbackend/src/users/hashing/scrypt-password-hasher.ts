import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { PasswordHasher } from './password-hasher.interface';

/**
 * `crypto.scrypt` is callback-based; `promisify` gives us the async/await form.
 * The cast is needed because the overloaded Node typings do not narrow through
 * `promisify` on their own - one of the few places an assertion is honest.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * =============================================================================
 * A SECOND, REAL implementation of the same port - the point of `useClass`
 * =============================================================================
 * This is not a mock. scrypt (RFC 7914) is a legitimate, memory-hard key
 * derivation function, and it ships inside Node - no dependency at all.
 *
 * TO SWAP THE ENTIRE APPLICATION ONTO IT, change ONE line in `users.module.ts`:
 *
 *     { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
 *     { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher }   // that is it
 *
 * `UsersService` does not change. Its tests do not change. Nothing that injects
 * PASSWORD_HASHER changes. THAT is what `useClass` is for, and it is the
 * cleanest one-line demonstration of dependency inversion in this repository.
 *
 * -----------------------------------------------------------------------------
 * WHAT `useClass` ACTUALLY DOES
 * -----------------------------------------------------------------------------
 *     { provide: TOKEN, useClass: SomeClass }
 *
 * "When someone asks for TOKEN, instantiate SomeClass (resolving ITS
 * constructor dependencies first) and give them that instance."
 *
 * Two things to be precise about, both of which are interview material:
 *
 *   1. THE CLASS STILL NEEDS `@Injectable()` if it has constructor
 *      dependencies, because that is what makes tsc emit `design:paramtypes`.
 *      `BcryptPasswordHasher` injects `AppConfigService`, so it must be
 *      decorated. This one takes no dependencies, and is decorated anyway - out
 *      of habit, and so that adding a dependency later does not break it.
 *
 *   2. `useClass` CREATES AN INSTANCE FOR THAT TOKEN. If the same class is ALSO
 *      registered directly (`providers: [X, { provide: TOKEN, useClass: X }]`)
 *      you get TWO independent instances of X - two sets of state, two
 *      connections. When you want the token to be an ALIAS for an existing
 *      instance, `useExisting` is the correct recipe. We demonstrate exactly
 *      that difference, with a test, in `src/notifications/`.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS ALSO A REAL MIGRATION STORY
 * -----------------------------------------------------------------------------
 * You cannot re-hash existing passwords in bulk - you do not have the
 * plaintexts. A real algorithm migration is therefore gradual: keep verifying
 * old hashes with the old algorithm, and re-hash with the new one at the moment
 * of a successful login (where the plaintext is briefly available). The
 * self-describing prefix (`$2b$` vs `scrypt$`) is what lets you tell them apart.
 * A production `PasswordHasher` would therefore usually be a small facade that
 * delegates by prefix - which is itself a fourth implementation of this same
 * interface, composed from the other two. Composition over configuration.
 * =============================================================================
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  /** 64-byte derived key, 16-byte salt - both comfortably above the minimums. */
  private static readonly KEY_LENGTH = 64;
  private static readonly SALT_LENGTH = 16;

  readonly algorithm = 'scrypt(N=16384,r=8,p=1)';

  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(ScryptPasswordHasher.SALT_LENGTH);
    const derived = await scryptAsync(plaintext, salt, ScryptPasswordHasher.KEY_LENGTH);

    // Self-describing, like bcrypt's `$2b$12$...`: the prefix tells a future
    // reader (and a migration facade) which algorithm produced this string.
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async compare(plaintext: string, hash: string): Promise<boolean> {
    const [scheme, saltHex, keyHex] = hash.split('$');
    // Defensive: a hash produced by a different algorithm must return false,
    // not throw. During a migration this method WILL be handed bcrypt hashes.
    if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const derived = await scryptAsync(plaintext, salt, expected.length);

    /**
     * `timingSafeEqual` compares in constant time regardless of where the first
     * difference is. `derived.equals(expected)` short-circuits on the first
     * differing byte, which leaks - measurably, over enough samples - how many
     * leading bytes an attacker guessed correctly.
     *
     * It throws if the lengths differ, so guard first.
     */
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
}
