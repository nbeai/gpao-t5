// 기존 제품 회귀 대본을 progressive control protocol로 운반하는 **테스트 전용 모델 어댑터**.
// 새 selector 자체의 계약은 p0-control-progressive-disclosure.test.js가 직접 대본으로 검증한다.
import { MODEL_CONTROL_SCHEMAS } from '../../src/kernel/l2-plan/model-control.js';

const categoryOf = (name) => {
  if (String(name).startsWith('memory.')) return 'memory';
  if (String(name).startsWith('automation.')) return 'automation';
  if (name === 'skill.propose') return 'skill';
  if (name === 'agent.propose') return 'agent';
  if (name === 'work.state') return 'work';
  if (name === 'ask.user') return 'question';
  return null;
};

export function progressiveControlModel(model) {
  let pending = null;
  return Object.assign(Object.create(model), {
    async respond(tc, opts = {}) {
      const offered = opts.tools ?? [];
      const selectorOffered = offered.some((schema) => schema.name === 'control.select');
      if (pending && !selectorOffered) {
        const output = pending;
        pending = null;
        return output;
      }
      if (!selectorOffered) return model.respond(tc, opts);

      const execution = offered.filter((schema) => schema.name !== 'control.select');
      const actualControls = MODEL_CONTROL_SCHEMAS.filter((schema) => schema.name !== 'control.select');
      const output = await model.respond(tc, { ...opts, tools: [...execution, ...actualControls] });
      const calls = typeof output === 'string' ? [] : (output?.toolCalls ?? []);
      const categories = [...new Set(calls.map((call) => categoryOf(call?.name)).filter(Boolean))];
      const executionCalls = calls.filter((call) => !categoryOf(call?.name) && call?.name !== 'control.select');
      if (!categories.length || executionCalls.length) return output;
      pending = output;
      return { text: '', toolCalls: [{ name: 'control.select', args: { categories } }] };
    },
  });
}
