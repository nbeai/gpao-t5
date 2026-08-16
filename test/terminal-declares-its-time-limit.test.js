// ⑧ 유도 재료(§7-bd) — **터미널이 자기 시간 상한과 행선지를 말한다** (선빨강 · 값·관계 검사)
//
// 재판 실측(완성재판-T5-회차2·3 u9): 모델이 서버를 터미널로 띄웠고 granted 실행이 120s 를 꽉
// 채운 뒤 SIGTERM 으로 서버를 죽였다(126s · 최종답 시점 pids 0). R1 은 process 손으로 9s·생존.
// 기존 재료(:736)는 맨 금지문 — 기제 사실도 행선지도 없어 2/3 이 무시했다(손 관리자 규명).
// 문구가 아니라 **값과 관계**로 문다: 숫자는 단일 근원(드리프트 시 빨강) · 두 손이 서로를 가리킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDescriptors } from '../src/surface/demo-context.js';
import { DEFAULT_TIMEOUT_MS } from '../src/runtime/terminal-run.js';

const 손들 = demoDescriptors({ desktop: false });
const 터미널 = 손들.find((d) => d.id === 'local.terminal');
const 프로세스 = 손들.find((d) => d.id === 'local.process');
const 초 = String(DEFAULT_TIMEOUT_MS / 1000);

test('★ 선빨강 — 터미널 capability 가 시간 상한을 단일 근원 숫자로 말한다', () => {
  assert.ok(String(터미널.capability ?? '').includes(초),
    `터미널 선언에 상한 ${초}초가 없다 — 모델은 없는 사실을 짐작으로 메우고(안전해 보이는 손),`
    + ' 서버는 120초 뒤 SIGTERM 에 죽는다(재판 R2·R3 실측 126s·pids 0)');
});

test('★ 선빨강 — 터미널이 행선지(process 손)를 가리킨다 (상호 지시 관계)', () => {
  assert.ok(String(터미널.capability ?? '').includes('local.process'),
    '터미널→process 방향 지시가 없다 — process→terminal(:908)만 있는 반쪽 관계가 지금 빨강의 정체');
});

test('보존 — process 손의 순방향 문장은 그대로다 (역방향 유출 방지 닻)', () => {
  const 글 = `${프로세스.capability ?? ''} ${JSON.stringify(프로세스.schema ?? {})}`;
  assert.ok(글.includes('local.terminal'),
    'process→terminal 순방향(:908)이 사라졌다 — 한 번에 끝나는 명령이 process 로 새는 문이 열린다');
});
