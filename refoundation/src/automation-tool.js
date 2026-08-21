import { EFFECT_SCHEMA } from './exec-tool.js';

export function makeAutomationTool({ store, scheduler, sessionId, authorizeEffect } = {}) {
  if (!store || !scheduler || !sessionId) throw new TypeError('automation tool inputs are required');
  return {
    name: 'automation',
    searchTerms: ['schedule recurring daily weekly monthly future cron reminder', '예약 반복 매일 매주 매월 나중 알림'],
    description: 'Create, inspect, pause, resume, cancel, or run a durable scheduled task. Use this when the user asks for a future, repeated, daily, weekly, monthly, or timed action. Store the user goal as a normal prompt; every scheduled Run re-evaluates current tools and authority, so old approvals are never reused. list and inspect are read-only. Creating or changing a schedule is a reversible T5-local change, not system crontab.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list', 'inspect', 'create', 'pause', 'resume', 'cancel', 'run_now'] },
      jobId: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, prompt: { type: ['string', 'null'] },
      scheduleKind: { type: ['string', 'null'], enum: ['cron', 'every', 'at', null] },
      schedule: { type: ['string', 'null'] }, timezone: { type: ['string', 'null'] },
      effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'jobId', 'name', 'prompt', 'scheduleKind', 'schedule', 'timezone', 'effect'] },
    async preflight(args, context) {
      if (['list', 'inspect'].includes(args.action)) return { allowed: true };
      if (args.effect?.kind !== 'local_change' || args.effect?.reversible !== true) return {
        allowed: false, outcome: 'not_executed', result: { state: 'reversible_local_change_required' },
      };
      return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : { allowed: true };
    },
    async execute(args) {
      if (args.action === 'list') return { state: 'listed', ...await store.list() };
      if (args.action === 'inspect') return { state: 'inspected', job: await store.inspect(args.jobId) };
      if (args.action === 'create') { const job = await store.create({ name: args.name, prompt: args.prompt, sessionId,
          scheduleKind: args.scheduleKind, schedule: args.schedule, timezone: args.timezone }); await scheduler.jobsChanged(); return { state: 'scheduled', job, userSafeSummary: `${job.name} 자동화를 예약했어요.` }; }
      if (args.action === 'pause') { const job = await store.pause(args.jobId); await scheduler.jobsChanged(); return { state: 'paused', job }; }
      if (args.action === 'resume') { const job = await store.resume(args.jobId); await scheduler.jobsChanged(); return { state: 'scheduled', job }; }
      if (args.action === 'cancel') { const job = await store.cancel(args.jobId); await scheduler.jobsChanged(); return { state: 'cancelled', job }; }
      if (args.action === 'run_now') return { state: 'queued', run: await scheduler.runNow(args.jobId) };
      throw new Error('unsupported automation action');
    },
  };
}
