// §7-bs 소비자 0 닻 — **산출물사실은 완료 기계가 한 곳도 읽지 않는 순수 사실 칸이다**(오너 경계 ①).
//
// grep 닻의 약한 자리(검문): 목록이 조용히 0개로 풀리면 「아무도 안 읽는다」가 아니라
// 「아무것도 안 봤다」가 초록이 된다(H09). 그래서 **파일 실재·비어있지않음을 먼저 단언**한다.
// 우회(구조분해·동적 키)는 행동 닻이 잡는다 — rejected-contract-keeps-facts 의
// recentOutcome·deliverables 부재 단언 + F-64 동결 5(f64-slice1-completion-contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 완료 기계 파일 목록 — §7-bs 선등록에 병기된 그 목록 그대로(고정).
const 완료기계들 = [
  'src/surface/work-event-store.js',
  'src/runtime/capsule.js',
  'src/kernel/l2-plan/work-contract.js',
  'src/kernel/l2-plan/exit-verification.js',
];

test('닻 — 완료 기계 파일 어느 곳도 산출물사실 을 읽지 않는다 (목록 실재 선단언)', async () => {
  for (const 경로 of 완료기계들) {
    const 글 = await readFile(new URL(`../${경로}`, import.meta.url), 'utf8');
    assert.ok(글.length > 100, `${경로} 가 비었거나 사라졌다 — 닻의 분모가 무너졌다(H09)`);
    assert.ok(!글.includes('산출물사실'),
      `${경로} 가 순수 사실 칸을 읽는다 — 오너 경계 ①(완료 기계 소비자 0) 위반`);
  }
});
