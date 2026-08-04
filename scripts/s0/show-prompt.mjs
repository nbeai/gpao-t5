#!/usr/bin/env node
// **S0 — 발화 하나에 모델이 실제로 받는 것을 그대로 찍는다.** 모델을 부르지 않는다(비용 0).
//
// 왜: 오너 라이브에서 "안녕" 한 마디에 능력 목록이 나왔고, 나는 소스만 읽고 원인을 세 번 틀렸다.
// 이 스크립트는 고치는 도구가 아니라 **보는 도구**다. 여기 찍힌 것이 사실이다.
//
//   node scripts/s0/show-prompt.mjs "안녕"
//   node scripts/s0/show-prompt.mjs "너 뭐 할 수 있어?"
//
// 라이브 서버가 만든 덤프를 읽으려면 `GPAO_T5_PROMPT_DUMP=<dir>` 로 서버를 띄우고 그 폴더를 본다.
import { buildTaskContext } from '../../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../../src/runtime/model-provider.js';
import { interpret } from '../../src/kernel/l1-intent/intent.js';
import { buildSelfState } from '../../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoTools } from '../../src/surface/demo-context.js';

const 발화 = process.argv[2] ?? '안녕';

// 오너 설치와 같은 손 구성을 흉내 낸다 — 손이 없으면 볼 것도 없다.
const env = demoEnv({
  include: ['local.file', 'web.collect', 'local.terminal', 'browser.observe'],
  hands: ['local.file', 'web.collect', 'local.terminal', 'browser.observe'],
});
const selfState = buildSelfState(env, { tools: demoTools({}) });
const intent = interpret(발화, { selfState });

const tc = buildTaskContext({
  intent,
  selfState,
  currentRequest: 발화,
  identity: { name: 'GPAO-T5' },
});
const m = buildModelMessages(tc);

const 줄 = (s) => console.log(s);
줄('═'.repeat(78));
줄(`발화: ${JSON.stringify(발화)}`);
줄(`answerMode: ${intent.answerMode}   ·   selfhoodDetail: ${Boolean(tc.selfhoodDetail)}`);
줄(`system ${m.system.length}자 · user ${String(m.user ?? '').length}자`);
줄('═'.repeat(78));
줄(m.system);
줄('─'.repeat(78));
줄('[user]');
줄(String(m.user ?? ''));
줄('═'.repeat(78));

// 능력 관련 줄만 따로 짚어 준다 — 이게 이번 단계의 관심사다.
const 능력줄 = m.system.split('\n').filter((l) => /손|아직 안 되는 것|할 수 있|능력|도구/.test(l));
줄('※ 능력에 관한 줄만:');
for (const l of 능력줄) 줄(`   │ ${l}`);
if (!능력줄.length) 줄('   (없음)');
