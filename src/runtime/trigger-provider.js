import { validateAutomationJob } from '../kernel/l5-growth/automation-contracts.js';
import { planTriggerOccurrences } from '../kernel/l5-growth/trigger-spec.js';

export class TriggerProvider {
  plan() {
    throw new Error('TriggerProvider.plan must be implemented');
  }
}

/** Built-in once/interval/daily/weekly trigger provider. */
export class BuiltinTriggerProvider extends TriggerProvider {
  constructor({ clock = Date.now } = {}) {
    super();
    this.clock = clock;
  }

  plan(job, { now = this.clock(), recovering = false } = {}) {
    const checked = validateAutomationJob(job);
    if (!checked.ok) throw new TypeError(`automation job invalid: ${checked.errors.join('; ')}`);

    if (job.trigger.nextRunAt !== job.nextRunAt) {
      return {
        jobId: job.id,
        cursorBefore: job.nextRunAt,
        occurrences: [],
        nextRunAt: job.nextRunAt,
        skippedCount: 0,
        dueCount: 0,
        recovering,
        reason: 'cursor_conflict',
      };
    }

    return {
      jobId: job.id,
      cursorBefore: job.nextRunAt,
      ...planTriggerOccurrences(job.trigger, {
        nextRunAt: job.nextRunAt,
        now,
        recovering,
      }),
    };
  }
}
