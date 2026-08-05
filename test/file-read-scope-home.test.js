// **"내 컴퓨터"는 내 컴퓨터다 — 읽기는 홈까지, 파괴는 그대로 좁게.**
//
// 오너 실사용(2026-08-05): `내 컴퓨터에서 지침.md 파일 찾아서 읽어줘` 에 T5 가 도큐먼트
// 밖으로 나가지 못했다. 테스트 때부터 계속 그랬다 — 우연이 아니라 **네 폴더에 갇혀 있었다.**
//
// ── 그 울타리는 안전을 지키지 않았다 ──────────────────────────────────────
// 같은 파일 하나로 드러난 기계 사실:
//   `local.file`     /Users/jyp/Developer/t5-p-op/package.json → 막힘
//   `local.terminal` 같은 파일                                  → 읽힘
// **우회되는 울타리는 위험을 못 막고 사용자가 시킨 일만 막는다.** 안전 장치가 아니라 능력 손실이다.
//
// 그리고 옳은 규칙은 이미 서 있었다 — `local-file.js:387` 이 그렇게 적어 뒀다:
//   *"**범위 안이어도 보호 영역은 막는다.** 루트를 넓혀도 여기는 안 열린다 —
//     안전이 '좁은 루트'에서 나오던 구조를 대체하는 자리다."*
// 넓히기만 안 했다. 터미널은 이미 그 규칙 하나로 돈다. **두 손을 같은 선에 세운다.**
//
// §10 규율 12 — 개수가 아니라 **계약**:
//   "루트 목록에 홈을 넣는다"(모양) ❌
//   → **"홈 안은 읽는다 · 보호 자리는 읽기도 막는다 · 파괴 권한은 한 뼘도 안 넓어진다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function 무대() {
  // macOS 의 `/var` 는 `/private/var` 심볼릭이다 — realpath 로 안 잡으면 홈과 실제 경로가
  // 달라져 제품이 아니라 무대가 막는다(2026-08-05 밟음).
  const home = await realpath(await mkdtemp(join(tmpdir(), 't5-scope-')));
  for (const d of ['GPAO-T5', 'Documents', 'Downloads', 'Desktop', 'Developer/프로젝트', 'Music']) {
    await mkdir(join(home, d), { recursive: true });
  }
  await writeFile(join(home, 'Documents', '안쪽.md'), '안쪽 내용', 'utf8');
  await writeFile(join(home, 'Developer', '프로젝트', '바깥.md'), '바깥 내용', 'utf8');
  await writeFile(join(home, 'Music', '노래목록.txt'), '목록', 'utf8');
  const roots = ['GPAO-T5', 'Downloads', 'Documents', 'Desktop'].map((d) => join(home, d));
  return { home, roots, tool: makeLocalFileTool({ homeDir: home, roots }) };
}

const 읽기 = async (t, path) => t.handler({ action: 'read', path });
const 막혔나 = (r) => Boolean(r?.blocked) || Boolean(r?.error);

test('① **네 폴더 밖이어도 홈 안이면 읽는다** — "내 컴퓨터"가 말 그대로 동작한다', async () => {
  const { home, tool } = await 무대();
  for (const p of [join(home, 'Developer', '프로젝트', '바깥.md'), join(home, 'Music', '노래목록.txt')]) {
    const r = await 읽기(tool, p);
    assert.equal(막혔나(r), false,
      `**홈 안인데 못 읽었다**: ${p}\n`
      + `  ${r?.userSafeSummary ?? r?.error}\n`
      + '사용자가 "내 컴퓨터"라고 하면 그건 홈이다. 터미널로는 이미 읽히는 자리다.');
  }
});

test('② **보호 자리는 읽기도 막힌다** — 넓히기가 열쇠를 열지 않는다', async () => {
  const { home, tool } = await 무대();
  await mkdir(join(home, '.ssh'), { recursive: true });
  await writeFile(join(home, '.ssh', 'id_rsa'), 'KEY', 'utf8');
  const r = await 읽기(tool, join(home, '.ssh', 'id_rsa'));
  assert.equal(막혔나(r), true,
    '**열쇠 자리가 열렸다** — 안전은 좁은 루트가 아니라 보호 규칙이 지킨다는 계약이 무너진다');
});

