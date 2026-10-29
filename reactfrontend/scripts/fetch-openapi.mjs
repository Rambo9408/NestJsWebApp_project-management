/**
 * =============================================================================
 * fetch-openapi — download the API's OpenAPI document, and VALIDATE it
 * =============================================================================
 * WHY THIS IS A SCRIPT AND NOT A `curl` ONE-LINER.
 *
 * The npm script used to be:
 *
 *     curl -s http://localhost:3000/api/docs-json -o openapi/openapi.json
 *
 * and that quietly destroyed the checked-in spec. `curl -s -o` writes WHATEVER
 * COMES BACK, including an error body. Running it against an API with Swagger
 * disabled replaced 36 kB of contract with:
 *
 *     {"success":false,"statusCode":404,"message":"Cannot GET /api/docs-json"}
 *
 * Nothing failed. The next `openapi-typescript` run then errored on nonsense
 * input, and had it not, it would have generated types from a 404 body and the
 * whole contract check would have been meaningless.
 *
 * THE GENERAL LESSON: `curl -o` is not a download, it is a redirect of bytes.
 * Any script that writes over a checked-in artefact has to verify what it
 * received FIRST, and write only on success. Write-then-validate is too late -
 * the good file is already gone.
 * =============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.OPENAPI_URL ?? 'http://localhost:3000/api/docs-json';
const out = path.resolve('openapi/openapi.json');

let response;
try {
  response = await fetch(url);
} catch (error) {
  console.error(`Could not reach ${url}`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error('  Is the API running?  npm run dev:api  (from the repo root)');
  process.exit(1);
}

if (!response.ok) {
  console.error(`${url} returned ${String(response.status)}.`);
  if (response.status === 404) {
    // The exact cause of the bug above, named so the next person does not spend
    // twenty minutes on it.
    console.error('  A 404 here usually means SWAGGER_ENABLED=false.');
    console.error('  The compose `api` service sets it to false; the dev server reads .env.');
  }
  process.exit(1);
}

const text = await response.text();

/**
 * VALIDATE BEFORE WRITING. Three checks, cheapest first, each catching a real
 * way this can go wrong:
 *   1. is it JSON at all?          (an HTML error page, a proxy interstitial)
 *   2. is it an OpenAPI document?  (a 200 from the wrong endpoint)
 *   3. does it have any paths?     (Swagger enabled but the app failed to boot
 *                                   its controllers - a document with zero
 *                                   paths would silently delete every type)
 */
let document;
try {
  document = JSON.parse(text);
} catch {
  console.error('Response was not JSON. First 200 characters:');
  console.error(`  ${text.slice(0, 200)}`);
  process.exit(1);
}

if (typeof document.openapi !== 'string') {
  console.error('Response is JSON but not an OpenAPI document (no `openapi` version field).');
  process.exit(1);
}

const pathCount = Object.keys(document.paths ?? {}).length;
if (pathCount === 0) {
  console.error('OpenAPI document contains ZERO paths - refusing to overwrite the spec.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
// Pretty-printed, so a contract change is a READABLE diff in review rather than
// one enormous altered line.
fs.writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);

console.log(
  `Wrote ${path.relative(process.cwd(), out)} — ` +
    `${document.info?.title ?? 'API'} v${String(document.info?.version)}, ` +
    `${String(pathCount)} paths, ` +
    `${String(Object.keys(document.components?.schemas ?? {}).length)} schemas`,
);
