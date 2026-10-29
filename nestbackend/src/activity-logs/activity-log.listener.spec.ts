import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';

import { DomainEvent } from 'src/events/domain-events';

import { ActivityLogListener } from './activity-log.listener';
import { ActivityLog } from './schemas/activity-log.schema';

/**
 * =============================================================================
 * THE TEST THAT WOULD HAVE CAUGHT `event: "unknown"`
 * =============================================================================
 * This listener had NO tests, and it shipped a bug that made the entire audit
 * trail useless: all 25 records in the development database stored
 * `event: "unknown"`, because `@OnEvent('**')` does not pass the matched event
 * name to the handler and a `?? 'unknown'` fallback stood in for it.
 *
 * WHAT MAKES THIS TEST DIFFERENT from the one that would NOT have caught it:
 * it uses a REAL `EventEmitter2`, configured exactly as the app configures it,
 * and emits a real event. A test that called `listener.record('user.registered',
 * payload)` directly would pass against the broken version — the bug was never
 * in `record`, it was in HOW THE NAME WAS OBTAINED.
 *
 * That is the general shape: when a bug lives in the wiring between a framework
 * and your code, only a test that includes the framework can see it. Mocking
 * the emitter would mock away the entire defect.
 * =============================================================================
 */
describe('ActivityLogListener', () => {
  let emitter: EventEmitter2;
  let created: Record<string, unknown>[];

  beforeEach(async () => {
    created = [];

    const moduleRef = await Test.createTestingModule({
      imports: [
        /**
         * THE SAME CONFIGURATION AS events.module.ts.
         *
         * `wildcard: true` with `delimiter: '.'` is what makes `onAny` deliver
         * the name as an ARRAY of segments rather than a string — which is the
         * detail the fix has to handle, and which a differently-configured
         * emitter in a test would hide.
         */
        EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
      ],
      providers: [
        ActivityLogListener,
        {
          provide: getModelToken(ActivityLog.name),
          useValue: {
            create: (doc: Record<string, unknown>) => {
              created.push(doc);
              return Promise.resolve(doc);
            },
          },
        },
      ],
    }).compile();

    // `init()` runs onModuleInit, which is where the subscription is registered.
    await moduleRef.init();
    emitter = moduleRef.get(EventEmitter2);
  });

  /** onAny dispatches synchronously but `record` is async — let it settle. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('records the real event name, not a placeholder', async () => {
    emitter.emit(DomainEvent.USER_REGISTERED, {
      actorId: 'user-1',
      userId: 'user-1',
      email: 'a@b.test',
      name: 'Ada',
      occurredAt: new Date(),
    });
    await flush();

    expect(created).toHaveLength(1);
    /**
     * THE ASSERTION THE WHOLE FILE EXISTS FOR.
     *
     * Both halves matter. `toBe('user.registered')` pins the correct value;
     * `not.toBe('unknown')` names the specific regression, so a future failure
     * message points straight at this bug rather than at a generic mismatch.
     */
    expect(created[0].event).toBe('user.registered');
    expect(created[0].event).not.toBe('unknown');
  });

  /**
   * THE SEGMENT-JOINING DETAIL.
   *
   * With wildcards enabled, `onAny` yields `['task', 'status_changed']`. Passing
   * that array straight through stores `"task,status_changed"` via implicit
   * `toString()` — plausible enough to survive review, wrong enough to break
   * every filter.
   */
  it('joins namespaced event names back into a dotted string', async () => {
    emitter.emit(DomainEvent.TASK_STATUS_CHANGED, {
      actorId: 'user-1',
      taskId: 'task-1',
      occurredAt: new Date(),
    });
    await flush();

    expect(created[0].event).toBe('task.status_changed');
    expect(created[0].event).not.toContain(',');
  });

  it('attributes the actor and the subject', async () => {
    emitter.emit(DomainEvent.TASK_ASSIGNED, {
      actorId: 'manager-1',
      taskId: 'task-9',
      assigneeId: 'user-2',
      occurredAt: new Date(),
    });
    await flush();

    expect(created[0].actorId).toBe('manager-1');
    expect(created[0].subjectId).toBe('task-9');
  });

  /**
   * REDACTION, asserted rather than assumed.
   *
   * An audit log is one of the easiest places to leak a secret, because it
   * records payloads verbatim by design. This pins that the redaction list is
   * actually applied — the kind of control that is written once and never
   * verified again.
   */
  it('never writes a password or token into an audit record', async () => {
    emitter.emit(DomainEvent.USER_REGISTERED, {
      actorId: 'user-1',
      userId: 'user-1',
      email: 'a@b.test',
      password: 'Sup3rSecret!',
      refreshToken: 'rt_abc123',
      occurredAt: new Date(),
    });
    await flush();

    const payload = created[0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('refreshToken');
    expect(payload.email).toBe('a@b.test');
  });

  /**
   * Events from outside our domain must be ignored.
   *
   * The emitter is shared, so a library or a future internal event without our
   * base shape will reach this listener. Recording it would fill the audit trail
   * with rows that have no actor — noise that makes the real entries harder to
   * find.
   */
  it('ignores events that do not carry an actorId', async () => {
    emitter.emit('some.library.event', { hello: 'world' });
    await flush();

    expect(created).toHaveLength(0);
  });

  /**
   * A WRITE FAILURE MUST NOT PROPAGATE.
   *
   * `user.deletion_requested` is emitted with `emitAsync`, so a throw here could
   * abort a user-facing operation — an audit failure becoming a delete failure.
   * The listener swallows and logs instead.
   */
  it('does not throw when the write fails', async () => {
    const listener = new ActivityLogListener(
      { create: () => Promise.reject(new Error('mongo down')) } as never,
      emitter,
    );
    listener.onModuleInit();

    expect(() => {
      emitter.emit(DomainEvent.USER_REGISTERED, {
        actorId: 'user-1',
        userId: 'user-1',
        occurredAt: new Date(),
      });
    }).not.toThrow();
    await flush();
  });
});
