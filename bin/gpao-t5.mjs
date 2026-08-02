#!/usr/bin/env node
// 실행 진입점 (P-DIST-1). 설치하면 `gpao-t5` 한 줄로 뜬다.
// 서버 기동은 startLiveServer 를 그대로 쓴다 — 저장 연결 복원이 listen 전에 끝나는 순서 계약(§6.24)을
// 진입점이 따로 재구현해서 어긋나게 하지 않는다(제1원칙: 사용자에게 도달하는 경로가 곧 검증 대상).
import { startLiveServer } from '../src/surface/server.js';
import { 데이터자리, 설치신분 } from '../src/surface/install-locator.js';
import { 자리잡기, 옮김안내 } from '../src/surface/port-claim.js';

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
  const dir = 데이터자리();
  const 신분 = await 설치신분(dir).catch(() => ({ installId: null }));

  // **이미 떠 있으면 하나 더 띄우지 않는다.** 두 번째 서버가 같은 폴더를 잡으면 기억이 둘로
  // 갈라지고, 사용자는 한참 뒤에야 그걸 겪는다. 아이콘을 다시 누른 사람이 원한 건 화면이다.
  const 자리 = await 자리잡기({ dir, 원하는포트: port, installId: 신분.installId });
  if (자리.결정 === 'reuse') {
    const url = `http://localhost:${자리.port}`;
    console.log(`GPAO-T5 는 이미 켜져 있어요 → ${url}`);
    if (!flag('--no-open')) await openBrowser(url);
    process.exit(0);
  }

  const server = await startLiveServer({ port: 자리.port });
  const actual = server.address().port;
  const url = `http://localhost:${actual}`;
  // 자리를 옮겼으면 한 줄로 알린다 — 포트 번호를 설명하지 않는다. 그건 사용자의 일이 아니다.
  if (server.자리옮김) console.log(옮김안내());
  console.log(`GPAO-T5 준비됐어요 → ${url}`);
  console.log('처음이면 화면에서 모델을 연결하면 바로 시작할 수 있어요.');
  if (!flag('--no-open')) await openBrowser(url);
} catch (err) {
  // 정직하게 실패한다 — 뜬 척하지 않는다.
  console.error('GPAO-T5 를 시작하지 못했어요.');
  console.error(err?.message ?? err);
  process.exit(1);
}
