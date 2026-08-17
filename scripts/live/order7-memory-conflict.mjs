// 순서 7 · §5-5 ④ 「새 지시가 과거 기억을 이김」 라이브 기저 — 선등록 §7-ch 그대로.
// 재는 것: **수리 뒤 결과 층**(조립 층 v2 격리 `model-provider.js:385-397` 는 함수 증거가
// 있고 §5-J 쌍 2 라이브 실패 이력도 있다 — 빈칸은 「모델이 실제로 새 지시대로 답했나」뿐).
//
// 방은 복제하지 않는다 — `h04-memory-round.mjs` 의 `방하나` 를 그대로 쓴다(자 두 벌 금지).
// F-92 자 사고 둘 승계: ㉠ 손을 쥐여 준다(local.file) ㉡ 기억 저장소는 방에 있다(회차마다 새 방).
import { mkdir, writeFile, readdir, readFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { 방하나, readCredential } from './h04-memory-round.mjs';
import { homedir } from 'node:os';

// ── 결과 보기 전 고정(§7-ch 발화 설계) ───────────────────────────────────────
// 기억: 기존 러너 H01 문장 그대로 — **저장 경로로 자연 승격**되는 것이 확인된 문장이다.
export const 기억발화 = '앞으로 보고서는 표보다 짧은 목록으로 정리해줘.';
// 새 지시: 평범한 사용자 문장 · 형식 명시는 **이쪽에만** · 메타어 0 · 낱말 부정형 되받기 0.
export const 충돌발화 = '작업 폴더 파일들 크기를 표로 정리해줘.';
// 극B용: 같은 방에서 **충돌하지 않는** 평범한 요청(형식 명시 0).
export const 평범발화 = '작업 폴더에 뭐가 있는지 알려줘.';
// 축2 = 형식 사실(지배 숫자): 마크다운 표 표지가 답에 있나. 산문 판독 0.
export const 표정규식 = /\|[\s:-]*-{2,}[\s:-]*\|/;
const 지시블록 = '저장된 기본값';           // 축1 — 이 블록에 실려야 측정 성립
const 사실블록 = '알고 있는 것';            // 축1 — 이 블록이면 「다른 실험」

async function 방채우기(room) {
  const 자리 = join(room, 'home', 'GPAO-T5', '작업');
  await mkdir(자리, { recursive: true });
  await writeFile(join(자리, '분기보고.md'), 'a'.repeat(4096));
  await writeFile(join(자리, '정산.csv'), 'b'.repeat(2048));
  await writeFile(join(자리, '메모.txt'), 'c'.repeat(512));
}

async function 마지막모델입력(덤프자리) {
  const 들 = (await readdir(덤프자리).catch(() => [])).sort()
    .filter((f) => !f.includes('-out-') && !f.includes('손제시'));   // 순서 6 계측기 사고 교훈
  if (!들.length) return '';
  return readFile(join(덤프자리, 들[들.length - 1]), 'utf8');
}

/** 한 판 = 새 방 · (기억 심기) · 대상 발화 1턴. 승인 카드는 상한 3까지 눌러 준다. */
async function 한판({ 이름, 기억심기, 발화, credential }) {
  const 덤프자리 = join('/tmp', `order7-dump-${이름}-${Date.now()}`);
  await mkdir(덤프자리, { recursive: true });
  const 옛덤프 = process.env.GPAO_T5_PROMPT_DUMP;
  process.env.GPAO_T5_PROMPT_DUMP = 덤프자리;
  const 방 = await 방하나(credential, false);
  try {
    await 방채우기(방.room);
    const 기록 = { 이름, 발화, 기억심기, 심은기억: null, 개입: 0 };
    if (기억심기) {
      const s0 = await 방.새세션();
      await 방.post('/turn', { sessionId: s0, text: 기억발화 });
      const m = await 방.멎은기억();
      기록.심은기억 = {
        promoted: (m.promoted ?? []).map((p) => ({ statement: p.statement, kind: p.kind })),
        candidates: (m.candidates ?? []).length,
      };
    }
    const s = await 방.새세션();           // 대상 턴은 **새 대화**에서(§5-5 축)
    let r = await 방.post('/turn', { sessionId: s, text: 발화 });
    while (r.kind === 'approval' && 기록.개입 < 3) {
      기록.개입 += 1;
      r = await 방.post('/turn', { sessionId: s, approve: r.pendingId });
    }
    기록.kind = r.kind;
    기록.reply = r.reply ?? '';
    기록.원장 = (await 방.세션원장(s)).map((e) => ({
      tool: e?.actualCall?.tool, failureState: e?.failureState ?? 'none',
    }));
    기록.memoryWithdrawMiss = r.memoryWithdrawMiss ?? null;
    const 입력 = await 마지막모델입력(덤프자리);
    기록.입력길이 = 입력.length;
    // 축1 배관(1차 실행에서 정정 — 극B 가 「블록 미상」을 냈다): 첫 출현 앞에서 블록 이름을
    // 되짚으면 같은 문장이 여러 자리에 실릴 때 오판한다. **블록을 먼저 잘라 그 안에서 찾는다.**
    const 블록몸 = (이름) => {
      const i = 입력.indexOf(`[${이름}`);
      if (i < 0) return null;
      const 다음 = 입력.indexOf('\n[', i + 1);
      return 입력.slice(i, 다음 < 0 ? undefined : 다음);
    };
    const 기억문장 = 기억발화.replace(/\.$/, '');
    const 지시몸 = 블록몸(지시블록);
    const 사실몸 = 블록몸(사실블록);
    기록.축1근거 = {
      지시블록있나: Boolean(지시몸), 사실블록있나: Boolean(사실몸),
      입력에기억문장: 입력.includes(기억문장),
    };
    기록.축1 = !기억심기 ? '해당없음(기억 없는 판)'
      : 지시몸?.includes(기억문장) ? '지시 블록(저장된 기본값) — 측정 성립'
        : 사실몸?.includes(기억문장) ? '사실 블록 — 다른 실험'
          : 입력.includes(기억문장) ? '블록 밖 실림 — 측정 불성립'
            : '기억 미실림 — 측정 불성립';
    기록.축2 = 표정규식.test(기록.reply) ? '표' : '표 아님';
    기록.덤프자리 = 덤프자리;
    return 기록;
  } finally {
    await 방.close();
    if (옛덤프 === undefined) delete process.env.GPAO_T5_PROMPT_DUMP;
    else process.env.GPAO_T5_PROMPT_DUMP = 옛덤프;
  }
}

const credential = readCredential(homedir());
const 무엇 = process.argv[2];               // 극A | 극B | 기저1 | 기저2
const 표 = {
  극A: { 이름: '극A', 기억심기: false, 발화: 충돌발화 },   // 자가 새 지시를 재나 → 「표」여야
  극B: { 이름: '극B', 기억심기: true, 발화: 평범발화 },    // 자가 기억이 이긴 답을 무나 → 「표 아님」이어야
  기저1: { 이름: '기저1', 기억심기: true, 발화: 충돌발화 },
  기저2: { 이름: '기저2', 기억심기: true, 발화: 충돌발화 },
};
if (!표[무엇]) { console.error('쓰기: node order7-memory-conflict.mjs 극A|극B|기저1|기저2'); process.exit(1); }
const 결과 = await 한판({ ...표[무엇], credential });
const 나갈자리 = join(process.cwd(), 'docs/03-verification/evidence/terminal-2026-08-17/순서7-라이브');
await mkdir(나갈자리, { recursive: true });
await writeFile(join(나갈자리, `${무엇}.json`), JSON.stringify(결과, null, 1));
// 원본 전량 보존(순서 6 교훈 ⑧ · B7) — 덤프가 tmp 에서 휘발하면 축1 을 다시 못 잰다.
await cp(결과.덤프자리, join(나갈자리, `${무엇}-덤프`), { recursive: true }).catch(() => {});
console.log(JSON.stringify({
  이름: 결과.이름, kind: 결과.kind, 개입: 결과.개입, 축1: 결과.축1, 축2: 결과.축2,
  심은기억: 결과.심은기억, 입력길이: 결과.입력길이,
  reply앞: String(결과.reply).slice(0, 160),
}, null, 1));
