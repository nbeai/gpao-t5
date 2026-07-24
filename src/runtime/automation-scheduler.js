// L3 · Automation Scheduler — in-process 반복 구동(최소). 실제 cron/daemon 아님:
// setInterval + unref로 프로세스를 붙잡지 않고, 프로세스가 죽으면 함께 죽는다(외부 상주 없음).
// 발화는 항상 trusted_runtime_event로 표식 — tick은 사용자 버튼이 아니라 런타임 이벤트다(§8.3).

export class AutomationScheduler {
  /**
   * @param {{onTick:(trigger:{source:string,firedBy:string})=>Promise<*>, intervalMs?:number}} opts
   */
  constructor({ onTick, intervalMs = 60_000 }) {
    this.onTick = onTick;
    this.intervalMs = intervalMs;
    this._timer = null;
  }

  start() {
    if (this._timer) return this; // 중복 기동 금지
    this._timer = setInterval(() => { this.fire(); }, this.intervalMs);
    this._timer.unref?.(); // 데몬 아님 — 프로세스를 살려두지 않는다
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    return this;
  }

  /** 1회 발화 — 항상 trusted_runtime_event. 테스트는 이 메서드를 직접 호출(실타이머 불필요). */
  async fire() {
    return this.onTick({ source: 'trusted_runtime_event', firedBy: 'scheduler' });
  }
}
