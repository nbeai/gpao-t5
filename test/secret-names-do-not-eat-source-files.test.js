// ⑥ npm 경로(§7-be) — **비밀 이름 규칙이 평범한 소스 파일을 삼키지 않는다** (선빨강 · F3 가족)
//
// 재판 실측(완성재판 R2·R3 u8): granted 승인 뒤에도 npm install 이
// `Cannot find module './tokenize'` 로 죽었다 — local-protection 의 이름 규칙 `token[^/]*` 이
// npm 전역 모듈의 tokenize.js(평범한 코드)를 secret 으로 판정 → 샌드박스가 읽기를 막고 →
// Node 가 EPERM 을 MODULE_NOT_FOUND 로 접었다. 같은 방 비교군은 성공(대조군).
// 계약 문장: "secret 은 비밀 자리·비밀 파일을 닫는다" — 평범한 소스는 정의역 밖이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectionFor, secretProtection } from '../src/runtime/local-protection.js';

test('★ 선빨강 — tokenize.js(평범한 코드)가 secret 으로 판정되지 않는다', () => {
  const 판 = protectionFor('/usr/local/lib/node_modules/npm/node_modules/postcss-selector-parser/dist/tokenize.js');
  // 계약은 「secret 으로 삼키지 않는다」다. /usr/local/lib 이 system 등급인 것은 **다른 정당한
  // 계약**(파일손이 시스템 자리를 안 바꿈)이고, 샌드박스 읽기 거부(npm 사망)의 근원이 아니다 —
  // 읽기를 막던 것은 secret 의 namePatterns 였다(수리로 닫힘 · 아래 커널 판 검사).
  assert.notEqual(판?.kind, 'secret',
    '**이름에 token 이 들어갔다는 이유로 코드 파일이 비밀이 됐다** — granted 승인 뒤에도 안 열려 '
    + 'npm 이 죽는다(재판 원문 오류와 문자 일치 재현). 계약은 비밀 파일이지 파생어가 아니다');
});

test('★ 선빨강 — 커널 이름 규칙(namePatterns)도 같은 답이다 (두 소비자 한 근원)', () => {
  const { namePatterns } = secretProtection();
  const 잡힘 = namePatterns.some((r) => new RegExp(r, 'i').test('dist/tokenize.js'));
  assert.equal(잡힘, false, '커널 판이 tokenize.js 를 잡으면 파일손을 고쳐도 샌드박스가 또 막는다');
});

test('보존 — 진짜 비밀은 여전히 닫힌다 (커버리지 하한 닻)', () => {
  for (const p of ['/home/u/.npmrc', '/home/u/.ssh/id_rsa', '/home/u/.git-credentials',
    '/work/api-token.txt', '/work/secret-token']) {
    assert.notEqual(protectionFor(p), undefined, `진짜 비밀이 열렸다: ${p} — 좁히다 안전을 깎았다`);
  }
});
