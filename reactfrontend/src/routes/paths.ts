/**
 * Route paths as constants.
 *
 * WHY NOT JUST WRITE THE STRING: a typo in `navigate('/dashbaord')` is a
 * runtime 404 TypeScript cannot see. Referencing `paths.dashboard` makes it a
 * compile error, and renaming a route becomes one edit instead of a
 * grep-and-pray across the codebase.
 *
 * `as const` freezes the values into literal types rather than widening them to
 * `string`, so they can be used in typed helpers.
 */
export const paths = {
  root: '/',

  // Unauthenticated - rendered by AuthLayout, no app chrome.
  login: '/login',
  register: '/register',

  // The application - rendered by RootLayout.
  dashboard: '/dashboard',
  projects: '/projects',
  projectDetail: '/projects/:projectId',
  tasks: '/tasks',
  taskDetail: '/tasks/:taskId',

  // Admin-only, guarded by RequireRole. The backend restricts these APIs to
  // global admins independently - see UsersController's class-level @Roles.
  admin: '/admin',
  adminUsers: '/admin/users',
  adminActivity: '/admin/activity',

  // Nested under SettingsLayout, which supplies the heading and tabs.
  settings: '/settings',
  settingsProfile: '/settings/profile',
  settingsSecurity: '/settings/security',

  // Learning material. Lazily loaded; deleted when it stops earning its place.
  labConnectivity: '/lab/connectivity',
  labComponents: '/lab/components',
  labState: '/lab/state',
  labHooks: '/lab/hooks',
  labRendering: '/lab/rendering',
  labPerformance: '/lab/performance',
} as const;

/**
 * Builds a concrete URL from a parameterised path.
 *
 * `paths.projectDetail` is the PATTERN '/projects/:projectId' - correct for
 * route definitions, useless for navigation. This turns it into
 * '/projects/abc123'.
 *
 * TYPESCRIPT: `Record<string, string>` for params is the pragmatic choice. A
 * template-literal type could extract `:projectId` from the pattern and demand
 * exactly that key - genuinely possible in modern TS, and genuinely harder to
 * read. Noted as a senior-level exercise rather than done now, because
 * cleverness in a shared helper is a cost everyone on the team pays.
 */
export function buildPath(pattern: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    pattern,
  );
}
