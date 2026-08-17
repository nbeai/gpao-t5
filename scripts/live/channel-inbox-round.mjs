// 국면 4 슬라이스 1 · **채널 조회 손 라이브 회차** — 판정자다(§4-b 7번).
//
// 재는 것: **"텔레그램으로 뭐 왔어?" 한 문장이 실제 도착분으로 끝나는가.**
// 검사 초록·영수증 존재는 손 검사가 아니다(손 관리자 기각). 자는 **밖**에 있어야 한다 —
// 그래서 이 대본이 **투입 집합을 직접 만들고**, 답을 그 원본과 문자로 대조한다.
//
// 선등록(국면4-슬라이스1-선등록.md §9) 그대로:
//   투입 세 종  ⓐ 통과할 것  ⓑ 게이트가 거절할 것  ⓒ 아무것도 없는 채널(슬랙)
//   대조        ⓐ 누락 0 · 생성 0 · ⓑ 가 집계로 보인다 · ⓒ 에 「수신기 없음」이 선다
//   왕복        텔레그램에서 물은 회차와 웹에서 물은 회차를 **따로** 돌린다
//   음성        아무것도 안 온 새 방에서 「없다」가 나온다
//   ★ 자기 오염 차단  "뭐 왔어?" 를 텔레그램 방에서 물으면 **그 질문 자체**가 그 방 transcript 에
//      channel 표시로 들어간다(server.js:4041). 그래서 **회차마다 새 방·새 서버**다.
//   ★ 민감값 양성 대조  durableUserText 는 민감값이 있으면 **문장 전체**를 placeholder 로 바꾼다.
//      모르고 재면 「누락 1건」으로 읽고 **없는 결함을 만든다**(F-104·F-105 계열).
//
// 방은 자기 것을 판다 — `방하나`(h04-memory-round)는 채널을 안 세운다(손 주입표에 채널이 없다).
// 오너 자리는 **읽기만** 한다(자격 한 줄) · `process.exit` 금지 · 서버는 이 프로세스 안에서 뜬다.
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readCredential } from './h04-memory-round.mjs';

const MODEL_ID = process.env.GPAO_T5_MODEL_ID ?? 'gpt-5.1';
const 발화 = '텔레그램으로 뭐 왔어?';

// ── 투입 집합 — **결과 보기 전에 여기 고정한다.** 답은 이 원본과만 대조한다 ──────────
export const 투입 = {
  통과: [
    { userId: 'u-오너', text: '내일 회의 자료 준비됐나요?' },
    { userId: 'u-오너', text: '견적서 초안도 같이 보내주세요' },
    { userId: 'u-오너', text: '금요일 미팅은 3시로 옮겼습니다' },
  ],
  // 민감값 양성 대조 — 이 한 건은 **placeholder 로 바뀌어 저장된다**(누락이 아니다).
  민감: { userId: 'u-오너', text: '열쇠는 sk-proj-ABCDEFGH12345678 이에요' },
  거절: [
    { userId: 'u-모르는1', text: '광고입니다 클릭하세요' },
    { userId: 'u-모르는2', text: '안녕하세요 누구세요' },
    { userId: 'u-모르는2', text: '답장 좀 주세요' },
  ],
};
// 답에 절대 나오면 안 되는 것 — 거절분 신분(집계만 낸다) · 민감값 원문.
export const 새면안되는것 = ['u-모르는1', 'u-모르는2', 'sk-proj-ABCDEFGH12345678', '광고입니다'];

const importFrom = (p) => import(new URL(`../../${p}`, import.meta.url).href);

