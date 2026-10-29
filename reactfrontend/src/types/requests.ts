import type { components } from './openapi.generated';

/**
 * =============================================================================
 * REQUEST TYPES - GENERATED FROM THE BACKEND'S OpenAPI DOCUMENT
 * =============================================================================
 * These are not written by hand. They come from `npm run api:types`, which
 * fetches /api/docs-json from the running backend and runs openapi-typescript
 * over it.
 *
 * THIS CLOSES HALF OF THE DRIFT PROBLEM NAMED IN PHASE 6. Change a DTO on the
 * backend, regenerate, and every call site that sends the wrong shape becomes a
 * compile error. No review discipline required.
 *
 * -----------------------------------------------------------------------------
 * !! ONLY HALF. HERE IS THE OTHER HALF, STATED PLAINLY !!
 * -----------------------------------------------------------------------------
 * The document contains 16 schemas and every one of them is a REQUEST DTO.
 * There are no response schemas at all:
 *
 *     GET  /api/v1/tasks     ->  200: ""                (no schema)
 *     POST /api/v1/auth/login ->  200: "Authenticated"  (a description)
 *     GET  /api/v1/auth/me    ->  200: { type: object } (untyped object)
 *
 * WHY: the @nestjs/swagger CLI plugin builds schemas from DTO CLASSES by
 * reading their decorators. The controllers return plain TypeScript types -
 * `Promise<Paginated<TaskWithAssignee>>`, `Promise<PublicUser>` - and an
 * interface leaves nothing behind at runtime for the plugin to inspect. So
 * request bodies are documented and responses are not.
 *
 * CONSEQUENCE: response types in `api.ts` remain HAND-WRITTEN and verified
 * against the live wire (Phase 1 caught two real mistakes that way). They are
 * still an assertion, not a guarantee.
 *
 * THE BACKEND FIX, which is the right thing to propose in a code review:
 * annotate the controllers with `@ApiOkResponse({ type: TaskResponseDto })`
 * and make the response shapes classes with `@ApiProperty`. Then the document
 * describes both directions, generation covers everything, and the hand-written
 * half of api.ts can be deleted.
 *
 * INTERVIEW: "how do you keep frontend and backend types in sync?" - generate
 * from a schema and fail CI on drift. Being able to say WHICH PART of your own
 * contract is generated and which is asserted, and why, is a much stronger
 * answer than claiming it is all handled.
 * =============================================================================
 */

/**
 * A shorthand for reaching into the generated tree. `components['schemas']` is
 * where openapi-typescript puts every named schema, and this alias keeps the
 * exports below readable.
 */
type Schemas = components['schemas'];

/* --- auth ---------------------------------------------------------------- */

/**
 * `RegisterDto` on the backend is `OmitType(CreateUserDto, ['role'])`, and the
 * generated type reflects that: it has email, name and password, and NO role.
 *
 * That omission is the mass-assignment guard. If someone ever added `role` back
 * to the public registration DTO, this generated type would grow the field and
 * the change would be visible in a diff of a checked-in file - which is a much
 * better early-warning system than hoping a reviewer notices.
 */
export type RegisterRequest = Schemas['RegisterDto'];
export type LoginRequest = Schemas['LoginDto'];
export type ChangePasswordRequest = Schemas['ChangePasswordDto'];
export type UpdateMeRequest = Schemas['UpdateMeDto'];

/* --- tasks --------------------------------------------------------------- */

/**
 * Note what generation gave us for free here, none of which was hand-written:
 *   - `priority?: 'low' | 'medium' | 'high' | 'urgent'` as a literal union,
 *     straight from the backend's `@IsEnum(TaskPriority)`
 *   - `assigneeId?: string | null` - the null preserved, so "unassign" stays
 *     distinguishable from "not provided"
 *   - the backend's own explanatory comments, carried through as JSDoc and
 *     visible on hover in the editor
 */
export type CreateTaskRequest = Schemas['CreateTaskDto'];
export type UpdateTaskRequest = Schemas['UpdateTaskDto'];
export type ChangeTaskStatusRequest = Schemas['ChangeTaskStatusDto'];
export type AssignTaskRequest = Schemas['AssignTaskDto'];
export type CreateCommentRequest = Schemas['CreateCommentDto'];

/* --- projects ------------------------------------------------------------ */

export type CreateProjectRequest = Schemas['CreateProjectDto'];
export type UpdateProjectRequest = Schemas['UpdateProjectDto'];
export type AddProjectMemberRequest = Schemas['AddProjectMemberDto'];

/* --- users --------------------------------------------------------------- */

export type CreateUserRequest = Schemas['CreateUserDto'];
export type UpdateUserRequest = Schemas['UpdateUserDto'];
export type SetUserRoleRequest = Schemas['SetUserRoleDto'];
