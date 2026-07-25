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
