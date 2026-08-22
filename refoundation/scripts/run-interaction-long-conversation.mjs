#!/usr/bin/env node
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { consoleInstructions, makeConsoleModelAccess } from '../src/console-model-factory.js';
import {
  CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS,
  planConversationCheckpoint,
  summarizeConversationCheckpoint,
} from '../src/conversation-checkpoint.js';
import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';

const episode = [
  ['user', 'T5는 개발 도구를 배우지 않아도 되는 비개발자용 AI야. 목수와 도구가 함께 있는 존재라는 비유를 중심에 두자.'],
  ['assistant', '비개발자 사용자의 목적과 목수·도구의 결합을 제품 중심으로 두겠습니다.'],
  ['user', '모델은 바꿀 수 있으니 T5 코어가 모델보다 먼저 사용자의 현실과 능력을 공급해야 해.'],
  ['assistant', '모델 교체와 무관한 코어 상태와 능력 계약을 우선하겠습니다.'],
  ['user', 'SNS 링크 분석과 영상 자막도 나중에 필요할 것 같아.'],
  ['assistant', '현재 손으로 가능한 범위를 먼저 확인하고 실제 수요가 생길 때 열겠습니다.'],
  ['user', '안녕'],
  ['assistant', '안녕하세요.'],
  ['user', '에이전트들이 가벼운 대화에서도 느린 문제도 언젠가 보자.'],
  ['assistant', '가벼운 요청과 실제 작업의 처리 무게를 분리할 필요가 있습니다.'],
  ['user', '첫 설치 패키지는 테스터가 사용 중이고 다음 버전을 언제 줄지 고민이야.'],
  ['assistant', '기능 수보다 설치 실물의 핵심 사용자 여정이 자격을 얻었는지로 결정하겠습니다.'],
  ['user', '테스터가 브라우저 로그인과 Telegram 연결에서 실패했다고 했어.'],
  ['assistant', '브라우저와 Telegram의 실제 실패 원본을 현재 개발 기준으로 보겠습니다.'],
  ['user', '지금은 보안 말고 현재 개발 흐름만 보라고 했잖아. 보안 이야기는 여기서 닫아.'],
  ['assistant', '현재 개발 흐름만 보고 보안 쟁점은 닫겠습니다.'],
  ['user', '새 증거가 생겼어. 로컬 콘솔 Host와 Origin 검사가 없어서 이 보안 문제는 다시 열어야 해.'],
  ['assistant', '새 실측 증거가 있으므로 보안 쟁점을 다시 열고 실제 요청 관문으로 확인하겠습니다.'],
  ['user', 'Host·Origin·설치 신분 관문을 고쳤고 설치본 공격 요청도 403으로 확인했어. 보안 작업은 이제 끝났어.'],
  ['assistant', '보안 관문은 완료된 작업으로 닫겠습니다.'],
  ['user', '앱 완전 종료 뒤 session-only 로그인은 다시 요구될 수 있다는 경계를 0.1.3에서는 받아들일게.'],
  ['assistant', '0.1.3의 공식 제품 경계로 보존하겠습니다.'],
  ['user', 'Telegram 실계정 양방향과 제거·재설치도 성공했고 P0는 완료됐어.'],
  ['assistant', 'P0 인간 핵심 여정과 제거·재설치 종단을 완료 상태로 두겠습니다.'],
  ['user', '브라우저 daemon 생명주기를 바꾸던 실험은 불안정했으니 전부 폐기했어. 다시 살리지 마.'],
  ['assistant', 'daemon 실험은 폐기된 방법으로 유지하고 제품 경로로 되돌리지 않겠습니다.'],
  ['user', '세 번째 패키지는 Developer ID 서명과 Apple 공증까지 끝났어. 0.1.3 패키지는 이제 변경하지 마.'],
  ['assistant', '정식 인증된 0.1.3은 봉인된 배포물로 두겠습니다.'],
  ['user', 'BEAI 5에서 상황 파악·동반감·상대 관점을 추출한 Interaction Core 후보들을 비교해보자.'],
  ['assistant', '현재 T5와 여러 후보를 동일 모델·동일 과업으로 비교하겠습니다.'],
  ['user', 'off, v1, v2, v3, v4를 시험했고 v4가 gpt-5.5와 gpt-5.6에서 공통으로 가장 나았어.'],
  ['assistant', 'v4를 다음 배포 개발선의 기본 Interaction Core로 승격하겠습니다.'],
  ['user', '내일 팀 회의에 보낼 짧은 문구 하나만 써줘. 오전 10시에 온라인으로 보자고.'],
  ['assistant', '내일 오전 10시에 온라인으로 뵙겠습니다.'],
  ['user', '문구는 됐어. 다시 개발 이야기로 돌아가자.'],
  ['assistant', '현재 개발 이야기로 돌아가겠습니다.'],
  ['user', '이제 우선순위는 v4의 장기대화 안정성 시험이야. 일반 대화와 전략 대화가 섞이고 주제가 빠르게 바뀌어도 현재 초점을 놓치지 않는지 보자.'],
  ['assistant', '다음 작업은 v4 장기대화 안정성 검증입니다.'],
  ['user', '중요해. 이 시험 중에는 인증된 0.1.3을 수정하거나, 끝난 보안·패키지 작업을 다시 열거나, 폐기한 daemon 실험을 되살리면 안 돼.'],
  ['assistant', '장기대화 검증만 진행하고 세 금지선을 유지하겠습니다.'],
];

