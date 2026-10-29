import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { DomainEventBase } from 'src/events/domain-events';

import { ActivityLog, ActivityLogDocument } from './schemas/activity-log.schema';

/** Keys that must never reach an audit record. */
const REDACTED_KEYS = new Set(['password', 'passwordHash', 'token', 'accessToken', 'refreshToken']);

/**
 * =============================================================================
 * ActivityLogListener - ONE class that records everything
 * =============================================================================
 * `EventEmitter2.onAny` subscribes to every domain event.
 *
 * THIS IS THE PAYOFF OF THE EVENT BUS. Without it, every service would need a
 * dependency on the activity log and a line in every method - N places to
 * change and N places to forget. With it, adding an audit trail was one class
 * and zero changes to any existing service.
 *
 * -----------------------------------------------------------------------------
 * WHY NOT `@OnEvent('**')`, which is the obvious choice
 * -----------------------------------------------------------------------------
 * Because it does not give you the event NAME, and this listener's whole job is
 * to record it. The decorator passes the emitted VALUES to the handler; there
 * is no parameter that receives the matched name.
 *
 * That produced a real bug - every audit row stored `event: "unknown"` - and it
 * is documented in full on `onModuleInit` below, because the way it hid is more
 * instructive than the fix.
 *
 * (If you do use the decorator with wildcards: `delimiter: '.'` means a single
 * `*` matches ONE segment and `**` matches any depth. `@OnEvent('*')` here
 * would silently match nothing - no error, no events, and the listener looks
 * correct.)
 *
 * -----------------------------------------------------------------------------
 * WHY THIS LISTENER MUST NEVER THROW
 * -----------------------------------------------------------------------------
 * Most events here are emitted with `emit()` (fire and forget), where a throw
 * becomes an unhandled rejection. But `user.deletion_requested` uses
 * `emitAsync`, and a throw there would ABORT THE DELETE - so a failure to write
 * an audit row would block a user action.
 *
 * That asymmetry is the trap: the same listener is reached from both a
 * fire-and-forget path and an awaited one. Swallowing here is therefore not
 * laziness - it is the only behaviour that is correct on both paths.
 *
 * THE COUNTER-ARGUMENT, and it is a real one: if the audit log is a COMPLIANCE
 * requirement, silently losing entries is worse than failing the operation. In
 * that case the write belongs in the same transaction as the state change (or
 * in a transactional outbox), not in a listener at all. Know which kind of log
 * you have.
 * =============================================================================
 */
