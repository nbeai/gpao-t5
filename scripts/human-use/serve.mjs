// 사람 사용시험용 **격리 서버**를 띄운다.
//
// 하네스 계약(`verify-evidence.mjs`)이 요구하는 것 셋을 여기서 만든다:
//   · `isolated: true`   — 오너의 실제 데이터·홈을 건드리지 않는다(`prepare.mjs` 가 만든 방 안에서만)
//   · `actualModel`       — 스텁 금지. 오너가 화면에서 이미 연결해 둔 자격을 그대로 쓴다
//   · `actualBrowser`     — 이 스크립트는 문만 연다. 사용자 행동은 실제 브라우저가 한다
//
// **자격 값은 어디에도 찍지 않는다.** 화면·로그·증거 파일에 모두 안 나간다.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { 저장된연결 } from '../s1/run.mjs';
import { 격리증명 } from './prove-isolation.mjs';
import { startLiveServer } from '../../src/surface/server.js';

const 증거경로 = process.argv[2];
if (!증거경로) {
  console.error('usage: node scripts/human-use/serve.mjs <evidence.json> [port]');
  process.exit(1);
}
const 포트 = Number(process.argv[3] ?? 4173);

const 증거 = JSON.parse(await readFile(증거경로, 'utf8'));
const { root, stateDir, fixtureDir } = 증거.environment;

const 연결 = 저장된연결();
if (!연결) {
  console.error('저장된 모델 연결이 없다. 오너가 T5 화면에서 연결한 뒤 다시 돌린다.');
  process.exit(2);
}

const 커밋 = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// ── **격리를 증명하기 전에는 문을 열지 않는다** ────────────────────────────
//
// 사고 2026-08-04: 여기서 env 만 넘기고 "격리됨"이라고 **선언했다.** 실제로는 터미널 손의
// 기본 자리가 오너의 진짜 홈이었고, 시험 중 T5 가 오너의 `~/Documents` 목록을 냈다.
// 선언과 사실이 갈렸는데 갈린 채로 문이 열렸다. **선언은 증명이 아니다.**
const 증명 = await 격리증명({ root, fixtureDir, stateDir });
for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
if (!증명.ok) {
  console.error('\nISOLATION: FAIL — 문을 열지 않는다.');
  process.exit(3);
}
console.error('ISOLATION: PASS (홈 기준 경로까지. 절대경로는 막지 않는다 — 대본이 안 쓴다)\n');

// `homedir()` 은 **이 프로세스의 env** 를 본다 — 서버에 넘기는 사본으로는 안 바뀐다.
process.env.HOME = root;

const server = await startLiveServer({
  port: 포트,
  processEnv: {
    // **진짜 `HOME` 을 격리 루트로.** `GPAO_T5_HOME` 은 T5 의 개념적 홈이고, 터미널 손의
    // 기본 자리는 `homedir()` — 프로세스의 `HOME` 이다. 이걸 안 바꿔서 사고가 났다.
    HOME: root,
    GPAO_T5_DATA_DIR: stateDir,
    GPAO_T5_HOME: root,
    // 파일 손의 방은 **고정판 폴더 하나뿐**이다 — 오너 파일 접촉 0.
    GPAO_T5_FILE_ROOTS: fixtureDir,
    ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
    ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
    GPAO_T5_MODEL_ID: 연결.modelId,
  },
});

console.log(JSON.stringify({
  ok: true,
  url: `http://127.0.0.1:${server.address().port}`,
  provider: 연결.provider,
  model: 연결.modelId,
  productCommit: 커밋,
  root,
  fixtureDir,
}, null, 2));