/** 격리 방 하나 + 채널이 선 서버 하나. 회차마다 새로 판다. */
async function 채널방(credential, { 이름 }) {
  const room = await realpath(await mkdtemp(`/tmp/ch-inbox-${이름}-`));
  const home = join(room, 'home');
  const stateDir = join(room, 'state');
  for (const p of [home, stateDir]) await mkdir(p, { recursive: true });
  const ownerHome = await realpath(homedir());
  if (room.startsWith(ownerHome) || ownerHome.startsWith(room)) throw new Error('격리 방과 실제 홈이 겹친다');

  const processEnv = {
    ...process.env,
    HOME: home, GPAO_T5_HOME: home, GPAO_T5_DATA_DIR: stateDir,
    GPAO_T5_TCELL: 'off', GPAO_T5_CUA_BIN: '', GPAO_T5_DESKTOP_BIN: '', GPAO_T5_BROWSER_PATH: '',
    GPAO_T5_MODEL_PROVIDER: 'openai',
    OPENAI_API_KEY: credential.key, GPAO_T5_MODEL_BASE_URL: credential.baseUrl,
    GPAO_T5_MODEL_ID: MODEL_ID,
    GPAO_T5_MODEL_TIMEOUT_MS: '0', GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0',
    // ⓒ 축이 성립하려면 **텔레그램만** 수신기가 서야 한다(liveChannels 가 토큰으로 판정한다).
    TELEGRAM_BOT_TOKEN: 'live-round-fake-token', SLACK_BOT_TOKEN: '',
  };
  const 이전 = new Map();
  for (const [k, v] of Object.entries(processEnv)) { 이전.set(k, process.env[k]); process.env[k] = String(v); }
  const 되돌리기 = () => { for (const [k, v] of 이전) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

  let server;
  try {
    const [srv, st, loc, prov, ctx, tr, al, cib, lc] = await Promise.all([
      importFrom('src/surface/server.js'), importFrom('src/surface/session-store.js'),
      importFrom('src/surface/install-locator.js'), importFrom('src/runtime/model-provider.js'),
      importFrom('src/surface/demo-context.js'), importFrom('src/runtime/tool-runner.js'),
      importFrom('src/surface/allowlist-store.js'), importFrom('src/runtime/channel-inbox-tool.js'),
      importFrom('src/surface/live-context.js'),
    ]);
    const store = new st.SessionStore(stateDir);
    const allowlistStore = new al.AllowlistStore(stateDir);
    await allowlistStore.allow('telegram', { userId: 'u-오너', label: '오너' });

    // 채널 사실은 **제품이 내는 그대로** 쓴다 — 대본이 채널 목록을 따로 짜면 두 진실이 된다.
    const channels = lc.liveChannels(processEnv);
    const connectors = channels.map((c) => c.connector);

    // 손은 둘: 조회 손(제품 실물) + 발송 손 자리(승인 카드가 안 뜨게 두지 않는다 — 안 쓴다).
    const 손목록 = ['telegram.inbox'];
    const 손구현 = {
      'telegram.inbox': cib.makeChannelInboxTool({
        store, allowlist: allowlistStore, channels: () => channels,
      }),
    };
    const env = ctx.demoEnv({ include: 손목록, hands: 손목록 });
    env.model = { id: MODEL_ID, strengths: '자연 대화·판단', authSignal: 'ok' };
    const identity = await loc.설치신분(stateDir);
    const { model } = prov.selectLiveModel(processEnv);
    server = srv.makeServer({
      store, env, allowlistStore, channels, connectors,
      tools: new tr.ToolRunner(손구현),
      descriptors: ctx.demoDescriptors({ include: 손목록 }).filter((d) => 손목록.includes(d.id)),
      model, processEnv, modelProviderId: () => 'openai',
      runtimeEnvironment: { locality: 'this_computer', networkExposure: 'loopback_only', costTracking: 'not_tracked' },
      enableAgentDelegation: false,
      surfaceToken: identity.token, installId: identity.installId,
    });
    const port = await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', () => { server.off('error', rej); res(server.address().port); });
    });
    const headers = { 'content-type': 'application/json', cookie: `t5_surface=${identity.token}` };
    const post = async (path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
      const t = await r.text();
      try { return JSON.parse(t); } catch { throw new Error(`비JSON(${r.status}): ${t.slice(0, 200)}`); }
    };
    return {
      room, store, post,
      새세션: async () => (await post('/sessions')).id,
      close: async () => { if (server) await new Promise((r) => server.close(r)); 되돌리기(); },
    };
  } catch (e) {
    if (server) await new Promise((r) => server.close(r));
    되돌리기();
    throw e;
  }
}