@Injectable()
export class ActivityLogListener implements OnModuleInit {
  private readonly logger = new Logger(ActivityLogListener.name);

  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLogDocument>,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * ===========================================================================
   * `onAny`, NOT `@OnEvent('**')` - and this was a REAL BUG, found in the data
   * ===========================================================================
   * THE BUG: every one of the 25 activity records in the development database
   * had `event: "unknown"`. The audit trail recorded WHO and WHEN and never
   * WHAT - which is most of the point of an audit trail.
   *
   * THE OLD CODE was:
   *
   *     @OnEvent('**')
   *     async onAnyDomainEvent(payload: DomainEventBase, eventName?: string) {
   *       await this.activityLogModel.create({ event: eventName ?? 'unknown', ...
   *
   * with a comment asserting that "Nest's decorator does pass [the name] when
   * the listener declares a second parameter". IT DOES NOT. `@OnEvent` invokes
   * the handler with the emitted VALUES only, so the second parameter is
   * whatever the emitter passed as a second argument - here, nothing. The
   * `?? 'unknown'` fallback then hid the failure completely.
   *
   * THE SHAPE OF THIS BUG is worth more than the fix:
   *
   *   - it typechecked, because `eventName?: string` is legal whether or not
   *     anything ever passes it
   *   - it never threw, because the `??` fallback supplied a plausible value
   *   - the feature LOOKED functional - rows appeared, with correct actors,
   *     subjects, payloads and timestamps
   *   - the comment beside it described the mechanism confidently and wrongly
   *
   * It was found by building the UI, looking at real data, and noticing every
   * row said the same thing. Not by reading the code - the code reads fine.
   *
   * A DEFAULT VALUE ON A FIELD YOU DID NOT SUCCESSFULLY READ IS A BUG
   * DETECTOR THAT HAS BEEN DISABLED. `'unknown'` turned a loud failure into a
   * silent one. The same instinct that writes `catch {}`.
   *
   * -------------------------------------------------------------------------
   * WHY `onAny` IS THE RIGHT MECHANISM
   * -------------------------------------------------------------------------
   * eventemitter2's `onAny(listener)` calls back with `(eventName, ...values)`
   * - the name is the FIRST argument, by design, for exactly this use case.
   * It is the documented way to build a cross-cutting observer.
   *
   * With `wildcard: true` and `delimiter: '.'`, the name arrives as an ARRAY of
   * segments (`['user', 'registered']`), not a string. Joining it back is
   * required, and forgetting to would store `"user,registered"` - a subtler
   * version of the same class of bug.
   *
   * REGISTERED IN `onModuleInit` rather than the constructor, so the emitter is
   * fully initialised and the subscription's lifetime is tied to the module's.
   * ===========================================================================
   */
  onModuleInit(): void {
    this.emitter.onAny((eventName: string | string[], ...values: unknown[]) => {
      /**
       * `void` the promise deliberately. `onAny` is synchronous and ignores a
       * returned promise, so this is fire-and-forget by construction - which is
       * acceptable only because `record` never throws (see the header).
       *
       * NOTE THE BEHAVIOUR CHANGE THIS INTRODUCES, because it is a real
       * trade-off and not a free win: the old `@OnEvent` handler was awaited on
       * the one `emitAsync` path (`user.deletion_requested`), so the audit row
       * was written before the delete completed. Through `onAny` it is not.
       *
       * For this project that is fine - the header already argues this is a
       * best-effort log, not a compliance record. If it were a compliance
       * record, the write belongs in the same transaction as the state change,
       * not in a listener at all.
       */
      void this.record(Array.isArray(eventName) ? eventName.join('.') : eventName, values[0]);
    });
  }

  private async record(eventName: string, rawPayload: unknown): Promise<void> {
    const payload = rawPayload as DomainEventBase;
    // Every domain event extends DomainEventBase, but the helpers below read
    // arbitrary keys (taskId, projectId, ...) that differ per event - so they
    // work on a record view of the same object.
    const record = payload as unknown as Record<string, unknown>;

    // Defensive: an event emitted by a library (not one of ours) may not carry
    // our base shape. Recording garbage is worse than recording nothing.
    if (!payload || typeof payload !== 'object' || !('actorId' in payload)) return;

    /**
     * NO `?? 'unknown'` FALLBACK ANY MORE, and its removal is the point.
     *
     * That fallback is what turned a broken event-name lookup into 25 rows of
     * plausible-looking data. A default that stands in for a value you failed
     * to read does not make the system resilient - it makes the failure
     * invisible.
     *
     * If `onAny` ever stops supplying a name, this refuses to write and says
     * so. A missing audit row that is LOGGED is recoverable; twenty-five rows
     * saying "unknown" are not, because nobody knows to look.
     */
    if (!eventName) {
      this.logger.error('Refusing to record an activity with no event name');
      return;
    }

    try {
      await this.activityLogModel.create({
        event: eventName,
        actorId: payload.actorId,
        subjectId: extractSubjectId(record),
        payload: redact(record),
      });
    } catch (error) {
      // Never throw - see the header. An audit failure must not become a
      // user-visible failure on the one path that awaits listeners.
      this.logger.error(`Failed to record activity for ${eventName}: ${describe(error)}`);
    }
  }
}

/**
 * Pull out the "thing this happened to", whichever id the event carries.
 *
 * Deliberately ordered most-specific first: a task event that also carries a
 * `projectId` should be filed under the TASK, because that is what the audit
 * view for a task needs.
 */
function extractSubjectId(payload: Record<string, unknown>): string | null {
  const candidates = ['taskId', 'commentId', 'projectId', 'userId'];

  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }

  return null;
}

/**
 * Strip anything that must not be written to an audit record.
 *
 * WHY THIS IS NOT PARANOIA: an audit log is long-lived, widely readable, and
 * frequently exported. It is exactly the wrong place for a credential to end
 * up, and "we found tokens in the audit table" is a real incident class.
 *
 * The allow-list vs deny-list argument applies here too, and this is a
 * DENY-list - which is the weaker choice. It is used because event payloads are
 * heterogeneous and an allow-list would need per-event configuration; the
 * mitigation is that domain events are our own types, so a reviewer can see
 * what goes into them. If payloads ever came from outside, this should invert.
 */
function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (REDACTED_KEYS.has(key)) continue;

    // `blockers` is the mutable veto array - useful context, but it is decision
    // state rather than a fact about the event.
    if (key === 'blockers' && Array.isArray(value) && value.length === 0) continue;

    clean[key] = value;
  }

  return clean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
