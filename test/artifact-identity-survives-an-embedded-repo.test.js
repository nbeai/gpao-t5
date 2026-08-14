// **재는 자가 정상 작업트리 모양에서 죽으면, 그 자로 잰 모든 값이 거짓이다**
//
// 밟음(2026-08-14 · 본선 b829813): `npm test` 가 10건 빨갰다. 제품은 하나도 안 틀렸다.
//   작업트리에 임베디드 git 저장소(다른 방에서 옮겨 온 클론)가 하나 있었다.
//   `git ls-files --others` 는 **임베디드 저장소를 파일이 아니라 디렉터리 한 줄로** 낸다
//   (`.t5check-tojson/repo/` — 목록 2,838줄 중 그 하나만 디렉터리).
//   `artifactIdentity` 는 목록의 모든 이름을 `lstat` 뒤 곧장 `readFile` 한다 — 갈래가
//   **심볼릭 링크냐 파일이냐 둘뿐**이라 디렉터리가 `EISDIR` 로 터졌고,
//   `runHarnessQualification` 이 그 예외를 `invalidReason:'probe_crashed'` 로 내려
//   자격 관문 9건 + preflight 1건이 무너졌다. 쓰레기를 치워도 구멍은 남는다.
//
// 임베디드 저장소는 불법 상태가 아니다 — git 이 스스로 그렇게 낸다. 그러니 이 자는
// 그 모양을 **받아서 사실대로 적어야** 한다. 세 가지를 동시에 지킨다:
//   ① 안 터진다                    정상 모양에서 죽는 자는 자가 아니다
//   ② 바이트를 지어내지 않는다        읽을 수 없는 자리에 digest 를 만들지 않는다
//   ③ **못 읽었다고 말한다**         `embeddedRepos` 로 그 자리를 이름으로 고지한다.
//                                 부재를 침묵으로 대신하지 않는다(F-104 계열)
//
// 이 검사는 자를 무르게 하지 않는다: 정확한 Git SHA·dirty·worktreeDigest 계약은 그대로 두고,
// 위 셋과 「조용히 버리지 않는다」만 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactIdentity } from '../scripts/human-use/harness-qualification.mjs';

const 방 = () => mkdtemp(join(tmpdir(), 't5-embedded-repo-'));

function 저장소만들기(root) {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'qualification@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Qualification Harness'], { cwd: root });
}

async function 뿌리하나() {
  const root = await 방();
  저장소만들기(root);
  await writeFile(join(root, 'source.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'source.mjs'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

/** 남의 클론이 작업트리 안에 남은 그 모양 그대로 심는다. */
async function 임베디드저장소심기(root, 이름) {
  const nested = join(root, 이름);
  execFileSync('mkdir', ['-p', nested]);
  저장소만들기(nested);
  await writeFile(join(nested, 'stranded.mjs'), 'export const 남의것 = 1;\n');
  execFileSync('git', ['add', 'stranded.mjs'], { cwd: nested });
  execFileSync('git', ['commit', '-qm', 'stranded work'], { cwd: nested });
  return nested;
}

test('선빨강: 작업트리 안 임베디드 저장소에서 소스 신분이 터지지 않는다', async () => {
  const root = await 뿌리하나();
  await 임베디드저장소심기(root, 'stranded/repo');

  // 밟은 그대로: git 이 그 자리를 디렉터리 한 줄로 낸다. 이 전제가 깨지면 검사가 헛돈다.
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'buffer',
  }).toString('utf8').split('\0').filter(Boolean);
  assert.ok(names.includes('stranded/repo/'),
    `임베디드 저장소가 디렉터리 줄로 안 나왔다 — 이 검사의 전제가 깨졌다: ${JSON.stringify(names)}`);

  // 수리 전에는 여기서 EISDIR 로 터졌다.
  const identity = await artifactIdentity({ sourceRoot: root });
  assert.equal(identity.kind, 'source');
  assert.match(identity.gitSha, /^[0-9a-f]{40}$/, '정확한 Git SHA 계약이 무너졌다');
  assert.match(identity.worktreeDigest, /^[0-9a-f]{64}$/);
});

test('못 읽은 자리를 이름으로 고지한다 — 침묵으로 대신하지 않는다', async () => {
  const root = await 뿌리하나();
  await 임베디드저장소심기(root, 'stranded/repo');
  const identity = await artifactIdentity({ sourceRoot: root });
  assert.deepEqual(identity.embeddedRepos, ['stranded/repo/'],
    '바이트를 못 담는 자리를 신분이 한마디도 안 했다');

  const 깨끗한뿌리 = await 뿌리하나();
  assert.deepEqual((await artifactIdentity({ sourceRoot: 깨끗한뿌리 })).embeddedRepos, [],
    '없는데 있다고 했다 — 양성 대조가 안 선다');
});

test('반례: 조용히 버리지 않는다 — 있고 없음이 신분을 바꾼다', async () => {
  const root = await 뿌리하나();
  const 깨끗할때 = await artifactIdentity({ sourceRoot: root });
  const nested = await 임베디드저장소심기(root, 'stranded/repo');
  const 심었을때 = await artifactIdentity({ sourceRoot: root });
  assert.notEqual(깨끗할때.worktreeDigest, 심었을때.worktreeDigest,
    '남의 저장소가 통째로 들어왔는데 같은 소스 신분이 나왔다');

  await rm(nested, { recursive: true, force: true });
  const 치운뒤 = await artifactIdentity({ sourceRoot: root });
  assert.equal(치운뒤.worktreeDigest, 깨끗할때.worktreeDigest,
    '치운 뒤 원래 신분으로 안 돌아왔다 — 신분이 경로 이력에 물들었다');
  assert.deepEqual(치운뒤.embeddedRepos, []);
});

test('정직: 임베디드 저장소 안의 변경은 신분에 안 잡힌다 — 그래서 고지가 값이다', async () => {
  const root = await 뿌리하나();
  const nested = await 임베디드저장소심기(root, 'stranded/repo');
  const 전 = await artifactIdentity({ sourceRoot: root });
  await writeFile(join(nested, 'stranded.mjs'), 'export const 남의것 = 2;\n');
  const 후 = await artifactIdentity({ sourceRoot: root });
  assert.equal(전.worktreeDigest, 후.worktreeDigest,
    '못 읽는다고 해 놓고 실제로는 읽었다 — 둘 중 하나가 거짓이다');
  assert.deepEqual(후.embeddedRepos, ['stranded/repo/'],
    '담지 못하는 자리가 있는데 고지가 사라졌다');
});

test('기존 갈래는 그대로다 — 갈래 하나를 더한 것이지 무르게 한 것이 아니다', async () => {
  const root = await 뿌리하나();
  const 처음 = await artifactIdentity({ sourceRoot: root });

  await writeFile(join(root, 'source.mjs'), 'export const value = 2;\n');
  const 바이트바뀜 = await artifactIdentity({ sourceRoot: root });
  assert.notEqual(처음.worktreeDigest, 바이트바뀜.worktreeDigest, '파일 갈래가 바이트를 안 본다');
  assert.equal(처음.gitSha, 바이트바뀜.gitSha);
  assert.equal(바이트바뀜.dirty, true);

  await symlink('source.mjs', join(root, 'link.mjs'));
  const 링크 = await artifactIdentity({ sourceRoot: root });
  assert.notEqual(바이트바뀜.worktreeDigest, 링크.worktreeDigest, '심볼릭 링크 갈래가 사라졌다');
  assert.deepEqual(링크.embeddedRepos, [], '심볼릭 링크를 임베디드 저장소로 읽었다');
});
