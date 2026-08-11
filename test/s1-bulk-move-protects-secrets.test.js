// 상태 지도 §12-S1 — **bulk_move 만 개별 파일 보호 판정을 안 했다** (2026-08-12).
//
// `read`·`versions`·`locate` 는 전부 `protectionBlocks` 를 거는데 `bulk_move` 루프에만
// 없었다. 점파일은 `startsWith('.')` 가 걸러 `.env` 류는 빠졌지만, **점으로 시작하지 않는
// 비밀 이름**(`id_rsa` · `credentials` · `*.pem` · `*token*` …)은 그대로 통과했다.
// 그리고 이 손은 `reversible:true` 라 헌장 ②의 조건이 자동을 열어 **카드 없이** 실행된다 —
// `extensions:['.pem']` 하나면 개인키가 조용히 옮겨진다.
//
// 이 검사는 그 자리를 문다. 그리고 **조용한 제외도 막는다**: 걸러낸 사실이 결과에 안 실리면
// 「무엇이 안 옮겨졌는지 모르는 성공」이 되고, 그건 거짓 성공의 사촌이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function 방세우기(파일들) {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 's1-bulk-')));
  const 원본 = join(방, '원본');
  await mkdir(원본, { recursive: true });
  for (const [이름, 내용] of Object.entries(파일들)) await writeFile(join(원본, 이름), 내용, 'utf8');
  return { 방, 원본, 손: makeLocalFileTool({ roots: [방], dataDir: 방, homeDir: 방 }) };
}

test('bulk_move 가 비밀 이름을 옮기지 않는다 — 점으로 시작하지 않아도', async () => {
  const { 방, 원본, 손 } = await 방세우기({
    'id_rsa': 'PRIVATE KEY',
    'server.pem': 'CERT',
    'credentials': 'aws',
    '정산.pem': '이건 이름이 pem 이라 보호로 본다',
    '메모.txt': '평범한 자료',
  });
  try {
    const r = await 손.handler({
      action: 'bulk_move', path: 원본, to: join(방, '모음'), match: { extensions: ['.pem'] },
    });
    const 옮긴이름 = (r?.result?.moved ?? []).map((m) => String(m.to).split('/').pop());
    assert.deepEqual(옮긴이름, [],
      `**보호 대상이 옮겨졌다**: ${옮긴이름.join(', ')}`);
    const 남은것 = await readdir(원본);
    for (const 비밀 of ['id_rsa', 'server.pem', 'credentials', '정산.pem']) {
      assert.ok(남은것.includes(비밀), `${비밀} 이 원본에서 사라졌다`);
    }
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('걸러낸 사실이 결과에 실린다 — 조용한 제외는 거짓 성공의 사촌이다', async () => {
  const { 방, 원본, 손 } = await 방세우기({
    'server.pem': 'CERT',
    '보고서.pem': '보호로 걸린다',
  });
  try {
    const r = await 손.handler({
      action: 'bulk_move', path: 원본, to: join(방, '모음'), match: { extensions: ['.pem'] },
    });
    const 실린것 = JSON.stringify(r ?? {});
    assert.match(실린것, /보호/, `무엇이 왜 빠졌는지 결과에 없다: ${실린것.slice(0, 300)}`);
    assert.match(String(r?.userSafeSummary ?? ''), /보호/,
      `요약줄이 제외 사실을 안 말한다: ${r?.userSafeSummary}`);
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('보호 아닌 파일은 그대로 옮겨진다 — 그물이 넓어지지 않았다', async () => {
  const { 방, 원본, 손 } = await 방세우기({
    '8월정산.csv': 'a,b\n1,2',
    '7월정산.csv': 'a,b\n3,4',
    'id_rsa': 'PRIVATE KEY',
  });
  try {
    const r = await 손.handler({
      action: 'bulk_move', path: 원본, to: join(방, '정산모음'), match: { extensions: ['.csv'] },
    });
    assert.equal((r?.result?.moved ?? []).length, 2,
      `평범한 자료가 안 옮겨졌다: ${JSON.stringify(r?.result ?? r)}`);
    assert.ok((await readdir(원본)).includes('id_rsa'), '비밀 파일이 사라졌다');
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('보호로 전부 걸리면 정직한 실패다 — 「옮겼어요」가 안 나간다', async () => {
  const { 방, 원본, 손 } = await 방세우기({ 'id_rsa': 'K', 'server.pem': 'C' });
  try {
    const r = await 손.handler({
      action: 'bulk_move', path: 원본, to: join(방, '모음'), match: { nameIncludes: 'r' },
    });
    assert.notEqual(r?.blocked, undefined, '보호로 0개인데 성공으로 닫혔다');
    assert.doesNotMatch(String(r?.userSafeSummary ?? ''), /개를 옮겼어요/,
      `안 옮겼는데 옮겼다고 한다: ${r?.userSafeSummary}`);
  } finally { await rm(방, { recursive: true, force: true }); }
});
