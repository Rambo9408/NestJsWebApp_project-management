import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * =============================================================================
 * EventsModule - the in-process event bus
 * =============================================================================
 * `@nestjs/event-emitter` is a thin wrapper around `eventemitter2`. Understanding
 * what it is - and what it is NOT - is most of the value here.
 *
 * WHAT IT IS: a SYNCHRONOUS, IN-MEMORY dispatcher.
 *
 *   - `emit()` calls every listener and returns immediately, ignoring their
 *     results. Async listeners become floating promises - an unhandled
 *     rejection risk, and untestable, because your assertion can run before the
 *     listener does.
 *   - `emitAsync()` awaits every listener and returns their results. Slower;
 *     the emitter now waits for its listeners, which partially defeats the
 *     decoupling - use it deliberately (as the veto below does), not by
 *     default.
 *
 * WHAT IT IS NOT - and this is the interview question:
 *
 *   ✗ NOT DURABLE. Events live in memory. A crash between emit and handle loses
 *     them, with no retry and no dead-letter.
 *   ✗ NOT CROSS-PROCESS. Instance #3's emit never reaches instance #7. Anything
 *     that must happen exactly once across a cluster does NOT belong here.
 *   ✗ NOT ORDERED ACROSS EVENT NAMES, and not transactional - a listener that
 *     throws does not roll back the emitter's database write.
 *
 * SO WHEN IS IT THE RIGHT TOOL?
 *   ✓ Decoupling modules INSIDE one process, where losing the reaction on a
 *     crash is acceptable or recoverable.
 *   ✓ Work that is genuinely optional: activity logs, metrics, cache warming.
 *   ✓ As a STEPPING STONE - the emit points are exactly where a real broker
 *     plugs in later (Phase 20), and the calling code does not change.
 *
 * WHEN TO REACH PAST IT: anything that must survive a restart, must run exactly
 * once, or must reach another service. Then it is BullMQ (Phase 12) or a broker,
 * and the honest pattern is the TRANSACTIONAL OUTBOX - write the event to the
 * database in the SAME transaction as the state change, and have a separate
 * process publish it. That is the only way to avoid "the write committed but the
 * event was lost", which an in-memory bus cannot solve at all.
 *
 * THE DEFAULT THIS PROJECT USES: emit in-process for reactions that are
 * optional; enqueue a BullMQ job for anything a user would notice if it went
 * missing. Notice that the notification listener does BOTH - it reacts to an
 * event and then enqueues durable work, which is the practical way to combine
 * them.
 * =============================================================================
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      /**
       * WILDCARDS: `@OnEvent('task.*')` matches every task event. Useful for a
       * catch-all audit listener, which is exactly what the activity log is.
       */
      wildcard: true,
      delimiter: '.',

      /**
       * `maxListeners` guards against a leak: a listener registered per request
       * (rather than per module) would grow this without bound, and Node's
       * default warning at 10 exists for that reason. 20 is comfortable for a
       * module-scoped set and still low enough to warn if something is wrong.
       */
      maxListeners: 20,

      /**
       * Print the offending event name when the limit is exceeded. Without it
       * the warning tells you a leak exists but not where - which is the
       * difference between a five-minute fix and an afternoon.
       */
      verboseMemoryLeak: true,

      /**
       * `false` means an `error` event with no listener is NOT thrown.
       *
       * Node's EventEmitter treats `error` specially: emitting one with no
       * listener throws. Inside an event bus that is a trap - one unhandled
       * error event would crash the process. We suppress it here and handle
       * listener failures explicitly instead.
       */
      ignoreErrors: false,
    }),
  ],
})
export class EventsModule {}
