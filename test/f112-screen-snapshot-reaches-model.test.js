import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

test('픽셀 관찰 신분이 모델 입력까지 간다 — 같은 그림 좌표를 실행 손에 되붙일 수 있다', () => {
  const 모델입력 = String(compactResult({
    본창: {
      id: 9, pid: 77, app: '카카오톡', title: '대화 목록',
      bounds: { x: 100, y: 200, w: 400, h: 800 },
    },
    elements: [],
    그림크기: { w: 500, h: 768 },
    그림스냅샷: 'px:proof-same-observation',
  }));

  assert.match(모델입력, /px:proof-same-observation/,
    `드라이버가 낸 그림 관찰 신분이 모델 앞에서 사라졌다: ${모델입력}`);
  assert.match(모델입력, /대상\.스냅샷/,
    `관찰 신분을 실행 손에 어떻게 되붙이는지 없다: ${모델입력}`);
});

