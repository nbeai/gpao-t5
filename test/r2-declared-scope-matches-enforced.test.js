// **선언이 강제와 같아야 한다 — 모델은 선언을 믿는다.**
//
// 노드 R 순서 ②(계획서 `4dc9a17` · 오너 방향 2026-08-07).
//
// 판 ⑫가 3/3 실패했고, 마지막 벽이 이것이었다(실측 2026-08-07):
// ```
// 모델이 부른 것   local.locate { what:'지난달 정산 파일', from:'Desktop', depth:3 }
//                  local.locate { what:'지난달 정산',      from:'Documents', depth:5 }
// from 없이 부르면  ~/GPAO-T5/지난달 정산 파일  →  confidence: high
// ```
// **손은 처음부터 찾을 수 있었다.** 모델이 *"제가 다루는 폴더는 넷"* 이라는 선언을 믿고
// 그 넷 안에서만 찾았다. 강제는 이미 홈 전체였다(`local-file.js:216`·`:331`).
//
// 선언을 강제에 맞춘다. **좁히는 게 아니라 맞추는 것이다** —
// 좁히면 CU 는 화면 전체를 보고 터미널은 홈 밖까지 실행하는데 파일 손만 넷이 된다.
// 사장님에겐 *"카톡은 읽어주면서 드롭박스 정산표는 못 연다"* 로 보인다.
//
// **넓히는 같은 걸음에서 노출면을 닫는다.** 보호는 루트와 독립이라 대부분 그대로 막히지만
// (`~/Library` 전부 · `.ssh` · `.aws` · `.netrc` · `.npmrc` · `.bash_history`),
// `.gitconfig`·`.zshrc` 가 열려 있었다. 셸 설정에는 `export API_KEY=` 가 흔하다.
// 하나씩 열거하는 방식은 새 도구가 생길 때마다 뚫린다 — `.zshrc` 가 그 증거다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFileRoots, isWithin, 부르는이름들 } from '../src/runtime/file-scope.js';
import { protectionFor } from '../src/runtime/local-protection.js';
import { homedir } from 'node:os';

// 선언(루트)은 어느 홈이든 같은 모양이어야 하고, 보호는 **실제 홈** 기준 규칙을 쓴다
// (`h('.ssh')` 처럼). 그래서 두 축을 다른 값으로 잰다 — 섞으면 둘 다 헛 잰다.
const 홈 = '/Users/사장님';
const 진짜홈 = homedir();

test('선언한 방이 홈이다 — 강제와 같아야 모델이 좁게 찾지 않는다', () => {
  const roots = defaultFileRoots({ HOME: 홈 });
  assert.deepEqual(roots, [홈],
    `**선언과 강제가 갈린다** — 모델이 좁은 쪽을 믿고 있는 파일을 못 찾는다: ${JSON.stringify(roots)}`);
});

test('사장님 파일이 있는 자리가 전부 안에 든다 — 넷으로는 여기가 죽는다', () => {
  const [root] = defaultFileRoots({ HOME: 홈 });
  for (const p of [`${홈}/Dropbox/정산.xlsx`, `${홈}/GPAO-T5/지난달 정산 파일/6월.csv`,
    `${홈}/Desktop/x.txt`, `${홈}/Downloads/견적서.pdf`, `${홈}/Movies/촬영.mp4`,
    `${홈}/Library/Mobile Documents/iCloud~/장부.numbers`]) {
    assert.ok(isWithin(root, p), `**${p} 가 범위 밖이다**`);
  }
});

test('밝히면 그것이 이긴다 — 격리와 설치별 설정이 안 깨진다', () => {
  assert.deepEqual(
    defaultFileRoots({ HOME: 홈, GPAO_T5_FILE_ROOTS: '/tmp/방' }), ['/tmp/방'],
  );
});

test('부르는 이름이 사실이다 — 넷을 부르던 이름이 남으면 그게 F-46 이다', () => {
  const 이름 = String(부르는이름들(defaultFileRoots({ HOME: 홈 })));
  assert.doesNotMatch(이름, /다운로드.*문서.*바탕화면/,
    `**넷이라고 계속 말한다** — 모델이 그 말을 믿는다: ${이름}`);
});

// ── 넓힌 만큼 노출면을 닫는다 ───────────────────────────────────────────
test('홈 최상위 숨김 자리는 막힌다 — 하나씩 열거하면 새 도구가 생길 때마다 뚫린다', () => {
  for (const p of [`${진짜홈}/.gitconfig`, `${진짜홈}/.zshrc`, `${진짜홈}/.bashrc`,
    `${진짜홈}/.profile`, `${진짜홈}/.env`, `${진짜홈}/.config/gh/hosts.yml`, `${진짜홈}/.ssh/id_rsa`]) {
    assert.ok(protectionFor(p), `**${p} 가 열린다** — 설정·자격증명 자리다`);
  }
});

test('사장님 자료는 안 막는다 — 보호가 기능을 먹으면 안 된다', () => {
  for (const p of [`${진짜홈}/Dropbox/정산.xlsx`, `${진짜홈}/Desktop/6월정산.csv`,
    `${진짜홈}/GPAO-T5/지난달 정산 파일/6월.csv`, `${진짜홈}/Documents/계약서.pdf`]) {
    assert.ok(!protectionFor(p), `**${p} 를 막는다** — 사장님 자료다`);
  }
});

test('숨김이라도 자료 폴더 안이면 안 막는다 — 홈 최상위만 본다', () => {
  assert.ok(!protectionFor(`${진짜홈}/Documents/프로젝트/.gitignore`),
    '**자료 폴더 안의 점파일까지 막는다** — 그물이 넓으면 기능이 죽는다');
});
