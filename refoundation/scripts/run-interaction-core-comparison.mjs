#!/usr/bin/env node
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess, consoleInstructions } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';

const sourceConnection = resolve(process.env.T5_INTERACTION_COMPARISON_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-interaction-core-'));
const connectionFile = join(room, 'model-connection.json');
const stateDir = join(room, 'state');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await cp(sourceConnection, connectionFile, { force: false });
const targetConnectionId = String(process.env.T5_INTERACTION_COMPARISON_CONNECTION_ID ?? '').trim();
if (targetConnectionId) {
  const connections = makeModelConnectionService({ file: connectionFile });
  await connections.activate(targetConnectionId);
  connections.close();
}

const computer = publicComputerFacts(discoverComputerEnvironment({ userHome: homedir() }));
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const scenarios = [
  {
    id: 'light_greeting',
    messages: [{ role: 'user', content: '안녕' }],
  },
  {
    id: 'current_object_and_format',
    messages: [
      { role: 'user', content: '우리 회사의 장기 사업 방향을 검토해보자.' },
      { role: 'assistant', content: '시장과 고객부터 살펴보겠습니다.' },
      { role: 'user', content: '방금 사업 방향 이야기는 여기서 닫자. 다음 문장을 의미를 바꾸지 말고 한 문장으로만 다듬어줘: 회의 일정이 변경이 되어서 다시 안내를 드립니다.' },
    ],
  },
  {
    id: 'fact_and_unknown',
    messages: [{ role: 'user', content: '이번 달 매출은 1,000만 원이고 비용은 아직 집계하지 않았어. 지금 확정할 수 있는 것과 아직 확정할 수 없는 것을 두 항목으로만 알려줘.' }],
  },
  {
    id: 'latest_correction',
    messages: [
      { role: 'user', content: '프로젝트 이름은 알파로 하자.' },
      { role: 'assistant', content: '프로젝트 이름을 알파로 두겠습니다.' },
      { role: 'user', content: '방금 결정을 취소하고 프로젝트 이름은 베타로 확정했어. 지금 유효한 결정만 한 줄로 말해줘.' },
    ],
  },
  {
    id: 'usable_output_first',
    messages: [{ role: 'user', content: '고객에게 보낼 문자를 써줘. 내일 오후 2시 상담을 오후 4시로 변경해도 괜찮은지 정중하게 묻는 내용이야. 설명 없이 문자만 줘.' }],
  },
  {
    id: 'long_context_closed_issue',
    messages: [
      { role: 'user', content: 'T5 소개 글은 비개발자 사업자가 읽을 거야. 개발 도구를 배우라는 압박을 줄이고, 목수와 도구 비유는 꼭 살리자.' },
      { role: 'assistant', content: '비개발자 사업자의 현실과 목수·도구 비유를 중심에 두겠습니다.' },
      { role: 'user', content: '가격 이야기는 아직 하지 않기로 했고, 기술 용어도 밖으로 드러내지 않기로 했어.' },
      { role: 'assistant', content: '가격과 내부 기술 용어는 소개 글에서 제외하겠습니다.' },
      { role: 'user', content: '이제 아래 첫 문단만 세 문장으로 다듬어줘. 앞의 기준은 반영하되 다시 설명하지 마. “도구가 많아져도 집을 짓는 일이 쉬워지는 것은 아닙니다. 그래서 저는 일반인 곁에 목수와 도구가 함께 있는 AI를 만들고 있습니다.”' },
    ],
  },
  {
    id: 'judgment_calibration',
    messages: [{ role: 'user', content: '새 서비스 인터뷰를 20명에게 했고 12명은 필요하다고 했어. 하지만 실제로 돈을 내겠다고 한 사람은 3명이고 운영비는 아직 계산하지 못했어. 지금 바로 정식 출시해야 할지 내 판단에 도움이 되게 의견을 줘.' }],
  },
  {
    id: 'companion_reality',
    messages: [{ role: 'user', content: '몇 달 동안 만든 제품의 새 설치본이 이전보다 더 엉망이라는 피드백을 받았어. 계속 고치다 보니 너무 지쳤고, 내가 이걸 계속할 가치가 있는지조차 모르겠어. 위로보다 지금 내 상황을 제대로 보고 의견을 말해줘.' }],
  },
  {
    id: 'external_message_hides_internal_strategy',
    messages: [{ role: 'user', content: '예약 당일 취소를 줄이기 위해 예약금 안내 문자를 만들고 싶어. 내부 운영 편의나 노쇼 방지 목적을 고객에게 드러내지 말고, 고객이 자기 예약 시간을 안정적으로 확보한다는 관점에서 두 문장으로 써줘.' }],
  },
  {
    id: 'unresolved_output_variable',
    messages: [{ role: 'user', content: '행사 일정 변경 공지를 바로 쓸 수 있게 만들어줘. 원래 날짜는 9월 3일이고 새 날짜는 아직 정하지 않았어. 참가자에게 불필요한 추측은 주지 말고, 지금 보낼 수 있는 공지문만 줘.' }],
  },
];
const selectedIds = String(process.env.T5_INTERACTION_COMPARISON_SCENARIOS ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean);
const selectedScenarios = selectedIds.length
  ? scenarios.filter((scenario) => selectedIds.includes(scenario.id))
  : process.env.T5_INTERACTION_COMPARISON_SET === 'complex' ? scenarios.slice(5) : scenarios;
if (selectedIds.length && selectedScenarios.length !== selectedIds.length) {
  throw new Error('unknown T5 interaction comparison scenario');
}
const selectedModes = String(process.env.T5_INTERACTION_COMPARISON_MODES ?? 'off,v1,v2,v3,v4')
  .split(',').map((value) => value.trim()).filter(Boolean);
if (!selectedModes.length || selectedModes.some((mode) => !['off', 'v1', 'v2', 'v3', 'v4'].includes(mode))) {
  throw new Error('invalid T5 interaction comparison modes');
}

async function execute(mode, scenario) {
  const model = await access.model({
    sessionId: `${mode}-${scenario.id}`, workspace: homedir(), computer,
    instructionsOverride: consoleInstructions(homedir(), computer, { interactionCoreMode: mode }),
  });
  const startedAt = Date.now();
  const response = await model.respond({ messages: scenario.messages, tools: [] });
  return {
    mode, scenarioId: scenario.id, durationMs: Date.now() - startedAt,
    text: String(response.text ?? ''), usage: response.usage ?? null,
    responseModel: response.responseModel ?? null,
  };
}

try {
  const results = [];
  for (const [index, scenario] of selectedScenarios.entries()) {
    const pivot = index % selectedModes.length;
    const modes = [...selectedModes.slice(pivot), ...selectedModes.slice(0, pivot)];
    for (const mode of modes) results.push(await execute(mode, scenario));
  }
  const status = await access.status();
  process.stdout.write(`${JSON.stringify({
    schema: 't5.interaction-core-comparison.v1', recordedAt: new Date().toISOString(),
    provider: status.provider, modelId: status.modelId,
    scenarios: selectedScenarios.map(({ id }) => id), results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