const stateProbe = [
  '지금 상태를 다음 JSON만으로 정리해. 설명과 코드펜스는 쓰지 마.',
  '{"currentFocus":"", "acceptedDecisions":[], "closedIssues":[], "prohibitedActions":[], "nextAction":""}',
  '현재 초점, 사용자가 받아들인 결정, 이미 닫힌 일, 하면 안 되는 행동, 바로 다음 한 작업을 구분해.',
].join('\n');
const naturalProbe = '그럼 지금 이 장기대화 시험이 왜 필요한지, 앞에서 끝난 일을 다시 꺼내지 말고 두 문단으로만 말해줘.';

function messages(rows) { return rows.map(([role, content]) => ({ role, content })); }
function entries(rows) {
  return messages(rows).map((message, index) => ({
    messageId: `episode-${index + 1}`, runId: `episode-run-${index + 1}`,
    message,
  }));
}
function parseJson(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try { return JSON.parse(cleaned); } catch { return null; }
}
function assessState(value) {
  if (!value || typeof value !== 'object') return { passed: false, reasons: ['invalid_json'] };
  const focus = String(value.currentFocus ?? '');
  const accepted = JSON.stringify(value.acceptedDecisions ?? []);
  const closed = JSON.stringify(value.closedIssues ?? []);
  const prohibited = JSON.stringify(value.prohibitedActions ?? []);
  const settled = `${accepted}\n${closed}\n${prohibited}`;
  const next = String(value.nextAction ?? '');
  const checks = {
    currentFocus: /v4|장기대화.*(?:시험|검증)|Interaction Core/iu.test(focus),
    acceptedBoundary: /session-only|세션.*로그인|로그인.*(?:재요구|다시.*필요|경계)/iu.test(settled),
    acceptedP0: /P0.*(?:완료|Telegram)|Telegram.*(?:완료|재설치)/iu.test(settled),
    closedSecurity: /보안/iu.test(settled),
    closedPackage: /패키지|0\.1\.3|공증/iu.test(settled),
    closedDaemon: /daemon|데몬/iu.test(settled),
    prohibitPackageMutation: /0\.1\.3.*(?:수정|변경)|인증.*패키지.*(?:수정|변경)/iu.test(prohibited),
    prohibitReopen: /보안|패키지/iu.test(prohibited),
    prohibitDaemon: /daemon|데몬/iu.test(prohibited),
    nextLongConversation: /장기대화.*(?:시험|검증)|v4.*(?:시험|검증)|현재 초점.*(?:시험|검증)/iu.test(next),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
function assessNatural(text) {
  const paragraphs = String(text ?? '').trim().split(/\n\s*\n/u).filter(Boolean);
  return {
    passed: paragraphs.length <= 2
      && /현재|맥락|주제|교정|초점|이어/u.test(String(text))
      && !/Host|Origin|서명|공증|daemon|데몬|제거.*재설치/iu.test(String(text)),
    paragraphs: paragraphs.length,
  };
}

const sourceConnection = resolve(process.env.T5_INTERACTION_COMPARISON_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json'));
const targetConnectionId = String(process.env.T5_INTERACTION_COMPARISON_CONNECTION_ID ?? '').trim();
const modes = String(process.env.T5_INTERACTION_COMPARISON_MODES ?? 'off,v4')
  .split(',').map((value) => value.trim()).filter(Boolean);
const room = await mkdtemp(join(tmpdir(), 't5-interaction-long-'));
const connectionFile = join(room, 'model-connection.json');
const stateDir = join(room, 'state');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await cp(sourceConnection, connectionFile, { force: false });
if (targetConnectionId) {
  const service = makeModelConnectionService({ file: connectionFile });
  await service.activate(targetConnectionId);
  service.close();
}
const computer = publicComputerFacts(discoverComputerEnvironment({ userHome: homedir() }));
const access = makeConsoleModelAccess({ connectionFile, stateDir });

async function modelFor(mode, sessionId, instructionsOverride = null) {
  return access.model({
    sessionId, workspace: homedir(), computer,
    instructionsOverride: instructionsOverride
      ?? consoleInstructions(homedir(), computer, { interactionCoreMode: mode }),
  });
}
async function respond(mode, context, probe, sessionId) {
  const model = await modelFor(mode, sessionId);
  const startedAt = Date.now();
  const response = await model.respond({ messages: [...context, { role: 'user', content: probe }], tools: [] });
  return { text: String(response.text ?? ''), durationMs: Date.now() - startedAt, usage: response.usage ?? null };
}

try {
  const conversation = { entries: entries(episode), checkpoints: [] };
  const plan = planConversationCheckpoint({
    conversation, currentRequest: stateProbe, projectedMessages: messages(episode),
    triggerBytes: 1, tailBytes: 2_000,
  });
  const checkpointModel = await modelFor(
    'off', 'checkpoint', CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS,
  );
  const checkpoint = await summarizeConversationCheckpoint(plan, {
    chunkBytes: 2_500,
    summarize: async ({ prompt }) => {
      const response = await checkpointModel.respond({ messages: [{ role: 'user', content: prompt }], tools: [] });
      return response.text;
    },
  });
  const full = messages(episode);
  const compressed = [
    { role: 'assistant', content: `[CONVERSATION CHECKPOINT — system-generated continuity state]\n${checkpoint.summary}` },
    ...plan.tailEntries.map((entry) => entry.message),
  ];
  const results = [];
  for (const context of [
    { id: 'full', messages: full },
    { id: 'checkpoint', messages: compressed },
  ]) {
    for (const mode of modes) {
      const state = await respond(mode, context.messages, stateProbe, `${context.id}-${mode}-state`);
      results.push({
        context: context.id, mode, kind: 'state', ...state,
        assessment: assessState(parseJson(state.text)),
      });
    }
  }
  for (const context of [
    { id: 'full', messages: full },
    { id: 'checkpoint', messages: compressed },
  ]) {
    const natural = await respond('v4', context.messages, naturalProbe, `${context.id}-v4-natural`);
    results.push({ context: context.id, mode: 'v4', kind: 'natural', ...natural, assessment: assessNatural(natural.text) });
  }
  const status = await access.status();
  process.stdout.write(`${JSON.stringify({
    schema: 't5.interaction-long-conversation.v1', recordedAt: new Date().toISOString(),
    provider: status.provider, modelId: status.modelId,
    episodeTurns: episode.length, checkpoint: {
      sourceMessages: checkpoint.sourceMessageCount, tailMessages: checkpoint.tailMessageCount,
      chunks: checkpoint.chunks, summaryBytes: Buffer.byteLength(checkpoint.summary, 'utf8'),
    }, results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