// ── ③ **파괴도 사용자가 시키면 한다 — 막는 것은 울타리가 아니라 승인이다** ──────
//
// 오너 지시(2026-08-05): *"쓰기/이동/삭제는 사용자 지시에 그렇게 하라는 내용이 있으면 하면
// 되는 거고, 그 외 다른 지시를 수행하다 그게 필수적으로 필요해지면 사용자에게 승인을 요청하면
// 되는 거고, 그게 반복되면 학습으로 올리면 되는 거다."*
//
// 그 기계는 **이미 다 있다.** 시킨 파괴는 발화 안이라 그대로 돌고(휴지통), 안 시킨 파괴는
// `발화밖파괴` 가 승인 카드로 올리며(오늘 S6-c 6번), 반복은 `허락한손`·자동화 제안이 받는다.
// **울타리는 그 위에 덧댄 중복이었고, 그래서 사용자가 시킨 일까지 막았다.**
// 여기 남는 절대선은 하나다 — **보호 자리는 쓰기도 막는다.**
test('③ **사용자가 시킨 파괴는 홈 어디서든 된다** — 울타리가 시킨 일을 막지 않는다', async () => {
  const { home, tool } = await 무대();
  const 밖 = join(home, 'Developer', '프로젝트', '바깥.md');
  const r = await tool.handler({ action: 'delete', path: 밖 }).catch((e) => ({ error: e.message }));
  assert.equal(막혔나(r), false,
    `**사용자가 시킨 삭제를 울타리가 막았다**: ${r?.userSafeSummary ?? r?.error}\n`
    + '안 시킨 파괴를 막는 것은 승인 경계의 일이고(발화밖파괴), 울타리가 대신 하면 시킨 일까지 막힌다.');
});

test('③-a **보호 자리는 쓰기도 막힌다** — 넓혀도 여기는 안 열린다', async () => {
  const { home, tool } = await 무대();
  // 비밀 **이름** 으로 잰다. `~/Library` 판정은 실제 홈 기준이라 가짜 홈에서는 안 걸린다 —
  // 그건 제품이 아니라 무대의 한계다(라이브에서는 실제 홈이므로 그대로 선다).
  await writeFile(join(home, 'Developer', '프로젝트', '.env'), 'TOKEN=x', 'utf8');
  const r = await tool.handler({ action: 'delete', path: join(home, 'Developer', '프로젝트', '.env') })
    .catch((e) => ({ error: e.message }));
  assert.equal(막혔나(r), true, '비밀이 담긴 파일이 삭제로 열렸다');
});

test('④ **홈 밖은 읽기도 막힌다** — 넓힘에 끝이 있다', async () => {
  const { tool } = await 무대();
  const r = await 읽기(tool, '/etc/hosts');
  assert.equal(막혔나(r), true, '홈 밖 시스템 자리가 읽혔다');
});

test('⑤ **승인 자격도 같은 선을 본다** — 읽기는 묻지 않고 쓰기는 범위를 본다', async () => {
  const { home, tool } = await 무대();
  const 밖 = join(home, 'Developer', '프로젝트', '바깥.md');
  const 읽기자격 = await tool.approvalEligibility({ action: 'read', path: 밖 });
  assert.notEqual(읽기자격?.allowed, false, '홈 안 읽기를 자격 단계에서 막았다');
  const 쓰기자격 = await tool.approvalEligibility({ action: 'delete', path: 밖 });
  assert.notEqual(쓰기자격?.allowed, false,
    '**홈 안 삭제를 자격 단계가 막았다** — 자격은 "지금 이 요청이 가능한가"이지 "해도 되는가"가 아니다.\n'
    + '해도 되는가는 승인 경계가 정한다(발화밖파괴·헌장 ②).');
});

test('⑥ **모델이 보는 설명이 실제 범위와 같다** — 되는 것을 안 된다고 말하지 않는다', async () => {
  // 설명은 손 객체가 아니라 **선언**에 있다 — 모델이 실제로 받는 그 자리를 잰다.
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { toolSchemasFor } = await import('../src/kernel/l2-plan/tool-schema.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const 설명 = String(toolSchemasFor(buildSelfState(demoEnv()))
    .find((t) => t.name === 'local.file')?.description ?? '');
  assert.ok(설명, 'local.file 설명이 없다');
  assert.match(설명, /읽기는[\s\S]*홈/,
    '**설명이 읽기 범위를 홈으로 말하지 않는다.** 모델은 설명을 보고 "그 자리는 못 본다"고\n'
    + '판단한다 — 범위를 넓혀도 설명이 그대로면 모델에게는 안 넓어진 것과 같다(S1 의 자리).\n'
    + `  설명: ${설명.slice(0, 160)}`);
  assert.match(설명, /지우기|삭제/,
    '파괴가 어디까지인지도 설명에 있어야 한다 — 사용자가 무엇을 허락하는지 알아야 한다');
});
