// L3 · 자기보존 경계 (P6-T3) — **T5 는 자기를 죽이는 명령을 직접 실행하지 않는다.**
//
// 이건 일반적인 위험 명령과 다르다. 파일은 휴지통에서 되살리고 설치는 지우면 되지만,
// T5 가 자기 프로세스를 죽이면 **사용자에게 그 사실을 말할 주체가 사라진다.**
// 승인 카드도 못 띄우고, 원장도 못 남기고, "껐어요"라고 말할 수도 없다.
// 데이터 디렉터리도 마찬가지다 — 세션·원장·연결이 통째로 사라지면 복구 경로가 없다.
//
// 샌드박스는 이걸 못 잡는다. 시그널 보내기는 파일 쓰기가 아니기 때문이다.
// 그래서 커널 경계와 **별도로** 한 겹 더 둔다(둘이 서로를 대신하지 못한다).
//
// **막는 것이 아니라 손을 바꾸는 것이다**: 재시작이 필요하면 사용자가 직접 하도록 길을 준다.
import { sep } from 'node:path';

const within = (dir, p) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/**
 * 이 명령이 T5 자신을 향하는가. **애매하면 걸린다**(자기보존은 안전 쪽으로 틀린다).
 * @param {string} command
 * @param {{selfPid?:number, dataDir?:string, extraPids?:number[]}} [ctx]
 * @returns {{why:string, what:string}|undefined}
 */
export function lifecycleRisk(command, ctx = {}) {
  const cmd = String(command ?? '');
  if (!cmd.trim()) return undefined;
  const pids = [ctx.selfPid ?? process.pid, ...(ctx.extraPids ?? [])];

  // ① 자기 PID 를 향한 시그널
  if (/\bkill\b/.test(cmd)) {
    for (const pid of pids) {
      if (new RegExp(`\\b${pid}\\b`).test(cmd)) {
        return { why: '지금 돌고 있는 저 자신을 끄는 명령이에요', what: `pid ${pid}` };
      }
    }
  }
  // ② 이름으로 T5 를 골라 죽이는 것(pkill·killall 은 PID 를 안 쓴다)
  if (/\b(pkill|killall)\b/.test(cmd) && /(gpao|t5|server\.js|node\b)/i.test(cmd)) {
    return { why: '저를 이름으로 찾아 끄는 명령이에요', what: cmd.trim() };
  }
  // ③ 기억이 통째로 사라지는 것 — 세션·원장·연결이 여기 있다
  const dataDir = ctx.dataDir;
  if (dataDir && /\b(rm|rmdir|unlink|shred|mv)\b/.test(cmd)) {
    const paths = cmd.match(/\/[^\s'"`]+/g) ?? [];
    if (cmd.includes(dataDir) || paths.some((p) => within(p, dataDir) || within(dataDir, p))) {
      return { why: '대화·원장·연결 기록이 통째로 사라져요', what: dataDir };
    }
  }
  // ④ 사용자가 모르는 사이 자동으로 뜨거나 사라지는 것
  if (/\blaunchctl\b|LaunchAgents|LaunchDaemons/.test(cmd)) {
    return { why: '컴퓨터가 켜질 때마다 자동으로 도는 설정을 바꾸는 명령이에요', what: cmd.trim() };
  }
  return undefined;
}

/** 막을 때도 막다른 답을 주지 않는다 — 왜 조심하는지와 되는 길을 함께 준다. */
export function lifecycleMessage(risk) {
  return {
    userSafeSummary: `그건 제가 직접 하지 않아요 — ${risk.why}.`,
    nextSafeAction: '제가 저를 끄면 끝났다는 말씀도 못 드려요. 터미널에서 직접 해 주시면 그 뒤로 이어서 도울게요.',
  };
}
