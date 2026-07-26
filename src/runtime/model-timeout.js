// L3 · ModelClient 타임아웃 데코레이터 (안정성 P-STAB-1). 느리거나 멈춘 모델이 턴을 무한 매달지 않게 한다.
// 왜: model.respond가 영영 안 끝나면 스트림은 heartbeat만 계속 나가고 턴이 안 닫히며, withSessionQueue가
//   직렬화하므로 **그 세션의 후속 턴까지 전부 막힌다**(T3 "잘 되다가 갑자기 멈춤" 재발 지점).
// 어떻게: respond를 타임아웃과 race해 **초과 시 reject** → 기존 오류 경로(stream recoverable_error+complete,
//   POST 500)가 턴을 바운드해 닫고 큐를 푼다. 어떤 ModelClient(스텁·실 provider)에도 같은 계약으로 씌운다.

export class ModelTimeoutError extends Error {
  constructor(ms) {
    super(`model response timed out after ${ms}ms`);
    this.name = 'ModelTimeoutError';
    this.isModelTimeout = true; // 오류 경로가 사용자 언어를 고르는 표식(진단 원문 아님)
  }
}

/**
 * ModelClient를 타임아웃으로 감싼다. ms<=0이면 원본 그대로(무제한).
 * @param {import('./model-client.js').ModelClient} model
 * @param {number} ms
 * @returns {import('./model-client.js').ModelClient}
 */
export function withModelTimeout(model, ms) {
  if (!ms || ms <= 0) return model;
  return {
    async respond(tc) {
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ModelTimeoutError(ms)), ms);
        timer.unref?.(); // 프로세스를 붙잡지 않는다(cron/daemon 아님)
      });
      try {
        return await Promise.race([model.respond(tc), timeout]);
      } finally {
        clearTimeout(timer); // 원본이 먼저 끝나면 타이머 정리(누수 방지)
      }
    },
  };
}
