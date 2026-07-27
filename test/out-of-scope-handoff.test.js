// **T5 가 할 수 있는 일을 사용자에게 떠넘기지 않는다** (역량 명제 ④).
//
// 라이브 실측(c217a0c6, 2026-07-27) — 사용자가 "작업용SSD"라고 답한 턴:
//   local.locate  → /Volumes/작업용SSD/2026 정산자료 를 찾았다
//   local.file    → 막힘: "지금은 ~/GPAO-T5 안에서만 다룰 수 있어요. **그 폴더로 옮기거나** …"
// 그래서 T5 가 답했다: *"외장하드 안 파일을 바로 열지는 못해요. 폴더를 통째로 복사해 주세요."*
// **거짓이었다.** 바로 다음 턴에 터미널로 그 파일 4개를 전부 읽었다.
//
// 병은 둘이었다:
//   ① 도구가 사용자에게 파일을 옮기라고 시켰다(한 손의 범위를 T5 전체의 한계로 말했다)
//   ② 커널이 **막힌 한 손의 다음 길**을 턴 전체의 다음 길로 올렸다 — 다른 손이 성공했는데도
//
// 이 검사는 **문구 목록을 외우지 않는다.** 모델 앞에 놓이는 현실(recoveryHint)과 사용자에게
// 보이는 줄(nextSafeAction)에 "네가 옮겨라"가 섞이는지만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { outOfScopeMessage } from '../src/runtime/file-scope.js';

/** 사용자에게 일을 넘기는 말. 이게 나오면 T5 가 손이 있는데도 시킨 것이다. */
const 떠넘김 = /옮기|복사|이동|붙여넣|Finder|파인더|경로를 (알려|입력|적어)/i;

/** 모델을 흉내내되, **모델이 본 현실을 그대로 붙잡아 둔다.** */
function 붙잡는모델(calls) {
  const 본것 = [];
  let used = false;
  return {
    본것,
    async respond(tc, opts = {}) {
      본것.push(tc);
      if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
      return opts.tools?.length ? { text: '봤어요', toolCalls: [] } : '봤어요';
    },
  };
}

/** 홈 밖(외장 볼륨)에 자료가 있는 판. local.file 은 여기를 못 다루고, 다른 손은 다룬다. */
async function 범위밖자료() {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-홈-'));
  const vol = await mkdtemp(join(tmpdir(), 'gpao-t5-볼륨-'));
  const 자료 = join(vol, '작업용SSD', '2026 정산자료');
  await mkdir(자료, { recursive: true });
  for (const f of ['1분기-매입.xlsx', '1분기-매출.xlsx', '증빙.pdf']) await writeFile(join(자료, f), 'x');
  return { home, vol, 자료 };
}

test('범위 밖 안내 자체가 사용자에게 옮기라고 시키지 않는다', () => {
  const m = outOfScopeMessage({ roots: ['/어딘가/작업폴더'] });
  assert.doesNotMatch(m.userSafeSummary, 떠넘김, `막힌 사실이 떠넘김이 됐다: ${m.userSafeSummary}`);
  assert.doesNotMatch(m.nextSafeAction ?? '', 떠넘김, `다음 길이 떠넘김이 됐다: ${m.nextSafeAction}`);
});

test('한 손이 범위 밖으로 막혀도, 다른 손이 해낸 턴은 "옮겨 달라"로 끝나지 않는다', async () => {
  const { home, vol, 자료 } = await 범위밖자료();
  const model = 붙잡는모델([
    { name: 'local.locate', args: { what: '정산 자료', from: '작업용SSD' } },
    { name: 'local.file', args: { action: 'list', path: 자료 } },
  ]);
  const r = await runTurn({ text: '작업용SSD' }, {
    env: demoEnv(),
    model,
    // 파일 손은 홈 안만 다룬다 — 외장 볼륨은 그 밖이다(라이브와 같은 판).
    tools: demoTools({
      localLocate: makeLocalLocateTool({ home, volumesDir: vol }),
      localFile: makeLocalFileTool({ roots: [home], dataDir: home }),
    }),
  });

  // 판이 실제로 그 모양이었는지 먼저 확인한다 — 아니면 이 검사는 아무것도 안 본 것이다.
  const 원장 = r.ledger?.confirmed?.join(' ') ?? '';
  const 막힌것 = (r.ledger?.unconfirmed ?? []).join(' ');
  assert.match(원장, /정산자료/, `다른 손이 못 찾았다 — 이 판은 검사 대상이 아니다: ${원장}`);
  assert.ok(막힌것, `범위 밖으로 막힌 손이 없다 — 이 판은 검사 대상이 아니다: ${JSON.stringify(r.ledger)}`);

  // ① 모델 앞에 놓인 현실에 "네가 옮겨라"가 없어야 한다.
  const 힌트들 = model.본것.map((tc) => tc?.recoveryHint).filter(Boolean);
  for (const h of 힌트들) assert.doesNotMatch(h, 떠넘김, `모델에게 떠넘김을 사실로 줬다: ${h}`);
  // ② 사용자에게 보이는 줄도 마찬가지.
  assert.doesNotMatch(r.nextSafeAction ?? '', 떠넘김, `화면에 떠넘김이 나갔다: ${r.nextSafeAction}`);
});

test('모든 손이 막힌 턴에서도 사용자에게 옮기라고 하지 않는다', async () => {
  const { home, vol, 자료 } = await 범위밖자료();
  const model = 붙잡는모델([{ name: 'local.file', args: { action: 'list', path: 자료 } }]);
  const r = await runTurn({ text: '그 폴더 봐줘' }, {
    env: demoEnv(),
    model,
    tools: demoTools({
      localLocate: makeLocalLocateTool({ home, volumesDir: vol }),
      localFile: makeLocalFileTool({ roots: [home], dataDir: home }),
    }),
  });
  const 힌트들 = model.본것.map((tc) => tc?.recoveryHint).filter(Boolean);
  assert.ok(힌트들.length, '막혔는데 다음 길을 아예 안 줬다 — 막다른 답이 된다');
  for (const h of 힌트들) assert.doesNotMatch(h, 떠넘김, `모델에게 떠넘김을 사실로 줬다: ${h}`);
  assert.doesNotMatch(r.nextSafeAction ?? '', 떠넘김, `화면에 떠넘김이 나갔다: ${r.nextSafeAction}`);
});
