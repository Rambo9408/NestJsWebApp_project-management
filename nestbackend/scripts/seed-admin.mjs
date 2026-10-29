/**
 * =============================================================================
 * seed-admin — create (or promote) a global ADMIN
 * =============================================================================
 * WHY A SCRIPT AND NOT A `db.users.insertOne(...)`:
 *
 * The password must be hashed exactly the way `AuthService` hashes it, or the
 * user can never log in. Writing a document by hand means either reimplementing
 * the hashing (and getting the cost factor or the algorithm subtly wrong) or
 * inserting a plaintext password that silently fails every login attempt.
 *
 * So this REGISTERS THROUGH THE REAL API first, letting the application own the
 * hashing, and only then touches the database — for the one thing the API
 * deliberately refuses to do.
 *
 * WHY THE DIRECT DB WRITE IS UNAVOIDABLE:
 *
 *   - `POST /auth/register` FORCES `role: MEMBER`. The public DTO is
 *     `OmitType(CreateUserDto, ['role'])` precisely so nobody can POST
 *     `{"role":"admin"}` and grant themselves administrator — a mass-assignment
 *     guard, and a good one.
 *   - `PUT /users/:id/role` is itself `@Roles(Role.ADMIN)`.
 *
 * So there is deliberately NO API PATH to the first admin. That is correct
 * design, and it means bootstrapping one is an operator action, out of band.
 * Every real system has this problem; most solve it with exactly this kind of
 * script.
 *
 * -----------------------------------------------------------------------------
 * USAGE
 * -----------------------------------------------------------------------------
 *   ADMIN_EMAIL=you@example.com \
 *   ADMIN_NAME="Your Name" \
 *   ADMIN_PASSWORD='...' \
 *   node scripts/seed-admin.mjs
 *
 * The backend must be running (it does the hashing) and MongoDB reachable.
 *
 * !! CREDENTIALS COME FROM THE ENVIRONMENT, NEVER FROM THIS FILE !!
 * A password committed to a repository is a password that has leaked — it is in
 * the history forever, visible to everyone with read access, and it will be
 * copied into a real deployment by someone in a hurry.
 * =============================================================================
 */
import { MongoClient } from 'mongodb';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/taskflow?directConnection=true';

const email = process.env.ADMIN_EMAIL;
const name = process.env.ADMIN_NAME;
const password = process.env.ADMIN_PASSWORD;

if (!email || !name || !password) {
  console.error('Missing ADMIN_EMAIL, ADMIN_NAME or ADMIN_PASSWORD.');
  console.error("Usage: ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD='...' node scripts/seed-admin.mjs");
  process.exit(1);
}

/** Never print the password — this is what goes in the log instead. */
const redacted = `${password.slice(0, 1)}${'*'.repeat(Math.max(0, password.length - 2))}${password.slice(-1)}`;

console.log(`Seeding admin: ${email} (${name}), password ${redacted}`);

/* --- 1. register through the API, so the app owns the hashing ------------ */

const response = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, name, password }),
});

if (response.status === 201) {
  console.log('  registered via POST /auth/register');
} else if (response.status === 409) {
  /**
   * IDEMPOTENT BY DESIGN. Re-running must not fail — a seed script that only
   * works on an empty database is a seed script nobody trusts to run twice.
   *
   * 409 means the email is taken, which for our purposes is success: the user
   * exists, and the promotion below still applies.
   */
  console.log('  already registered (409) — will promote the existing user');
} else {
  const body = await response.text();
  console.error(`  registration failed: ${String(response.status)} ${body}`);
  process.exit(1);
}

/* --- 2. promote to ADMIN, which the API deliberately cannot do ----------- */

const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();

try {
  const users = mongo.db().collection('users');

  /**
   * MATCH ON THE NORMALISED EMAIL. The backend's `@TrimLower()` transform
   * lowercases on the way in, so a mixed-case argument here would match nothing
   * and the script would report success having promoted no one.
   */
  const result = await users.updateOne(
    { email: email.trim().toLowerCase() },
    { $set: { role: 'admin' } },
  );

  if (result.matchedCount === 0) {
    console.error('  promotion failed: no user with that email');
    process.exit(1);
  }

  const user = await users.findOne(
    { email: email.trim().toLowerCase() },
    // NEVER select the hash. There is no reason for it to be in a log, and a
    // projection is cheaper than remembering not to print it.
    { projection: { passwordHash: 0 } },
  );

  console.log(`  promoted to ${String(user?.role)}`);
  console.log(`  id: ${String(user?._id)}`);
  console.log('');
  console.log('Done. Sign in at http://localhost:5173/login');
  console.log('NOTE: the JWT carries the role, so any token issued BEFORE this');
  console.log('      promotion still says "member" — sign in again to get it.');
} finally {
  await mongo.close();
}
