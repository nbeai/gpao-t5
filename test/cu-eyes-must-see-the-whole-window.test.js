// **틀린 자로 세웠던 검사** — 계약을 읽고 폐기했다(2026-08-06).
//
// `zoom` 이 559×859 창을 500×707 로 낸 것을 보고 *"아래가 잘렸다"* 로 판정했다.
// 그런데 `zoom` 도구 설명에 이미 적혀 있었다:
//   *"cropped JPEG … with **20% padding** added on each side.
//    The output image is **at most 500 px wide**."*
// **잘린 게 아니라 패딩+축소다.** 비율이 다른 것이 정상이다.
//
// 그리고 그 좌표를 되돌리는 길도 계약이 준다 — `from_zoom: true`.
// 그 계약은 `cu-zoom-coordinates-come-back` 이 지킨다.
//
// 오너 지적이 이 자리를 열었다: *"쿠아가 깃허브에서 사랑받는 이유가 있을 거야.
// 개발자는 왜 개발했는지를 알면 우리가 어떻게 활용해야 하는지 방향이 잡히지 않을까?"*
// **읽었으면 하루가 안 걸렸다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 잘렸나 } from '../src/runtime/desktop-cua-driver.js';

test('그림 크기가 창과 달라도 잘린 것이 아니다 — zoom 은 패딩을 붙이고 줄인다', () => {
  // 자는 남겨 둔다(다른 눈이 붙을 때 쓸 수 있다). 다만 **판정에 안 쓴다** —
  // 지금 우리 눈은 `zoom` 하나뿐이고, zoom 의 비율 차이는 계약된 정상이다.
  assert.equal(typeof 잘렸나, 'function');
  assert.equal(잘렸나(null, null), false, '못 재면 잘렸다고 하지 않는다');
});
