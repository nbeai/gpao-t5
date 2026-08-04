// **손이 자기 방을 말한다** — 능력 문장의 폴더 이름은 설정에서 나온다, 선언에 박히지 않는다.
//
// 라이브 실측(2026-08-04, 사람 사용시험 selfhood 계열 · 실제 브라우저 · gpt-5.1):
//   사용자 "네가 지금 실제로 다룰 수 있는 폴더 경로를 정확히 알려줘"
//   T5    "사용자의 홈 디렉터리 전체 — ~/Desktop, ~/Documents, ~/Downloads, ~/Pictures 등"
//   사용자 "~/Documents 폴더 안에 뭐가 있는지 목록으로 보여줘"
//   T5    "지금 내가 직접 못 보는 자리라서… 시도했다가 '파일 도구의 작업 폴더 밖'이라 막혔어"
//
// 그 설치의 방은 **고정판 폴더 하나뿐**이었다. 거짓 성공은 아니다 — 시도했고 막혔고 정직하게
// 말했다. 하지만 **능력 진술이 실제 범위와 달랐고**, 사용자는 못 할 일을 부탁하는 데 한 턴을 썼다.
//
// ── 모델이 지어낸 게 아니다 ────────────────────────────────────────────────
// 원인은 선언에 있었다: `capability` 에 "작업 폴더와 Downloads·Documents·Desktop" 이 **박혀**
// 있었고 `GPAO_T5_FILE_ROOTS` 를 읽지 않았다. **우리가 틀린 사실을 줬고 모델은 그대로 옮겼다.**
// 지금까지 잡아 온 병과 같은 모양이다 — 런타임이 아는 사실이 모델에게 안 가면, 또는 틀린 채로
// 가면, 그 빈칸은 사용자에게 그대로 나간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoDescriptors } from '../src/surface/demo-context.js';
import { liveDeps } from '../src/surface/live-context.js';

const 파일선언 = (ds) => ds.find((d) => d.id === 'local.file');
const 전문 = (d) => JSON.stringify(d);

// 하드코딩 여부는 **자리표시자가 보이는가**로 재지 않는다(그건 새는 것이 정상이라는 뜻이 된다).
// **다른 방을 주면 다른 문장이 나오는가** — 그게 "설정에서 나온다"의 기계적 정의다.
test('선언에는 방 이름이 **박혀 있지 않다**(방을 바꾸면 문장이 바뀐다)', () => {
  const 가 = 파일선언(demoDescriptors({ include: ['local.file'], rooms: '가방' }));
  const 나 = 파일선언(demoDescriptors({ include: ['local.file'], rooms: '나방' }));
  assert.notEqual(String(가.capability), String(나.capability),
    '방을 바꿔도 능력 문장이 같다 — 폴더 이름이 선언에 박혀 있다');
  assert.match(String(가.capability), /가방/);
  assert.match(String(나.schema?.description ?? ''), /나방/,
    '능력 문장만 따라오고 스키마 설명은 안 따라온다 — 두 진실이 된다');
});

test('방을 주면 **그 방 이름으로** 채워진다', () => {
  const d = 파일선언(demoDescriptors({ include: ['local.file'], rooms: '고정판 폴더' }));
  assert.doesNotMatch(전문(d), /\{방\}/, '자리표시자가 안 채워진 채 모델에게 갔다');
  assert.match(String(d.capability), /고정판 폴더/);
  assert.match(String(d.schema?.description ?? ''), /고정판 폴더/,
    '능력 문장만 고치고 스키마 설명은 옛 방 이름을 그대로 말한다 — 두 진실이 된다');
});

test('방이 하나뿐인 설치에서 **다른 폴더를 말하지 않는다**', () => {
  const d = 파일선언(demoDescriptors({ include: ['local.file'], rooms: '고정판 폴더' }));
  for (const 없는방 of ['Downloads', 'Documents', 'Desktop', '다운로드', '바탕화면']) {
    assert.equal(전문(d).includes(없는방), false,
      `설정에 없는 폴더 "${없는방}" 이 능력 진술에 남아 있다 — 사용자가 못 할 일을 부탁하게 된다`);
  }
});

