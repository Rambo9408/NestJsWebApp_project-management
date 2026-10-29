import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * =============================================================================
 * The counters collection - atomic sequence numbers in MongoDB
 * =============================================================================
 * MongoDB has no AUTO_INCREMENT. Task references like `WEB-142` need one, and
 * the obvious implementation is wrong:
 *
 *     const next = (await taskModel.countDocuments({ projectId })) + 1;   // ❌
 *
 * That is check-then-act: two concurrent creates both read 141 and both write
 * `WEB-142`. It is also wrong after any delete, because the count goes down
 * while the sequence must not.
 *
 * The correct pattern is a single atomic operation:
 *
 *     findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true })
 *
 * `$inc` is applied by the server under a document-level lock, so N concurrent
 * callers get N distinct values with no application-level coordination and no
 * transaction. Document-level atomicity is one of MongoDB's genuine strengths,
 * and knowing to reach for `$inc`/`$push`/`$addToSet` instead of read-modify-
 * write is a strong signal in an interview.
 *
 * TRADE-OFF: this is one extra round trip per task creation, and the counter
 * document is a hot spot for a very high-throughput project. If that ever
 * mattered, the standard answer is to hand out RANGES (increment by 100, cache
 * them in the process) - at the cost of gaps in the sequence when a process
 * restarts. Gaps are usually fine; duplicates never are.
 * =============================================================================
 */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  /**
   * The sequence name, e.g. `task:WEB`. Used as `_id`, so the upsert is
   * inherently unique with no extra index.
   */
  @Prop({ type: String, required: true })
  declare _id: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export type CounterDocument = HydratedDocument<Counter>;

export const CounterSchema = SchemaFactory.createForClass(Counter);
