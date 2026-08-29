import { EFFECT_SCHEMA } from './exec-tool.js';

export function makeAutomationTool({ store, scheduler, sessionId, authorizeEffect, inspectRequirements,
  workBinding = null } = {}) {
  if (!store || !scheduler || !sessionId) throw new TypeError('automation tool inputs are required');
  return {
    name: 'automation',
    searchTerms: ['schedule recurring daily weekly monthly future task cancel schedule', '예약 반복 매일 매주 매월 나중 작업 예약 취소'],
    description: 'Create, inspect, pause, resume, cancel, or run a durable scheduled T5 task. This schedules a future T5 model Run only: it does not create or prove a macOS, Windows, phone, calendar, email, messenger, or other notification by itself. Do not use it for an ambiguous “remind/tell me” request until the user’s delivery surface is known. When the user explicitly asks for an operating-system notification, use the operating system through exec and verify that exact notification schedule instead of this tool. Store an actual T5 agent goal as a normal prompt; every scheduled Run re-evaluates current tools and authority, so old approvals are never reused. list and inspect are read-only. Creating or changing a schedule is a reversible T5-local change, not system crontab.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list', 'inspect', 'create', 'pause', 'resume', 'cancel', 'run_now'] },
      jobId: { type: ['string', 'null'] }, name: { type: ['string', 'null'] },
      prompt: {
        type: ['string', 'null'],
        description: 'Execution-time imperative only. Describe what to do now when the schedule fires. Do not repeat timing, recurrence, “schedule”, or “create an automation”. When delivery is telegram or origin_session, produce the final content only and do not tell the future model to send/deliver it; the scheduler owns contracted delivery.',
      },
      scheduleKind: { type: ['string', 'null'], enum: ['cron', 'every', 'at', null] },
      schedule: { type: ['string', 'null'] }, timezone: { type: ['string', 'null'] },
      requiredTools: {
        type: ['array', 'null'], maxItems: 10, items: { type: 'string' },
        description: 'Exact tool names the future Run must use to complete the user objective, or an empty array for a text-only T5 task.',
      },
      requiredEffect: {
        type: ['string', 'null'], enum: ['observe', 'local_change', 'external_change', 'external_send', null],
        description: 'Effect that the future scheduled objective itself must perform. Use null for text-only content whose contracted delivery is owned by the scheduler. Do not use local_change merely because the create action saves this schedule; the separate effect field describes that current reversible save.',
      },
      requireResultUrl: { type: ['boolean', 'null'], description: 'True when completion requires an observed result URL, such as a published post.' },
      delivery: {
        type: ['string', 'null'], enum: ['origin_session', 'telegram', 'none', null],
        description: 'Where the completed result must be delivered. Telegram is accepted only when an exact owner binding is currently ready.',
      },
      preparationToolCallIds: {
        type: ['array', 'null'], maxItems: 20, items: { type: 'string' },
        description: 'Successful toolCallIds from this Run that prove required login or delivery preparation. A future browser task must cite a current browser observation.',
      },
      delegatedTool: { type: ['string', 'null'], description: 'Exact future tool authorized for the delegated effect, otherwise null.' },
      delegatedEffect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }], description: 'Exact bounded future effect and targets explicitly delegated by the user, otherwise null.' },
      effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: [
      'action', 'jobId', 'name', 'prompt', 'scheduleKind', 'schedule', 'timezone',
      'requiredTools', 'requiredEffect', 'requireResultUrl', 'delivery',
      'preparationToolCallIds', 'delegatedTool', 'delegatedEffect', 'effect',
    ] },
    async preflight(args, context) {
      if (['list', 'inspect'].includes(args.action)) return { allowed: true };
      if (args.effect?.kind !== 'local_change' || args.effect?.reversible !== true) return {
        allowed: false, outcome: 'not_executed', result: { state: 'reversible_local_change_required' },
      };
      if (args.action === 'create') {
        const requiredTools = [...new Set((args.requiredTools ?? []).map(String))];
        const preparationIds = new Set((args.preparationToolCallIds ?? []).map(String));
        const preparation = (context.priorReceipts ?? []).filter((receipt) => preparationIds.has(receipt.toolCallId));
        if (preparation.length !== preparationIds.size || preparation.some((receipt) => (
          !receipt.actualCall || receipt.outcome !== 'succeeded'
        ))) return {
          allowed: false, outcome: 'not_executed', result: { state: 'automation_preparation_evidence_invalid' },
        };
        if (requiredTools.includes('browser') && !preparation.some((receipt) => (
          receipt.actualCall?.name === 'browser'
          && ['observed', 'acted'].includes(receipt.result?.state)
          && receipt.result?.secretFieldsPresent !== true
        ))) return {
          allowed: false, outcome: 'not_executed', result: {
            state: 'automation_requirements_unavailable', reason: 'browser_session_not_verified_now',
            missingTools: ['browser'], delivery: args.delivery ?? null,
          },
        };
        const delegated = args.delegatedTool || args.delegatedEffect;
        if (args.delivery === 'telegram' && (args.requiredEffect != null || delegated)) return {
          allowed: false, outcome: 'not_executed', result: {
            state: 'automation_authority_envelope_invalid',
            reason: 'telegram_delivery_is_owned_by_scheduler',
          },
        };
        if (args.delivery === 'telegram' && /telegram|텔레그램|전송|보내/iu.test(String(args.prompt ?? ''))) return {
          allowed: false, outcome: 'not_executed', result: {
            state: 'automation_delivery_prompt_invalid',
            reason: 'telegram_delivery_is_owned_by_scheduler',
          },
        };
        if (delegated && (!args.delegatedTool || !args.delegatedEffect
          || !requiredTools.includes(args.delegatedTool)
          || args.delegatedEffect.kind !== args.requiredEffect
          || !['local_change', 'external_change', 'external_send'].includes(args.delegatedEffect.kind))) return {
          allowed: false, outcome: 'not_executed', result: { state: 'automation_authority_envelope_invalid' },
        };
        const inspected = typeof inspectRequirements === 'function'
          ? await inspectRequirements({ requiredTools, delivery: args.delivery ?? 'origin_session' })
          : { ready: true, deliverySessionId: null };
        if (inspected.ready !== true) return {
          allowed: false, outcome: 'not_executed', result: {
            state: 'automation_requirements_unavailable',
            missingTools: inspected.missingTools ?? [],
            delivery: inspected.delivery ?? null,
            reason: inspected.reason ?? 'required_capability_or_delivery_unavailable',
          },
        };
        context.automationRequirements = {
          requiredTools, requiredEffect: args.requiredEffect,
          requireResultUrl: args.requireResultUrl === true,
          delivery: { kind: args.delivery ?? 'origin_session', sessionId: inspected.deliverySessionId ?? null },
          authorityEnvelope: delegated ? {
            toolName: args.delegatedTool,
            effect: { ...args.delegatedEffect, approvalToken: null },
          } : null,
        };
      }
      return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : { allowed: true };
    },
    async execute(args, context = {}) {
      if (args.action === 'list') return { state: 'listed', ...await store.publicList() };
      if (args.action === 'inspect') return { state: 'inspected', job: await store.inspect(args.jobId) };
      if (args.action === 'create') {
        const contract = context.automationRequirements;
        if (!contract) return { state: 'automation_requirements_unverified' };
        const resolvedWorkBinding = typeof workBinding === 'function'
          ? await workBinding() : workBinding;
        const job = await store.create({ name: args.name, prompt: args.prompt, sessionId,
          scheduleKind: args.scheduleKind, schedule: args.schedule, timezone: args.timezone,
          requirements: contract, delivery: contract.delivery, authorityEnvelope: contract.authorityEnvelope,
          workBinding: resolvedWorkBinding });
        await scheduler.jobsChanged();
        return { state: 'scheduled', job, userSafeSummary: `${job.name} 자동화를 예약했어요.` };
      }
      if (args.action === 'pause') { const job = await store.pause(args.jobId); await scheduler.jobsChanged(); return { state: 'paused', job }; }
      if (args.action === 'resume') { const job = await store.resume(args.jobId); await scheduler.jobsChanged(); return { state: 'scheduled', job }; }
      if (args.action === 'cancel') { const job = await scheduler.cancel(args.jobId); return { state: 'cancelled', job }; }
      if (args.action === 'run_now') return { state: 'queued', run: await scheduler.runNow(args.jobId) };
      throw new Error('unsupported automation action');
    },
  };
}
