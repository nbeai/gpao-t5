// ── 반대시험 ⑦ (계획서 §5-1) — 답을 회수한 뒤 실제 다음 실행으로 이어진다 ──────────
//
// 회수가 끝이 아니다. 출구에서 말만 고치게 하면 **발화 2/2 · 행동 0/2**(주석 실측)이 된다 —
// 그래서 검증이 손이 살아 있는 걸음 루프 안에도 한 벌 서 있다(`완료검증이어가기` ·
// 비교군 축: Hermes verification_stop.py:205-212 — 목표 미달이면 손을 쥔 채 재개).
//
// 이 검사가 무는 관통: 원장 밖 실물을 부른 완료 주장 → 같은 원장·같은 자로 회수 →
// 모델이 손을 고르면 **그 손이 실제로 실행되어 영수증과 실물이 선다** → 그 뒤의 답이
// 원장과 일치해 나간다. 회수(불일치 사실 공급)만 확인하고 실행을 안 확인하면 반쪽이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('반대시험 ⑦: 회수를 받은 모델이 고른 손이 실제로 실행된다 — 회수가 끝이 아니다', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'p-op51-recall-')));
  await writeFile(join(dir, '원장.txt'), '7월 매출 120\n');
  const 산출물경로 = join(dir, '결과정리.md');
  let 회수받음 = 0;
  let main = 0;
  const model = {
    async respond(tc, options = {}) {
      if (tc.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (tc.workStateSettlement) {
        return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      }
      if (tc.completionMismatch && options.tools?.length) {
        // 회수 — 원장의 불일치 사실을 받고, 이번엔 실제 손을 고른다.
        회수받음 += 1;
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: 산출물경로, text: '7월 매출 120\n',
        } }] };
      }
      if (!options.tools?.length) return '결과정리.md 에 저장했어요.';
      main += 1;
      if (main === 1) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: join(dir, '원장.txt') } }] };
      }
      if ((tc.turnExchange ?? []).some((x) => x.tool === 'local.file' && x.args?.action === 'write')) {
        return { text: '결과정리.md 에 저장했어요.', toolCalls: [] };
      }
      // 읽기만 해 놓고 원장에 없는 실물을 결과로 부른다 — 회수 대상 답.
      return { text: '정리해서 결과정리.md 에 저장해 뒀어요.', toolCalls: [] };
    },
  };
  const r = await runTurn(
    { text: '원장.txt 내용을 정리해줘.' },
    {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
      model,
    },
  );
  assert.equal(r.kind, 'reply', `턴이 답으로 끝나지 않았다: ${r.kind}`);
  assert.ok(회수받음 >= 1, '**회수(원장 불일치 사실 + 손)가 모델에게 가지 않았다**');
  const 내용 = await readFile(산출물경로, 'utf8').catch(() => null);
  assert.ok(내용 !== null, '**회수는 갔는데 모델이 고른 write 가 실행되지 않았다** — 회수가 끝이 됐다');
  assert.match(내용, /7월 매출 120/, `실물 내용이 모델이 낸 것과 다르다: ${내용}`);
  assert.match(String(r.reply ?? ''), /결과정리\.md/, `실행 뒤의 답이 실물을 가리키지 않는다: ${r.reply}`);
});