/** 도착분을 방에 넣는다. 각 건이 한 턴을 돈다(모델 호출). 방 하나당 chatId 하나. */
async function 도착시키기(방, 목록, { chatId = 'chat-1' } = {}) {
  const 세션 = await 방.새세션();
  const 결과 = [];
  for (const m of 목록) {
    const r = await 방.post('/channel/inbound', {
      sessionId: 세션, channel: 'telegram', chatId,
      userId: m.userId, text: m.text, isDirectMessage: true,
    });
    결과.push({ 보낸이: m.userId, 원문: m.text, kind: r?.kind ?? r?.body?.kind ?? null, reason: r?.reason ?? r?.body?.reason ?? null });
  }
  return { 세션, 결과 };
}

/** 한 회차. 어디서 묻는지(웹/텔레그램)와 무엇을 넣을지가 다르다. */
async function 한회차({ 이름, credential, 넣기 = true, 어디서 = '웹', 발화하나 = 발화 }) {
  const 방 = await 채널방(credential, { 이름 });
  const 기록 = { 이름, 어디서, 발화: 발화하나, 투입: null, 답: null, 개입: 0, 원장: [], 걸린ms: null };
  try {
    if (넣기) {
      const 통과 = await 도착시키기(방, [...투입.통과, 투입.민감]);
      const 거절 = await 도착시키기(방, 투입.거절, { chatId: 'chat-모르는' });
      기록.투입 = { 통과: 통과.결과, 거절: 거절.결과, 통과세션: 통과.세션 };
    }
    // 묻는 자리 — 웹이면 **새 대화**(그 세션엔 channel 항목이 0건이다 · 교차 세션 축).
    let 물을세션;
    if (어디서 === '웹') 물을세션 = await 방.새세션();
    else 물을세션 = 기록.투입?.통과세션 ?? await 방.새세션();

    const t0 = Date.now();
    let r;
    if (어디서 === '웹') {
      r = await 방.post('/turn', { sessionId: 물을세션, text: 발화하나 });
      while (r.kind === 'approval' && 기록.개입 < 3) { 기록.개입 += 1; r = await 방.post('/turn', { sessionId: 물을세션, approve: r.pendingId }); }
    } else {
      // 왕복 축: **텔레그램에서 물으면 답이 그 대화로 돌아오는가.**
      const 응답 = await 방.post('/channel/inbound', {
        sessionId: 물을세션, channel: 'telegram', chatId: 'chat-1',
        userId: 'u-오너', text: 발화하나, isDirectMessage: true,
      });
      r = 응답?.body ?? 응답;
    }
    기록.걸린ms = Date.now() - t0;
    기록.kind = r?.kind ?? null;
    기록.답 = r?.reply ?? r?.userSafeSummary ?? '';
    기록.원장 = ((await 방.store.load(물을세션))?.ledgerEntries ?? [])
      .map((e) => ({ tool: e?.actualCall?.tool, failureState: e?.failureState ?? 'none', 요약: e?.userSafeSummary ?? null }));
    기록.돌아온자리 = 물을세션;
  } finally {
    await 방.close();
  }
  return 기록;
}

/** 채점 — **기계 대조만.** 산문 판독 0.
 *
 * ★ 1회차 실행 뒤 드러난 **자의 결함 둘**(정정 · 소급 수정 아님 · 근거 등재):
 *   ㉠ 「경계 구절」 축을 **모델 최종 답의 문자**로 쟀다 — 그건 모델에게 문구 복창을 요구하는
 *      자다("모델은 같은 답을 낼 수 없다"). 손이 낸 사실문은 **원장의 userSafeSummary** 다.
 *      그래서 축을 둘로 가른다: 커널이 실었나(원장) / 모델이 옮겼나(답). 앞이 지배 숫자다.
 *   ㉡ 음성 회차에 통과분 축(ⓐ 누락 0)을 그대로 댔다 — 아무것도 안 넣은 방에서 통과분이
 *      나오면 **실패**여야 하는데 「누락」으로 읽혔다. 회차 성질에 따라 뒤집는다.
 */
