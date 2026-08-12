// L3 · 시간 제한 실행 유틸. 외부 실행(웹 수집·채널 전송)이 끝나지 않는 응답에 멈추지 못하게 한다.
// signal을 무시하는 구현도 멈추도록 race로 감싸고, 실제 요청엔 abort 신호를 보낸다(리소스 정리).

/**
 * @param {() => Promise<*>} factory  실행할 비동기 작업
 * @param {number} timeoutMs
 * @param {AbortController} controller  timeout 시 abort()로 실제 요청을 취소
 */
export async function withTimeout(factory, timeoutMs, controller) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([factory(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * **총 걸린 시간이 아니라 정체로 자른다**(오너 결정 2026-08-09).
 *
 * `withTimeout` 은 "몇 초 지났나"를 센다. 모델 응답에는 그 자가 틀렸다 —
 * *"20초의 99.9%는 모델 판단 시간이다. 왕복을 깎아 모델을 멍청하게 만들지 않는다."*
 * 답이 흐르고 있는데 총 시간이 넘었다고 끊으면 **사용자 앞에서 답이 잘린다.**
 *
 * 여기서 세는 것은 **조각과 조각 사이의 공백**이다. `factory` 는 `살아있음()` 을 받고,
 * 무언가 실제로 도착할 때마다 그것을 부른다 — 부를 때마다 시계가 0 으로 돌아간다.
 *
 * **흐르기 전에는 재지 않는다.** 첫 `살아있음()` 이 오기 전까지 타이머는 아예 안 돈다.
 * 첫 조각까지가 오래 걸리는 것은 죽음이 아니라 **모델이 생각하는 중**이고(추론 모델은
 * 분 단위로 침묵한다), 그 구간의 진짜 죽음은 소켓이 끊어지며 `fetch` 자체가 거절한다.
 * 정체는 **흐르다가 멈춘 것**이고, 그것만이 여기서 자를 근거다.
 *
 * @param {(살아있음: () => void) => Promise<*>} factory
 * @param {number} stallMs  0 이하면 정체 감시 없음(부를 자리가 없는 경로 — 단발 POST 등)
 * @param {AbortController} controller  정체 시 abort() 로 실제 요청을 취소
 */
export async function withStallTimeout(factory, stallMs, controller) {
  if (!(stallMs > 0)) return factory(() => {});
  let timer;
  let 끝났나 = false;
  let 다시감기 = () => {};
  const 정체 = new Promise((_resolve, reject) => {
    다시감기 = () => {
      clearTimeout(timer);
      if (끝났나) return;
      timer = setTimeout(() => {
        controller.abort();
        // 이름은 AbortError 그대로 — 호출부의 기존 취소 경로를 그대로 탄다.
        // `정체` 표식만 얹어, 무엇이 잘랐는지 사실로 갈릴 수 있게 한다.
        reject(Object.assign(new Error('stalled'), { name: 'AbortError', 정체: true }));
      }, stallMs);
      timer.unref?.(); // 프로세스를 붙잡지 않는다
    };
  });
  try {
    return await Promise.race([factory(다시감기), 정체]);
  } finally {
    끝났나 = true;
    clearTimeout(timer);
  }
}

/**
 * 모델 응답 한 번의 **살아있음 판정**을 한 자리에 모은다.
 *
 * - `totalMs > 0` 일 때만 총 시간 상한이 붙는다. 기본은 0 — **제품에는 총 시간 상한이 없다.**
 *   (끄는 길·조이는 길은 남긴다: 환경변수로 값을 주면 그 값이 상한이 된다.)
 * - `stallMs > 0` 이면 흐르기 시작한 뒤의 정체를 감시한다.
 *
 * 두 어댑터(`model-provider`·`chatgpt-model-client`)가 같은 판정을 쓰게 하려고 여기 둔다 —
 * 두 자리에 각자 적으면 한쪽만 고쳐지고 나머지 한쪽에서 그대로 잘린다(이번 결함의 모양).
 */
export async function withLiveness(factory, { totalMs = 0, stallMs = 0 } = {}, controller) {
  const 흐름 = () => withStallTimeout(factory, stallMs, controller);
  return totalMs > 0 ? withTimeout(흐름, totalMs, controller) : 흐름();
}
