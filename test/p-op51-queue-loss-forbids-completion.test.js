// ── 반대시험 ⑤ (계획서 §5-1 · F-68) — 큐 잔여 중의 새 호출은 증발하지 않는다 ──────
//
// 장부 F-68(등재 2026-08-11 · 재현 결정적): read 3건 배치의 첫 걸음만 끝난 시점의
// 모델 재호출에서 write 를 냈더니, 그 write 가 **실행도 카드도 blocked 영수증도 제안
// 기록도 없이** 사라졌다. 같은 write 가 걸음마다 하나씩(paced)일 때는 정상 관통한다.
//
// 낙하 지점(코드로 확인): `executePlan` 걸음 루프의 바닥 재호출 —
// `if (!대기호출.length) finalOut = await ctx.model.respond(...)` 가, **아직 아무도 안 걷은
// 호출을 실은 finalOut** 을 덮어쓴다. 큐(첫응답나머지)가 도는 동안 온 응답의 호출은
// 루프 머리(분리→줄세우기)에 한 번도 닿지 못한 채 다음 응답으로 갈아치워진다.
//
// 무는 계약: 「걸음은 증발하지 않는다 — 실행되거나, 카드가 뜨거나, 사유가 남는다」.
// 여기서는 가장 강한 형태로 잰다: **사용자 목적의 실물(write)이 실제로 선다.**
// paced 재현이 이미 그 관통을 증명했으므로, early 라고 결과가 달라지면 그게 결함이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const SOURCES = {
  '위생설비_지원공고.txt': '대상: 영업신고 후 1년 이상. 필수: 사업자등록증, 영업신고증.\n',
  '우리상황.txt': '지역 내 반찬가게. 영업신고 2024-03-10.\n',
  '보유서류.txt': '사업자등록증 있음. 영업신고증 있음.\n',
};

async function 자리() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'p-op51-f68-')));
  for (const [name, text] of Object.entries(SOURCES)) await writeFile(join(dir, name), text);
  return dir;
}

/**
 * F-68 의 early 대본 그대로: 첫 본선 응답이 read 3건 배치를 내고, 첫 걸음 뒤의 재호출
 * (계획 레인이 read 1건을 실행한 직후 · 큐에 read 2건 잔여)이 write 를 낸다.
 * 그 뒤의 재호출은 완료 문장만 낸다 — write 를 다시 내주지 않는다(구조가 받아야 한다).
 */
function early모델(dir, 산출물경로) {
  let main = 0;
  return {
    async respond(tc, options = {}) {
      if (tc.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      }
      if (tc.workStateSettlement) {
        return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      }
      if (!options.tools?.length) return '근거 준비표를 만들었어요.';
      main += 1;
      if (main === 1) {
        return { text: '', toolCalls: Object.keys(SOURCES).map((name) => (
          { name: 'local.file', args: { action: 'read', path: join(dir, name) } })) };
      }
      if (main === 2) {
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: 산출물경로, text: '보유: 사업자등록증 · 영업신고증\n',
        } }] };
      }
      return { text: '근거 준비표를 만들었어요.', toolCalls: [] };
    },
  };
}

test('반대시험 ⑤: 큐 잔여 중에 낸 write 는 증발하지 않는다 — 실물이 실제로 선다 (F-68 early)', async () => {
  const dir = await 자리();
  const 산출물경로 = join(dir, '신청준비표.md');
  const r = await runTurn(
    { text: '공고, 우리 상황, 보유서류를 읽고 근거 준비표를 기록해줘.' },
    {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
      model: early모델(dir, 산출물경로),
    },
  );
  assert.equal(r.kind, 'reply', `턴이 답으로 끝나지 않았다: ${r.kind}`);
  // 실물: 모델이 낸 write 가 실행됐다 — 증발의 정반대 사실.
  const 내용 = await readFile(산출물경로, 'utf8').catch(() => null);
  assert.ok(내용 !== null,
    '**큐 잔여 중에 낸 write 가 흔적 없이 사라졌다** — 실행도 카드도 사유 영수증도 없다 (F-68)');
  assert.match(내용, /사업자등록증/, `실물 내용이 모델이 낸 것과 다르다: ${내용}`);
});

test('반대시험 ⑤ 반례: 걸음마다 하나씩(paced) 낸 write 는 지금도 관통한다 — 이 관통이 기준선이다', async () => {
  const dir = await 자리();
  const 산출물경로 = join(dir, '신청준비표.md');
  const 이름들 = Object.keys(SOURCES);
  const model = {
    async respond(tc, options = {}) {
      if (tc.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      }
      if (tc.workStateSettlement) {
        return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      }
      if (!options.tools?.length) return '근거 준비표를 만들었어요.';
      const 읽은 = new Set((tc.turnExchange ?? [])
        .filter((x) => x.tool === 'local.file' && x.args?.action === 'read')
        .map((x) => String(x.args.path)));
      const 다음 = 이름들.find((name) => !읽은.has(join(dir, name)));
      if (다음) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: join(dir, 다음) } }] };
      }
      if (!(tc.turnExchange ?? []).some((x) => x.args?.action === 'write')) {
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: 산출물경로, text: '보유: 사업자등록증 · 영업신고증\n',
        } }] };
      }
      return { text: '근거 준비표를 만들었어요.', toolCalls: [] };
    },
  };
  const r = await runTurn(
    { text: '공고, 우리 상황, 보유서류를 읽고 근거 준비표를 기록해줘.' },
    {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
      model,
    },
  );
  assert.equal(r.kind, 'reply');
  const 내용 = await readFile(산출물경로, 'utf8').catch(() => null);
  assert.ok(내용 !== null, 'paced 기준선이 무너졌다 — early 판정 이전에 재현 대본부터 다시 본다');
});
