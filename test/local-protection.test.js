// P6-L1 · 로컬 보호 영역 — **넓게 열기 전에 세우는 안전막.**
//
// 방향 전환(오너 지시): T5 는 PC 기반 AI OS 다. 일반 폴더는 넓게 다뤄야 한다.
// 그러면 안전이 "좁은 루트"에서 나오던 구조가 사라진다 — 그 자리를 보호 영역이 받는다.
//
// **핵심 불변식: 보호는 루트와 독립이다.** 루트를 넓히는 것으로 보호가 풀리면 그건 보호가 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { protectionFor, protectionBlocks, protectionMessage } from '../src/runtime/local-protection.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const H = homedir();

// ── 무엇이 보호되는가 ───────────────────────────────────────────────────
test('열쇠·인증서·로그인 정보는 secret — **읽기까지** 막는다', () => {
  for (const p of [
    join(H, '.ssh/id_rsa'), join(H, '.aws/credentials'), join(H, '.gnupg/secring.gpg'),
    join(H, 'Library/Keychains/login.keychain-db'),
    join(H, 'Library/Application Support/Google/Chrome/Default/Cookies'),
    join(H, 'Documents/service-account-prod.json'), join(H, 'work/.env'),
    join(H, 'work/server.pem'), join(H, 'Documents/wallet.dat'),
  ]) {
    assert.equal(protectionFor(p)?.kind, 'secret', `보호되어야 한다: ${p}`);
    assert.ok(protectionBlocks(p, { write: false }), '읽기도 막아야 한다 — 유출은 되돌릴 수 없다');
  }
});

test('OS·앱 내부는 system — **읽기는 되고 변경은 안 된다**', () => {
  for (const p of ['/System/Library/x', '/usr/bin/node', '/etc/hosts', '/Applications/Safari.app/Contents/Info.plist']) {
    assert.equal(protectionFor(p)?.kind, 'system', p);
    assert.equal(protectionBlocks(p, { write: false }), undefined, '읽기까지 막으면 아무것도 못 하는 도구가 된다');
    assert.ok(protectionBlocks(p, { write: true }), '변경은 막아야 한다');
  }
});

test('일반 사용자 자료는 보호 대상이 아니다(넓게 다뤄야 한다)', () => {
  for (const p of [
    join(H, 'Desktop/메모.md'), join(H, 'Documents/기획서.docx'),
    join(H, 'Downloads/사진.png'), join(H, 'Movies/영상.mp4'), join(H, 'Projects/app/index.js'),
  ]) {
    assert.equal(protectionFor(p), undefined, `막으면 안 된다: ${p}`);
  }
});

// ── 핵심 불변식 ─────────────────────────────────────────────────────────
test('**보호는 루트와 무관하다** — 홈 전체를 열어도 비밀은 안 열린다', async () => {
  const tool = makeLocalFileTool({ roots: [H], dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-prot-')) });
  const r = await tool.handler({ action: 'read', path: join(H, '.ssh/id_rsa') });
  assert.ok(r.blocked, '루트를 넓혔다고 비밀이 열리면 그건 보호가 아니다');
  assert.equal(r.scopeState, 'protected');
  assert.doesNotMatch(JSON.stringify(r), /BEGIN|PRIVATE KEY/, '내용은 한 조각도 나가면 안 된다');
});

test('보호 판정은 파일을 열지 않는다(판정하려고 읽으면 그게 유출이다)', () => {
  // 존재 여부와 무관하게 같은 답을 준다 = 경로만 보고 판정한다는 뜻이다.
  assert.equal(protectionFor(join(H, '.ssh/없는파일'))?.kind, 'secret', '없는 파일도 그 자리면 비밀이다');
  // 이름 기준 보호는 **어느 폴더에 있든** 걸린다 — 옮겨 놓는다고 비밀이 아니게 되지 않는다.
  assert.equal(protectionFor('/어디든/여기/id_rsa')?.kind, 'secret');
  assert.equal(protectionFor('/어디든/여기/평범한파일.md'), undefined);
});

// ── 관통: 실제 도구에서 ─────────────────────────────────────────────────
test('관통: 보호 영역으로 옮겨 넣는 것도 막는다(목적지도 본다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-prot2-'));
  await writeFile(join(dir, 'a.md'), '내용');
  const tool = makeLocalFileTool({ roots: [dir, H], dataDir: dir });
  const r = await tool.handler({ action: 'move', path: 'a.md', to: join(H, '.ssh/a.md') });
  assert.ok(r.blocked, '보호 영역으로 넣는 것도 변경이다');
  assert.equal(r.scopeState, 'protected');
});

test('막을 때도 막다른 답을 주지 않는다(왜 조심하는지 + 다음 길)', () => {
  const s = protectionMessage({ kind: 'secret', why: '열쇠가 들어 있는 자리예요' });
  assert.match(s.userSafeSummary, /열지 않았어요/);
  assert.ok(s.nextSafeAction, '다음 길이 없으면 사용자는 포기한다');
  const y = protectionMessage({ kind: 'system', why: '운영체제 자리예요' }, { write: true });
  assert.match(y.userSafeSummary, /바꾸지 않아요/);
  assert.ok(y.nextSafeAction);
  // 내부 규칙을 설명하지 않는다 — 사용자는 우리 목록을 알 필요가 없다.
  assert.doesNotMatch(JSON.stringify([s, y]), /SECRET_|SYSTEM_|정규식|패턴/);
});

