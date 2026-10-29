import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

/**
 * =============================================================================
 * The liveness indicator - and why it checks NOTHING
 * =============================================================================
 * This looks like a joke indicator: it is always up. It is not, and the
 * reasoning is the whole point of a liveness probe.
 *
 * FAILING LIVENESS MEANS THE ORCHESTRATOR RESTARTS THE CONTAINER. So the only
 * question a liveness probe may ask is: **"is restarting this process the right
 * response?"** For a wedged event loop, yes. For a slow database, absolutely
 * not. And there is no in-process check that can distinguish the two better
 * than the simple fact of whether this handler ran at all.
 *
 * That fact is the actual signal. If the event loop is blocked, this endpoint
 * does not return `down` - it does not return AT ALL, and the probe fails by
 * timeout. Which is exactly right, and is why "always up" is a complete
 * liveness implementation for a Node service.
 *
 * -----------------------------------------------------------------------------
 * WHY THE HEAP CHECK MOVED TO /health/detail
 * -----------------------------------------------------------------------------
 * The first version of this used `MemoryHealthIndicator.checkHeap(512MB)` in
 * liveness. Two problems showed up, one of them only under test:
 *
 *   1. IT MEASURES THE PROCESS, NOT THE APP. Under Jest, the test runner shares
 *      the process, so the probe was reporting the RUNNER's heap - and the
 *      liveness test failed intermittently for reasons that had nothing to do
 *      with the application. The same confusion exists in production whenever
 *      anything else shares the process.
 *
 *   2. THE THRESHOLD IS A DUPLICATE OF THE CONTAINER MEMORY LIMIT, in a second
 *      place, in a different unit, that nobody updates when the limit changes.
 *      Set it too low and you restart healthy pods; too high and the kernel's
 *      OOM killer gets there first - which is what actually happens in practice,
 *      and it is a better mechanism anyway because it is enforced by the
 *      platform rather than by the process diagnosing itself.
 *
 * So memory is reported in `/health/detail`, where a number informs a human,
 * and is not used to trigger a restart.
 *
 * The uptime field below is genuinely useful in that report: an instance whose
 * uptime keeps resetting is in a crash loop, and that is visible at a glance.
 * =============================================================================
 */
@Injectable()
export class ProcessHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isAlive(key: string): HealthIndicatorResult {
    return this.healthIndicatorService.check(key).up({
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    });
  }
}
