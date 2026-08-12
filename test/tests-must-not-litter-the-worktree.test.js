// **검사는 자기 방에서 논다 — 저장소 작업트리에 방을 파면 회귀가 자기 자신을 못 믿는다**
//
// 실측(2026-08-12): `npm test` 전체에서만 나던 간헐 빨강의 기계 원인.
//   `scripts/human-use/harness-qualification.mjs:228` 의 `artifactIdentity` 는
//   `git ls-files --cached --others --exclude-standard` 로 **작업트리 전체 파일 목록**을 뜬 뒤
//   목록의 각 경로를 `lstat`·`readFile` 한다(:234~237). 훑기 한 번이 약 300ms 다.
//   그 사이 다른 검사가 저장소 루트에 `mkdtemp(join(process.cwd(), '.tmp-…'))` 로 방을 만들고
//   1.5ms 뒤 지우면, 목록에는 있고 실물은 없는 경로가 생겨 ENOENT 로 터진다.
//   `runHarnessQualification` 은 그 예외를 `invalidReason: 'probe_crashed'` 로 내려(:700),
//   「절단: 선언한 보호 상태가 관통 중 바뀌면…」이 기대하던 `protected_state_changed` 가 아니게 된다.
//   재현: 오염기와 함께 6회 중 2회 빨강 / artifactIdentity 단독 12회 중 5회 ENOENT.
//
// 자: 저장소 작업트리 안에 방을 판다면 그 자리는 **git 이 안 보는 자리**여야 한다.
//     artifactIdentity 의 정의역이 곧 `--exclude-standard` 이므로, git-ignore 되면 정의역 밖이다.
//     .gitignore 가 이미 같은 교리를 적어 뒀다 — "소스 트리 안에 생기면 그 자체가 사고다".
// 이 검사는 자를 깎지 않는다. 자격 관문의 판정은 그대로 두고, 방을 옮기게 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const 검사방 = new URL('.', import.meta.url).pathname;
const 저장소 = new URL('..', import.meta.url).pathname;

// cwd 를 뿌리로 삼아 선언된 작업트리 안 자리(따옴표 리터럴)를 뜬다.
const CWD_방 = /join\(\s*process\.cwd\(\)\s*,\s*'([^']+)'/g;

/** 통줄 주석은 코드가 아니다 — 이 파일의 설명문이 스스로를 물지 않게 뺀다(줄끝 주석은 남긴다). */
const 코드만 = (원문) => 원문.split('\n').filter((줄) => !/^\s*\/\//.test(줄)).join('\n');

function 작업트리방들() {
  const 결과 = [];
  for (const 이름 of readdirSync(검사방).filter((n) => n.endsWith('.test.js'))) {
    const 원문 = 코드만(readFileSync(join(검사방, 이름), 'utf8'));
    for (const m of 원문.matchAll(CWD_방)) 결과.push({ 파일: 이름, 자리: m[1] });
  }
  return 결과;
}

/** git 이 실제로 무시하는지 묻는다 — 문자열 대조가 아니라 기계 사실이다. */
function git무시하나(자리) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', 자리], { cwd: 저장소, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

test('검사가 저장소 작업트리에 파는 방은 전부 git 이 안 보는 자리다', () => {
  const 새는곳 = 작업트리방들().filter(({ 자리 }) => !git무시하나(자리));
  assert.deepEqual(새는곳, [],
    `작업트리에 git 이 보는 방을 판다 — artifactIdentity(scripts/human-use/harness-qualification.mjs:228)의 `
    + `파일 목록에 들어갔다 사라지면 전체 회귀가 간헐로 빨개진다:\n`
    + 새는곳.map(({ 파일, 자리 }) => `  ${파일} → ${자리}`).join('\n'));
});

// 읽을 수 없는 형태는 통과가 아니라 실패다.
// 첫 규칙은 `join(process.cwd(), '…')` 리터럴만 읽는다. 그래서 뿌리를 변수에 담아
// 여러 줄로 흩으면(`const 뿌리 = process.cwd(); … mkdtemp(뿌리 + '/.bad-')`) 빠져나간다.
// 그 구멍을 파일 단위로 막는다 — 검사 파일이 cwd 를 쓴다면 **전부** 확인 가능한 형태여야 한다.
// 읽기 전용 용도는 여기 이름을 적어 열어 둔다(구멍을 두더라도 검토된 구멍으로 둔다).
const 읽기전용_예외 = new Map([
  ['s1-preflight.test.js', 'cwd 를 변경파일() 에 넘겨 읽기만 한다 — 작업트리에 아무것도 만들지 않는다'],
]);

test('검사 파일의 cwd 사용은 전부 확인 가능한 형태다 — 뿌리를 변수로 흩어 빠져나갈 수 없다', () => {
  const 못읽음 = [];
  for (const 이름 of readdirSync(검사방).filter((n) => n.endsWith('.test.js'))) {
    if (읽기전용_예외.has(이름)) continue;
    const 원문 = 코드만(readFileSync(join(검사방, 이름), 'utf8'));
    const 전체 = (원문.match(/process\.cwd\(\)/g) ?? []).length;
    const 읽힘 = [...원문.matchAll(CWD_방)].length;
    if (전체 !== 읽힘) 못읽음.push(`${이름} — cwd ${전체}회 중 ${읽힘}회만 형태를 읽었다`);
  }
  assert.deepEqual(못읽음, [],
    'cwd 를 확인할 수 없는 형태로 쓴다 — git 무시 여부를 물을 수 없으므로 막는다:\n' + 못읽음.join('\n'));
});

test('반대시험: 예외 목록은 이름만이 아니라 이유가 함께 있어야 한다', () => {
  for (const [이름, 이유] of 읽기전용_예외) {
    assert.ok(이유.length > 10, `${이름} 예외에 이유가 없다 — 이유 없는 면제는 구멍이다`);
  }
});

test('반대시험: 이 자가 실제로 문다 — 옛 자리(.tmp-anchor-)는 git 이 본다', () => {
  assert.equal(git무시하나('.tmp-anchor-x/GPAO-T5/f.txt'), false,
    '옛 자리를 무시한다고 나온다 — 자가 무뎌졌거나 .gitignore 가 넓어졌다');
  assert.equal(git무시하나('tmp/.tmp-anchor-x/GPAO-T5/f.txt'), true,
    'tmp/ 가 무시되지 않는다 — 옮겨 갈 자리가 사라졌다');
});
