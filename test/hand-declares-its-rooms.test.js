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

test('선언에는 방 이름이 **박혀 있지 않다**(자리표시자로 남는다)', () => {
  const d = 파일선언(demoDescriptors({ include: ['local.file'] }));
  assert.ok(전문(d).includes('{방}'),
    '방 이름이 선언에 박혔다 — 설정이 다른 설치에서 그 문장이 그대로 모델에게 간다');
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
test('라이브 배선: 실제 `GPAO_T5_FILE_ROOTS` 가 능력 문장에 나타난다', async () => {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'rooms-')));
  const { descriptors } = await liveDeps({
    GPAO_T5_FILE_ROOTS: 방,
    GPAO_T5_DATA_DIR: 방,
    GPAO_T5_HOME: 방,
  });
  const d = 파일선언(descriptors);
  assert.ok(d, '파일 손 선언이 없다');
  assert.doesNotMatch(전문(d), /\{방\}/, '라이브 경로에서 자리표시자가 안 채워졌다');
  const 방이름 = 방.split('/').filter(Boolean).at(-1);
  assert.ok(전문(d).includes(방이름),
    `실제 방(${방이름})이 능력 문장에 없다 — 모델은 어디를 다룰 수 있는지 모른 채 추측한다: ${String(d.capability).slice(0, 160)}`);
});