test('방 자리표시자가 없는 손은 건드리지 않는다(과잉 치환 금지)', () => {
  const 원본 = demoDescriptors({ include: ['local.terminal'] });
  const 채운것 = demoDescriptors({ include: ['local.terminal'], rooms: '고정판 폴더' });
  assert.deepEqual(채운것, 원본, '방과 무관한 손의 선언이 바뀌었다');
});

// ── 실제 배선까지 간다 — 단위검사는 배선이 끊겨도 초록이다 ──────────────────
// **재는 자리를 틀리면 초록인데 안 고쳐진다.** 첫 판은 `liveDeps` 가 돌려주는 `descriptors`
// 를 쟀고 통과했다. 그런데 모델이 실제로 읽는 것은 `buildSelfState(env)` → `modelSchemasFor`
// 이고, 그 `env.descriptors` 는 **방을 안 받은 채** 만들어지고 있었다. 라이브에서 답에
// `{방}` 이 글자 그대로 나온 뒤에야 알았다. 그래서 이 검사는 **모델 앞에 놓이는 것**을 잰다.
test('라이브 배선: 모델이 보는 스키마·능력에 **실제 방**이 나타난다', async () => {
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { modelSchemasFor } = await import('../src/kernel/l2-plan/model-control.js');
  const { mkdir } = await import('node:fs/promises');
  const 자리 = await realpath(await mkdtemp(join(tmpdir(), 'rooms-')));
  const 방 = join(자리, 'Downloads');
  await mkdir(방, { recursive: true });
  const { env } = await liveDeps({ GPAO_T5_FILE_ROOTS: 방, GPAO_T5_DATA_DIR: 자리, GPAO_T5_HOME: 자리 });
  const 자기상태 = buildSelfState(env);
  const 능력 = String(자기상태.connectedTools.find((t) => t.id === 'local.file')?.capability ?? '');
  const 스키마 = String(modelSchemasFor(자기상태).find((t) => t.name === 'local.file')?.description ?? '');
  for (const [이름, 글] of [['능력 문장', 능력], ['모델 스키마', 스키마]]) {
    assert.doesNotMatch(글, /\{방\}/, `${이름}에 자리표시자가 남았다 — 답에 그대로 새어 나간다`);
    assert.match(글, /다운로드/,
      `${이름}이 실제 방을 말하지 않는다 — 기본값으로 덮여 모델이 어디를 다루는지 모른다: "${글.slice(0, 90)}"`);
  }
});

// ── **자리표시자는 절대 밖으로 나가지 않는다** ──────────────────────────────
//
// 라이브 실측(2026-08-04 · 사람 사용시험): T5 의 답에 `{방}` 이 그대로 나갔다 —
//   "지금 이 **{방}** 말고 다른 자리(예: 외장하드, 구글 드라이브…)에 있는 경우"
//
// 방을 설정에서 채우도록 고쳤는데, **채우는 자리를 하나로 묶지 않았다.** `demoEnv` 와
// 서버의 다른 호출부는 `rooms` 없이 선언을 만들고, 그 선언이 자기상태를 거쳐 모델에게 갔다.
// 오늘 아침에 고친 것과 **같은 병**이다(§2-C: 한 자리에서 매듭을 묶지 않으면 어딘가에서 샌다).
//
// 그래서 계약을 뒤집는다: **rooms 를 안 주는 것이 허용되고, 대신 자리표시자가 남는 것이 금지다.**
test('rooms 를 안 줘도 **자리표시자가 남지 않는다**', () => {
  const 전문 = JSON.stringify(demoDescriptors());
  assert.doesNotMatch(전문, /\{방\}/,
    'rooms 없이 만든 선언에 자리표시자가 남았다 — 그대로 모델에게 가고 답에 새어 나온다');
});

test('자기상태 입력(demoEnv)에도 자리표시자가 없다', async () => {
  const { demoEnv } = await import('../src/surface/demo-context.js');
  assert.doesNotMatch(JSON.stringify(demoEnv()), /\{방\}/,
    'demoEnv 의 선언에 자리표시자가 남았다 — 라이브가 아닌 경로가 전부 여기로 온다');
});

test('rooms 를 주면 그 값이 이긴다(기본값이 실제 방을 덮지 않는다)', () => {
  const d = 파일선언(demoDescriptors({ include: ['local.file'], rooms: '고정판 폴더' }));
  assert.match(String(d.capability), /고정판 폴더/);
});
