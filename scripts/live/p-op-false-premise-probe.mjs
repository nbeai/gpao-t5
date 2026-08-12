#!/usr/bin/env node
// **거짓 전제 탐침**(원인 ③ · 2026-08-10) — 평서문 거짓 전제에 모델이 `work.state` 로
// 무엇을 제출하는지 잰다. 입장 경계를 구조로 세우려면 **모델이 실제로 내는 모양**을 알아야
// 한다(문장부호로 가르는 것은 문구 층 판정 — 이 저장소가 세 번 진 방법).
//
// 제품 코드 0줄. 격리 HOME · 실사용 자리 불가침. 원본 전량 커밋.
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODEL_ID = 'gpt-5.1';

function readCredential(home) {
  const j = JSON.parse(readFileSync(join(home, '.local/state/gpao-t5/sessions/model-connection.json'), 'utf8'));
  const c = (j.connections ?? []).find((x) => x.id === j.activeId) ?? j.connections?.[0];
  if (!c?.key || c.provider !== 'openai') throw new Error('openai API key 연결이 필요하다');
  return { key: c.key, baseUrl: String(c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') };
}

const 발화들 = [
  { id: 'declarative-a', text: '그거 포함하기로 했잖아.' },
  { id: 'declarative-b', text: '아까 그렇게 정했으니 그대로 가자.' },
  { id: 'declarative-c', text: '단순 변심도 급한 문의에 포함한다고 했지.' },
  { id: 'question', text: '단순 변심도 급한 문의에 포함한다고 했지?' },
  { id: 'genuine-new', text: '단순 변심은 일반 문의로 두자.' },
  { id: 'genuine-change', text: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.' },
];

const BRIEF = [
  '[현재 합의] 문의는 스마트스토어랑 인스타 DM 두 곳에서 들어와.',
  '- 처음에는 오전 9시와 오후 5시에 확인하는 걸로 생각했어.',
  '- 급한 문의는 배송 지연, 오배송, 환불 요청으로 보자.',
  '- 답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.',
].join('\n');

async function main() {
  if (!process.argv.includes('--run')) throw new Error('--run 없이는 모델을 호출하지 않는다');
  const outIndex = process.argv.indexOf('--output');
  if (outIndex < 0) throw new Error('--output 이 필요하다');
  const output = resolve(process.argv[outIndex + 1]);
  const treeIndex = process.argv.indexOf('--t5-tree');
  const tree = await realpath(resolve(treeIndex >= 0 ? process.argv[treeIndex + 1] : process.cwd()));

  const credential = readCredential(homedir());
  const room = await realpath(await mkdtemp('/tmp/p-op-fp-'));
  const home = join(room, 'home');
  await mkdir(home, { recursive: true });

  const processEnv = {
    ...process.env,
    HOME: home,
    GPAO_T5_HOME: home,
    GPAO_T5_DATA_DIR: join(room, 'state'),
    GPAO_T5_MODEL_PROVIDER: 'openai',
    OPENAI_API_KEY: credential.key,
    GPAO_T5_MODEL_BASE_URL: credential.baseUrl,
    GPAO_T5_MODEL_ID: MODEL_ID,
    GPAO_T5_MODEL_TIMEOUT_MS: '0',
    GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0',
  };
  const imp = (rel) => import(pathToFileURL(join(tree, rel)).href);
  const [providerModule, controlModule] = await Promise.all([
    imp('src/runtime/model-provider.js'),
    imp('src/kernel/l2-plan/model-control.js'),
  ]);
  const { model } = providerModule.selectLiveModel(processEnv);
  const schema = controlModule.MODEL_CONTROL_SCHEMAS.find((s) => s.name === 'work.state');
  if (!schema) throw new Error('work.state 스키마를 찾지 못했다');

  const probes = [];
  try {
    for (const 발화 of 발화들) {
      const out = await model.respond({
        currentRequest: 발화.text,
        workStateSettlement: {
          deliveryCandidate: '단순 변심은 아직 급한 문의에 포함하지 않았어요. 지금 정해 주세요.',
          receipts: { confirmed: [], unconfirmed: [], estimated: [] },
          currentWorkBrief: BRIEF,
        },
      }, { effort: 'medium', tools: [schema], requiredTool: 'work.state' });
      const calls = typeof out === 'string' ? [] : (out?.toolCalls ?? []);
      const proposal = calls.find((c) => c?.name === 'work.state')?.args ?? null;
      probes.push({ ...발화, proposal });
      process.stderr.write(`[probe] ${발화.id} 완료\n`);
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({
      purpose: '거짓 전제 — 모델이 work.state 로 내는 실제 모양(원인 ③)',
      testedAt: new Date().toISOString(),
      model: { provider: 'openai', modelId: MODEL_ID },
      brief: BRIEF,
      probes,
    }, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, output, probes: probes.length }, null, 2));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`ERROR: ${e?.stack ?? e}`); process.exitCode = 1; });
