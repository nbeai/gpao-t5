// ④ 자기 산출물 배치(§7-bn) — **내가 만든 것의 자리가 다음 판단에 간다** (선빨강 · 계측 재현)
//
// 3재판 누적 실물: u5 압축이 백업본을 백업 폴더 **밖**에 만드는 회차가 반복(세대1 R1·2차 R1·3차 R2)
// → u10 "백업 폴더는 압축본만" 전제 파괴. 검문 확정: 사실 줄(working-state:257 「이 작업에서
// 만든 결과물 파일」)은 있는데 배선이 **local.file:write 전용**(turn.js 산출물영수증들) —
// 백업 폴더는 bulk_copy 로, 압축본은 터미널로 만들어져 그 줄에 실릴 길이 구조적으로 없다.
// 수리 형태(검문 고정): 원장의 이번-작업 산출물 경로를 **손 종류 차별 없이** 잇는다.
// 자리는 여전히 모델이 고른다 — 「백업」·「압축」 낱말·기본 배치가 코드에 생기면 즉시 중단(§9 R2b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function 방() {
  const d = await mkdtemp(join(tmpdir(), 'artifact-'));
  await mkdir(join(d, '시작문서'), { recursive: true });
  await writeFile(join(d, '시작문서', 'a.md'), 'hello');
  return d;
}
/** FILE 계약 + bulk_copy 한 걸음 — 3재판 u1 의 실제 모양(원장 실측: 백업은 bulk_copy 로 생긴다). */
const 복사모델 = (자리) => {
  let 골랐다 = false;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) {
        골랐다 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'bulk_copy', path: join(자리, '시작문서'), to: join(자리, '백업') } }] };
      }
      return { text: '복사해 뒀어요.', toolCalls: [] };
    },
  };
};

test('★ 선빨강 — bulk_copy 로 만든 산출물 자리가 상태(결과물 줄)에 선다', async () => {
  const 자리 = await 방();
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: 자리 }) });
  const r = await runTurn({ text: '시작문서 md 를 백업 폴더에 복사해 둬' }, { env: demoEnv(), tools, model: 복사모델(자리) });
  const 상태글 = JSON.stringify([r.workingState ?? null, r.contextShown ?? null]);
  assert.ok(상태글.includes('백업'),
    '**bulk_copy 산출물이 결과물 줄에 안 선다** — 배선이 write 전용이라, 다음 턴(압축)의 모델은 '
    + '자기가 방금 만든 백업 폴더의 존재를 상태로 못 받는다. 그래서 압축본이 밖에 생기고 '
    + 'u10 전제가 깨진다(3재판 반복 실물)');
});

test('보존 — write 경로는 지금처럼 선다 (기존 배선 불변 닻)', async () => {
  const 자리 = await 방();
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: 자리 }) });
  let 골랐다 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) { 골랐다 = true; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: join(자리, '메모.md'), text: '적음' } }] }; }
      return { text: '적어 뒀어요.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '메모 하나 적어줘' }, { env: demoEnv(), tools, model });
  assert.ok(JSON.stringify([r.workingState ?? null, r.contextShown ?? null]).includes('메모.md'),
    'write 산출물 줄이 사라졌다 — 넓히다 기존 배선을 끊었다');
});
