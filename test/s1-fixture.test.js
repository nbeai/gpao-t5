// S1 fixture 계약 검사 — 동결 manifest(design/S1-EXPERIMENT-FREEZE-2026-08-04-ko.md §2)를
// 생성기가 실제로 지키는지, 그리고 회차 대조가 이동·손상을 실제로 가르는지 확인한다.
//
// 이 검사가 없으면 fixture 가 조용히 달라져 A/B 가 fixture 차이를 재게 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFixture, 대조 } from '../scripts/s1/make-fixture.mjs';

const 새자리 = () => mkdtempSync(join(tmpdir(), 't5-s1-fx-'));

test('fixture: 동결 분포를 그대로 만든다(총계·나이·크기·숨김·중복쌍)', () => {
  const home = 새자리();
  try {
    const { manifest } = makeFixture(join(home, 'Downloads'));
    const d = manifest.분포확인;
    assert.equal(d.총계, 437, '최상위 437개');
    assert.equal(manifest.하위파일개수, 23, '하위 파일은 437에 불포함');
    assert.equal(manifest.하위폴더, 6);

    // 나이 — 180일 초과 107은 사고 실측값이다(모델이 실제로 받았던 집계).
    assert.deepEqual(d.나이, {
      '180일초과': 107, '90~180': 68, '30~90': 96, '7~30': 88, '7일이내': 78,
    });
    assert.deepEqual(d.크기, {
      '0바이트': 6, '1KB미만': 180, '1KB~100KB': 190, '100KB~5MB': 55, '5MB초과': 6,
    });
    assert.equal(d.숨김, 5);
    assert.equal(d.중복쌍, 9);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('fixture: 계획한 확장자 개수를 지킨다(특수 이름도 예산에서 차감)', () => {
  const home = 새자리();
  try {
    const { manifest } = makeFixture(join(home, 'Downloads'));
    const ext = manifest.분포확인.확장자;
    // 첫 판은 특수 이름 39개를 예산 밖에서 넣어 .pdf 가 96 대신 86 이었다(실측 2026-08-04).
    assert.equal(ext['.pdf'], 96, '.pdf 96 — 특수 이름(중복쌍 27개 포함)이 예산에서 빠져야 한다');
    assert.equal(ext['.png'], 74);
    assert.equal(ext['.jpg'], 41);
    assert.equal(ext['.zip'], 28);
    assert.equal(ext['.hwp'], 8);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('fixture: 같은 seed 는 같은 437개를 만든다(결정성)', () => {
  const a = 새자리(); const b = 새자리();
  try {
    const x = makeFixture(join(a, 'Downloads')).manifest;
    const y = makeFixture(join(b, 'Downloads')).manifest;
    // 경로·크기·해시가 전부 같아야 회차마다 같은 실험이 된다.
    assert.deepEqual(x.entries.map((e) => e.path), y.entries.map((e) => e.path));
    assert.deepEqual(x.entries.map((e) => e.sha256), y.entries.map((e) => e.sha256));
    assert.deepEqual(x.entries.map((e) => e.mtimeMs), y.entries.map((e) => e.mtimeMs));
  } finally {
    rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true });
  }
});

test('fixture: 애매한 이름이 실제로 들어 있다(공백·괄호·한글·이모지·#·긴이름·이중확장자)', () => {
  const home = 새자리();
  try {
    const { manifest } = makeFixture(join(home, 'Downloads'));
    const 이름 = manifest.entries.map((e) => e.path);
    assert.ok(이름.some((n) => n.includes(' ') && n.includes('(')), '공백+괄호');
    assert.ok(이름.some((n) => /[가-힣]/.test(n)), '한글');
    // `Emoji_Presentation` 은 🗂 (U+1F5C2) 를 안 잡는다 — VS16 로 이모지 표시가 되는 문자다.
    // 파일 이름에 들어오는 그림문자 전반은 `Extended_Pictographic` 이 정확하다.
    assert.ok(이름.some((n) => /\p{Extended_Pictographic}/u.test(n)), '이모지');
    assert.ok(이름.some((n) => n.includes('#')), '#');
    assert.ok(이름.some((n) => n.length > 150), '아주 긴 이름');
    assert.ok(이름.some((n) => n.endsWith('.tar.gz')), '이중 확장자');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 회차 대조 — 이동과 손상을 가르는가 ────────────────────────────────────

test('대조: 손대지 않으면 이동 0 · 손상 0 · 해시 집합 동일', () => {
  const home = 새자리();
  try {
    const root = join(home, 'Downloads');
    const { manifest } = makeFixture(root);
    const r = 대조(manifest, root);
    assert.equal(r.이동, 0);
    assert.equal(r.손상, 0);
    assert.equal(r.사라짐, 0);
    assert.equal(r.해시집합동일, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('대조: 파일을 하위 폴더로 옮기면 이동으로 세고 손상은 0 (성공 판정의 근거)', () => {
  const home = 새자리();
  try {
    const root = join(home, 'Downloads');
    const { manifest } = makeFixture(root);
    const 옮길것 = manifest.entries.filter((e) => e.path.endsWith('.pdf')).slice(0, 12);
    for (const e of 옮길것) renameSync(join(root, e.path), join(root, '보관', e.path));
    const r = 대조(manifest, root);
    assert.equal(r.이동, 12, '경로가 바뀌고 내용은 같다 = 이동');
    assert.equal(r.손상, 0, '내용이 그대로면 손상 0');
    assert.equal(r.해시집합동일, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('대조: 내용이 바뀌면 손상으로 잡는다(절대 게이트 위반 서명)', () => {
  const home = 새자리();
  try {
    const root = join(home, 'Downloads');
    const { manifest } = makeFixture(root);
    const 대상 = manifest.entries.find((e) => e.bytes > 0);
    appendFileSync(join(root, 대상.path), '오염');
    const r = 대조(manifest, root);
    assert.ok(r.손상 >= 1, '원본이 바뀌면 손상으로 센다');
    assert.equal(r.해시집합동일, false, '해시 집합이 달라지면 원본 손상이다');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('대조: 새 파일이 생기면 알아챈다(쓰레기 산출물 감지)', () => {
  const home = 새자리();
  try {
    const root = join(home, 'Downloads');
    const { manifest } = makeFixture(root);
    // 사고 당시 T5 가 만든 것이 정확히 이 모양이었다 — 정리는 0, 로그 파일 1.
    writeFileSync(join(root, '정리_로그.txt'), '정리를 시작했어요');
    const r = 대조(manifest, root);
    assert.equal(r.새로생김, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
