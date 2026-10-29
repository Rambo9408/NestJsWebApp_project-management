import { Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ConsumerA, ConsumerB, SingletonCounter, TransientCounter } from './counters';

/**
 * =============================================================================
 * Scope behaviour, asserted rather than described.
 * =============================================================================
 * These assertions ARE the definitions. If you can predict every one of them
 * before running the suite, you understand provider scopes.
 * =============================================================================
 */
describe('provider scopes', () => {
  describe('DEFAULT (singleton)', () => {
    it('is the same object everywhere and keeps its state', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [SingletonCounter],
      }).compile();

      const first = moduleRef.get(SingletonCounter);
      const second = moduleRef.get(SingletonCounter);

      expect(first).toBe(second);

      first.hit();
      expect(second.calls).toBe(1); // shared state - the point, and the danger
    });
  });

  describe('TRANSIENT', () => {
    it('gives each INJECTION SITE its own instance', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [TransientCounter, ConsumerA, ConsumerB],
      }).compile();

      const a = moduleRef.get(ConsumerA);
      const b = moduleRef.get(ConsumerB);

      // Same token, two consumers, two objects.
      expect(a.transient).not.toBe(b.transient);
      expect(a.transient.instanceId).not.toBe(b.transient.instanceId);
    });

    it('is NOT recreated per call - only per injection site', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [TransientCounter, ConsumerA],
      }).compile();

      const a = moduleRef.get(ConsumerA);
      const idBefore = a.transient.instanceId;

      // Same consumer, later call: still the instance it was given at construction.
      expect(moduleRef.get(ConsumerA).transient.instanceId).toBe(idBefore);
    });
  });

  describe('REQUEST', () => {
    /**
     * A request-scoped provider that does NOT inject REQUEST, so it can be
     * resolved outside an HTTP context. (Injecting REQUEST would require a real
     * request; that path is exercised by the /scopes endpoint.)
     */
    @Injectable({ scope: Scope.REQUEST })
    class RequestThing {
      readonly id = Math.random();
    }

    it('cannot be retrieved with get() - there is no instance', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [RequestThing],
      }).compile();

      // The error Nest raises here is worth recognising on sight:
      // "RequestThing is marked as a scoped provider... use resolve() instead".
      expect(() => moduleRef.get(RequestThing)).toThrow();
    });

    it('resolve() creates a new instance per DI context', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [RequestThing],
      }).compile();

      const one = await moduleRef.resolve(RequestThing);
      const two = await moduleRef.resolve(RequestThing);

      expect(one).not.toBe(two); // two contexts, two instances
    });

    it('resolve() with the SAME contextId returns the SAME instance', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [RequestThing],
      }).compile();

      const contextId = ContextIdFactory.create();

      const one = await moduleRef.resolve(RequestThing, contextId);
      const two = await moduleRef.resolve(RequestThing, contextId);

      // This is exactly the mechanism Nest uses per HTTP request: one context
      // id, so every provider in that request shares one instance.
      expect(one).toBe(two);
    });
  });

  describe('scope bubbling (contagion)', () => {
    @Injectable({ scope: Scope.REQUEST })
    class ScopedLeaf {
      readonly id = Math.random();
    }

    /** Declares NO scope - and becomes request-scoped anyway. */
    @Injectable()
    class UndeclaredMiddle {
      constructor(readonly leaf: ScopedLeaf) {}
      readonly id = Math.random();
    }

    it('converts every consumer above a scoped provider', async () => {
      // `ModuleRef` is provided by the framework in every module - it never
      // goes in a `providers` array (it is an abstract class, so TypeScript
      // rejects it there anyway).
      const moduleRef = await Test.createTestingModule({
        providers: [ScopedLeaf, UndeclaredMiddle],
      }).compile();

      // If UndeclaredMiddle were still a singleton, get() would work. It throws,
      // because depending on a request-scoped provider made it request-scoped.
      expect(() => moduleRef.get(UndeclaredMiddle)).toThrow();

      const one = await moduleRef.resolve(UndeclaredMiddle);
      const two = await moduleRef.resolve(UndeclaredMiddle);
      expect(one).not.toBe(two);
    });
  });
});
