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
  // ②-b **남의 프로세스를 끄는 것.** probe 가 증거를 못 남길 수 있다.
  // 실측(오너 라이브 2026-07-28): 모델이 `kill 4356 4354 2>/dev/null || true` 를 썼다.
  // 방어적 셸 관용구인데 `2>/dev/null || true` 가 **막혔다는 증거를 지운다.** exitCode 0 이라
  // 런타임은 "아무것도 안 막혔다 = 변경 없음"으로 읽고, 승인으로 안 보내고, granted 가 안 붙고,
  // 다시 probe 로 돌아 또 막힌다. 사용자는 승인을 눌러도 아무 일이 안 일어난다.
  //
  // 이 파일이 존재하는 이유가 그것이다(머리말): **샌드박스가 못 잡는 종류는 여기서 잡는다.**
  // 끄는 일은 되돌릴 수 없으므로 승인 경계가 맞다 — 능력을 없애는 게 아니라 승인 뒤
  // granted 로 실제 실행된다. `managed` 는 T5 가 켠 것이다: 스스로 켠 것을 끄는 데 승인을
  // 다시 받게 하면 그게 능력 축소다("꺼줘" 한 마디로 끄던 길을 유지한다).
  if (/\b(kill|pkill|killall)\b/.test(cmd)) {
    const 겨냥한pid = (cmd.match(/\b\d{2,}\b/g) ?? []).map(Number);
    const managed = ctx.managed == null ? [] : [].concat(ctx.managed).map(Number);
    const 전부내것 = 겨냥한pid.length > 0 && 겨냥한pid.every((n) => managed.includes(n));
    if (!전부내것) {
      // **`approvable` 이 이 항목을 다른 것들과 가른다.** 위의 ①②③은 자기보존이라
      // 승인해도 하지 않는다(T5 가 자기를 죽이면 말할 주체가 사라진다). 이건 다르다 —
      // 사용자가 시킨 일이고, 승인하면 실제로 해야 한다. 승인 경계일 뿐 금지가 아니다.
      // 이 표시가 없으면 `kill` 이 영영 실행되지 않는다(실측: 승인해도 아무 일이 안 났다).
      return { why: '돌고 있는 프로그램을 끄는 일이에요', what: cmd.trim().slice(0, 120), approvable: true };
    }
  }
  // ③ 기억이 통째로 사라지는 것 — 세션·원장·연결이 여기 있다
  const dataDir = ctx.dataDir;
  if (dataDir && /\b(rm|rmdir|unlink|shred|mv)\b/.test(cmd)) {
    const paths = cmd.match(/\/[^\s'"`]+/g) ?? [];
    if (cmd.includes(dataDir) || paths.some((p) => within(p, dataDir) || within(dataDir, p))) {
      return { why: '대화·원장·연결 기록이 통째로 사라져요', what: dataDir };
    }
  }
  // ④ 부팅 자동 실행을 **바꾸는** launchctl 동작.
  // 경로 이름만 읽는 것까지 막으면 "컴퓨터가 왜 느린지 봐줘"의 시작조차 승인으로 밀린다.
  // 파일 쓰기는 probe 샌드박스가 실제로 막고, 여기서는 파일 경로가 아니라 서비스를 실제로
  // 올리거나 내리는 명령만 별도 보호한다.
  if (/\blaunchctl\s+(?:load|unload|bootstrap|bootout|enable|disable|kickstart|start|stop|submit|remove)\b/.test(cmd)) {
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
