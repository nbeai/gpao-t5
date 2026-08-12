// **말귀 축 측정 러너** — 동결 규약(`T5-MALGUI-COMPARISON-PROTOCOL-2026-08-03-ko.md`)대로
// T5 를 8문항에 한 번씩 돌리고 **원시 응답을 손대지 않고** 적는다.
//
// ── 왜 러너를 만드나 ───────────────────────────────────────────────────────
// 2026-08-03 측정은 임시 실행이었다(원시 응답만 남고 재현 절차가 없다). 그 뒤 T5 가 크게
// 바뀌었고(심문 제거 · 손이 자기 방을 말함 · 표면이 받는 쪽을 말함 · 출구 그물 셋),
// **그 변화가 말귀를 올렸는지 내렸는지 아무도 모른다.** 같은 조건으로 다시 재려면 절차가 자산이어야 한다.
//
// ── 동결 조건을 그대로 지킨다(§3) ─────────────────────────────────────────
//   · 모델 `gpt-5.5` 고정 — 모델이 다르면 제품이 아니라 모델을 재게 된다
//   · **첫 턴만** — 말귀는 첫 응답에서 갈리고, 파괴적 행동이 안 끼어든다
//   · 격리 상태(`GPAO_T5_DATA_DIR`·`HOME`) · 문항 순서 고정 · 1회씩 · 재실행/최선 고르기 없음
//
// **채점하지 않는다.** 채점은 동결 기준표로 사람이 따로 한다 — 러너가 점수를 만들면
// 그 점수는 러너를 고칠 때마다 움직인다(§판정칸은 밟은 기계사실에서만).
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 저장된연결 } from '../s1/run.mjs';
import { startLiveServer } from '../../src/surface/server.js';

/** 동결 문항 8개 — 규약 §4. **여기서 바꾸지 않는다.** 바꾸면 8-03 과 비교가 끊긴다. */
export const 문항 = Object.freeze([
  '요즘 통장이 자꾸 비어. 뭐가 문제인지 알고 싶어.',
  '다음 주에 부모님 오시는데 뭘 준비해야 할지 모르겠어.',
  '회사에서 보고서 쓰라는데 뭘 써야 할지 감이 안 와.',
  '컴퓨터가 좀 느려진 것 같아.',
  '이번 달에 내가 뭐 했는지 기억이 안 나.',
  '아이 학원을 옮길지 고민이야.',
  '메일이 너무 쌓여서 손도 못 대겠어.',
  '매주 같은 자료를 정리하는데 이거 자동으로 안 되나?',
]);

const 모델고정 = 'gpt-5.5';   // 규약 §3. 바꾸면 8-03 과 같은 측정이 아니다.

// **불러오기만 해도 돌지 않는다.** 문항을 대조하려고 이 파일을 import 했다가 실측이
// 그대로 시작돼 6문항이 돌았다(실측 2026-08-04, 내 실수). 실행은 직접 부를 때만 한다.
const 직접실행 = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (!직접실행) { /* 문항만 쓰려고 불러온 것이다 */ } else {

const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다.'); process.exit(2); }

const root = await realpath(await mkdtemp(join(tmpdir(), 't5-malgui-')));
await mkdir(join(root, 'state'), { recursive: true });
await mkdir(join(root, 'GPAO-T5'), { recursive: true });
process.env.HOME = root;                      // 격리 — `~` 가 오너 홈으로 풀리지 않게

const server = await startLiveServer({
  port: 0,
  processEnv: {
    HOME: root, GPAO_T5_HOME: root,
    GPAO_T5_DATA_DIR: join(root, 'state'),
    GPAO_T5_FILE_ROOTS: join(root, 'GPAO-T5'),
    OPENAI_API_KEY: 연결.자격,
    ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
    GPAO_T5_MODEL_ID: 모델고정,
    GPAO_T5_TCELL: 'off',                     // 학습 축은 이 측정의 변수가 아니다
  },
});
const 주소 = `http://127.0.0.1:${server.address().port}`;
const 첫화면 = await fetch(`${주소}/`);
const 신분 = (첫화면.headers.get('set-cookie') ?? '').split(';')[0];
const 부르기 = async (경로, 몸) => (await fetch(`${주소}${경로}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(신분 ? { cookie: 신분 } : {}) },
  body: JSON.stringify(몸 ?? {}),
})).json();

const 결과 = [];
for (const [i, 물음] of 문항.entries()) {
  // **문항마다 새 대화** — 앞 문항이 다음 문항의 말귀를 돕지 않게(1회씩·독립).
  const s = await 부르기('/sessions');
  const 시작 = Date.now();
  const 답 = await 부르기('/turn', { sessionId: s.id, text: 물음 });
  const 초 = Math.round((Date.now() - 시작) / 100) / 10;
  결과.push({
    번호: i + 1, 문항: 물음, 초,
    kind: 답?.kind,
    답: String(답?.reply ?? 답?.question ?? ''),
    // 채점 재료가 아니라 **기계 사실**이다 — 나중에 같은 기준으로 다시 볼 수 있게.
    확인된사실수: (답?.ledger?.confirmed ?? []).length,
    미확인수: (답?.ledger?.unconfirmed ?? []).length,
  });
  console.log(`  ${i + 1}/8 · ${초}s · ${답?.kind} · ${String(답?.reply ?? '').length}자`);
}

await new Promise((r) => server.close(r));
await rm(root, { recursive: true, force: true });

const 초들 = 결과.map((r) => r.초).sort((a, b) => a - b);
const 중앙 = 초들[Math.floor(초들.length / 2)];
const 요약 = {
  잰날: new Date().toISOString().slice(0, 10),
  모델: 모델고정,
  완주: `${결과.filter((r) => r.답.trim()).length}/8`,
  중앙값초: 중앙,
  평균초: Math.round((초들.reduce((a, b) => a + b, 0) / 초들.length) * 10) / 10,
  최대초: 초들.at(-1),
};
console.log(`\n${JSON.stringify(요약, null, 1)}`);

const 나갈곳 = join(process.cwd(), 'docs/03-verification/evidence',
  `malgui-${요약.잰날}`, 'raw-answers-t5.json');
await mkdir(join(나갈곳, '..'), { recursive: true });
await writeFile(나갈곳, `${JSON.stringify({ 요약, 결과 }, null, 1)}\n`, 'utf8');
console.log(`\n원시 응답 → ${나갈곳}`);
console.log('채점은 동결 기준표로 사람이 한다 — 러너는 점수를 만들지 않는다.');
}