test('일반 폴더는 넓혀도 그대로 동작한다(보호가 일반 작업을 막지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-prot3-'));
  await mkdir(join(dir, '문서'));
  await writeFile(join(dir, '문서/메모.md'), '안녕');
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const list = await tool.handler({ action: 'list', path: '문서' });
  assert.ok(!list.blocked, `일반 폴더가 막히면 AI OS 가 아니다: ${JSON.stringify(list)}`);
  const read = await tool.handler({ action: 'read', path: '문서/메모.md' });
  assert.ok(!read.blocked);
});

test('임시 폴더는 보호 대상이 아니다(시스템 보호가 임시 작업까지 막으면 안 된다)', async () => {
  // macOS 의 tmp 는 /private/var/folders/… 다. /private/var 를 통째로 막았더니
  // 임시 폴더를 쓰는 테스트 12건이 한꺼번에 깨졌다 — 목록이 거칠면 일반 작업을 막는다.
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-scratch-'));
  assert.equal(protectionFor(join(dir, 'a.md')), undefined, `임시 작업 공간이 막힌다: ${dir}`);
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const w = await tool.handler({ action: 'write', path: 'a.md', text: '내용' });
  assert.ok(!w.blocked, '임시 폴더에 쓰기가 막히면 안 된다');
});

// ── C 감사 F7.1 · 루트가 홈이어도 ~/Library 는 일반 탐색 범위가 아니다 ────
// 실측(감사 2026-08-01): SYSTEM_DIRS 의 `/Library` 는 절대 경로라 `~/Library` 아래
// iMessage 전문(chat.db)·Mail·Containers·목록에 없는 브라우저 세션이 전부 무보호였고,
// read 는 승인 없이 진행된다. 루트 확장과 독립으로 여기가 막혀야 한다.
test('F7.1: ~/Library 의 세션·데이터 저장 영역은 읽기도 막는다', () => {
  for (const p of [
    join(H, 'Library/Messages/chat.db'),
    join(H, 'Library/Mail/V10/받은편지함'),
    join(H, 'Library/Containers/com.apple.Notes/Data'),
    join(H, 'Library/Group Containers/group.com.apple.notes'),
    join(H, 'Library/Application Support/Microsoft Edge/Default/Cookies'),
    join(H, 'Library/Application Support/Arc/User Data'),
    join(H, 'Library/Application Support/Slack/Local Storage'),
    join(H, 'Library/Application Support/Notion/Partitions'),
  ]) {
    assert.equal(protectionFor(p)?.kind, 'secret', `열리면 안 되는 자리가 열린다: ${p}`);
  }
});

test('F7.1: 보호를 이유로 사용자 파일 자리를 다시 닫지 않는다', () => {
  // 동기화된 **사용자 파일**은 ~/Library 아래에 있어도 사용자의 것이다(iCloud Drive·클라우드).
  for (const p of [
    join(H, 'Library/CloudStorage/Dropbox/보고서.docx'),
    join(H, 'Library/Mobile Documents/com~apple~CloudDocs/기획서.pages'),
    join(H, 'Documents/기획서.docx'), join(H, 'Downloads/견적서.pdf'), join(H, 'Desktop/메모.md'),
  ]) {
    assert.equal(protectionFor(p), undefined, `사용자 파일 자리가 닫혔다: ${p}`);
  }
});

test('F7.1: 사용자 파일 자리 안에서도 이름 기준 비밀 규칙은 그대로 산다', () => {
  assert.equal(protectionFor(join(H, 'Library/CloudStorage/Dropbox/.env'))?.kind, 'secret');
  assert.equal(protectionFor(join(H, 'Library/Mobile Documents/com~apple~CloudDocs/api-token.txt'))?.kind, 'secret');
});

// ── C 감사 F7.2 · 흔한 평문 자격증명이 이름 규칙에서 빠져 있었다 ─────────
test('F7.2: 평문 자격증명·셸 히스토리는 어느 폴더에 있든 비밀이다', () => {
  for (const p of [
    join(H, '.git-credentials'),
    join(H, '.claude/.credentials.json'),
    join(H, '.zsh_history'), join(H, '.bash_history'),
    '/어디든/rclone.conf',
  ]) {
    assert.equal(protectionFor(p)?.kind, 'secret', `자격증명이 무보호다: ${p}`);
  }
  // 평범한 이름은 계속 열린다 — 보호가 넓어진 만큼 오탐도 늘면 도구가 죽는다.
  assert.equal(protectionFor(join(H, 'Documents/거래이력.md')), undefined);
  assert.equal(protectionFor(join(H, 'Documents/credentials-발표자료.pptx')), undefined);
});

// ── C 감사 F7.3 · TMPDIR 오염이 시스템 보호를 통째로 끄면 안 된다 ────────
test('F7.3: TMPDIR=/ 이어도 시스템 보호는 살아 있다(자식 프로세스 실측)', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const code = `import { protectionFor } from ${JSON.stringify(new URL('../src/runtime/local-protection.js', import.meta.url).href)};
console.log(JSON.stringify({ sys: protectionFor('/System/Library/x')?.kind ?? null }));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code],
    { env: { ...process.env, TMPDIR: '/' } });
  assert.equal(JSON.parse(stdout.trim()).sys, 'system',
    'TMPDIR 오염으로 시스템 보호가 꺼졌다 — 보호 판정이 환경변수에 굴복한다');
});
