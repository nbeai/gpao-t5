#!/usr/bin/env node
// 실행 진입점 (P-DIST-1). 설치하면 `gpao-t5` 한 줄로 뜬다.
// 서버 기동은 startLiveServer 를 그대로 쓴다 — 저장 연결 복원이 listen 전에 끝나는 순서 계약(§6.24)을
// 진입점이 따로 재구현해서 어긋나게 하지 않는다(제1원칙: 사용자에게 도달하는 경로가 곧 검증 대상).
import { startLiveServer } from '../src/surface/server.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

if (flag('--help') || flag('-h')) {
  console.log([
    'GPAO-T5 — 사용법:',
    '  gpao-t5 [--port <번호>] [--no-open]',
    '',
    '  --port      들을 포트(기본 4173, PORT 환경변수도 됨)',
    '  --no-open   브라우저를 자동으로 열지 않는다',
  ].join('\n'));
  process.exit(0);
}

const port = Number(valueOf('--port') ?? process.env.PORT ?? 4173);

/** 브라우저 열기는 **선택**이다 — 실패해도 서버는 계속 산다(열지 못했다고 설치를 실패시키지 않는다). */
async function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const { spawn } = await import('node:child_process');
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch { /* 열지 못해도 아래 URL 안내로 충분하다 */ }
}

try {
  const server = await startLiveServer({ port });
  const actual = server.address().port;
  const url = `http://localhost:${actual}`;
  console.log(`GPAO-T5 준비됐어요 → ${url}`);
  console.log('처음이면 화면에서 모델을 연결하면 바로 시작할 수 있어요.');
  if (!flag('--no-open')) await openBrowser(url);
} catch (err) {
  // 정직하게 실패한다 — 뜬 척하지 않는다.
  console.error('GPAO-T5 를 시작하지 못했어요.');
  console.error(err?.message ?? err);
  process.exit(1);
}