export function 채점(기록) {
  const 답 = String(기록.답 ?? '');
  const 조회원장 = 기록.원장.filter((e) => e.tool === 'telegram.inbox');
  const 원장문 = 조회원장.map((e) => String(e.요약 ?? '')).join(' ');
  // ⓐ 누락 0 — 통과분 세 건의 **고유 낱말**이 답에 있나(민감 1건은 placeholder 라 제외).
  const 핵심 = [['회의', '자료'], ['견적서'], ['금요일', '3시']];
  const 누락 = 핵심.filter((낱말들) => !낱말들.some((w) => 답.includes(w)));
  // 생성 0 — 넣지 않은 것이 답에 있나(거절분 원문·민감값 원문·거절분 신분).
  const 샌것 = 새면안되는것.filter((w) => 답.includes(w));
  const 넣었나 = Boolean(기록.투입);
  const 슬랙축 = 기록.이름 === '슬랙';
  return {
    손을불렀나: 조회원장.length > 0,
    조회실패: 조회원장.filter((e) => e.failureState !== 'none').length,
    // 통과분 축 — 넣은 회차는 「전량 등장」, 안 넣은 회차는 「하나도 안 등장」이 초록이다.
    'ⓐ통과분': 슬랙축 ? null : (넣었나 ? 누락.length === 0 : 누락.length === 핵심.length),
    누락목록: 누락.map((x) => x[0]),
    '생성0': 샌것.length === 0,
    샌것,
    'ⓑ거절분집계': 넣었나 && !슬랙축 ? (/모르는 사람|허용 목록 밖|모르는 발신자/.test(답) && /\d+\s*명/.test(답)) : null,
    // ★ 지배 숫자 — **손이 사실문을 실었나**(커널 축). 모델 문구 복창을 요구하지 않는다.
    '경계구절·원장': /처리한 것 기준/.test(원장문),
    // 참고 축(지배 아님) — 모델이 그 뜻을 답으로 옮겼나. 문구는 매번 다르다.
    '경계뜻·답': /처리한 것|볼 수 있는 것|확인한|제가 볼 수 없/.test(답),
    // ⓒ 축 — 수신기 없는 채널은 **빈 목록이 아니라** 「배선 없음」이 서야 한다.
    'ⓒ배선없음': 슬랙축 ? /배선|보고 있지 않|받지 않/.test(답) : null,
    'ⓒ안왔다로답함': 슬랙축 ? /안 왔|없어요|0건/.test(답) : null,
    개입0: 기록.개입 === 0,
  };
}

export async function 회차들() {
  const credential = readCredential(await realpath(homedir()));
  const 결과 = [];
  // 회차 1 — 웹에서 묻는다(교차 세션 축 · 자기 오염 0).
  결과.push(await 한회차({ 이름: '웹', credential, 넣기: true, 어디서: '웹' }));
  // 회차 2 — 텔레그램에서 묻는다(왕복 축). **새 방**이다 — 회차 1 의 자취를 안 물려받는다.
  결과.push(await 한회차({ 이름: '왕복', credential, 넣기: true, 어디서: '텔레그램' }));
  // 회차 3 — 아무것도 안 넣은 새 방(음성 대조). 「없다」가 나와야 한다.
  결과.push(await 한회차({ 이름: '음성', credential, 넣기: false, 어디서: '웹' }));
  // 회차 4 — ⓒ 축. 수신기가 없는 채널을 묻는다. **빈 목록이면 실패**다.
  결과.push(await 한회차({ 이름: '슬랙', credential, 넣기: true, 어디서: '웹', 발화하나: '슬랙으로는 뭐 왔어?' }));
  return 결과;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const 자리 = process.argv[2];
  if (!자리) throw new Error('사용법: node scripts/live/channel-inbox-round.mjs <저장자리>');
  const 결과 = await 회차들();
  const 표 = 결과.map((r) => ({ ...r, 채점: 채점(r) }));
  await mkdir(자리, { recursive: true });
  await writeFile(join(자리, '회차.json'), JSON.stringify({ 모델: MODEL_ID, 발화, 투입, 표 }, null, 2));
  for (const r of 표) {
    console.log(`\n── ${r.이름}(${r.어디서}) · ${r.걸린ms}ms · kind=${r.kind} · 개입 ${r.개입}`);
    console.log('  답:', String(r.답).replace(/\n/g, ' ').slice(0, 300));
    console.log('  채점:', JSON.stringify(r.채점));
  }
  console.log(`\n원본: ${join(자리, '회차.json')}`);
}
