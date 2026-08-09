// L4 · 라이브 컨텍스트 — 실제 자격 상태를 env·tools에 **함께** 반영한다(단일 진실).
// 감사 보정(2.0-A §10.1): 도구함 상태 = 실제 실행 상태. slack.post는 SLACK_BOT_TOKEN이 있어야
//   사용 가능(usable/green)이고, 없으면 연결 필요(needs_connection/yellow)로 보이며 실행도 불가하다.
//   → 도구함(projectToolbox)과 실행 게이트(isToolExecutable)가 같은 env를 읽어 어긋나지 않는다.
import { demoEnv, demoTools, demoDescriptors, demoConnectors } from './demo-context.js';
import { makeRobotsCheck } from '../runtime/robots.js';
import { makeWebCollector } from '../runtime/web-collector.js';
import { makeWebSearchTool } from '../runtime/web-search-tool.js';
import { makeDesktopTool } from '../runtime/desktop-tool.js';
import { makeDesktopActTool } from '../runtime/desktop-act-tool.js';
import { makeDesktopNativeDriver } from '../runtime/desktop-native-driver.js';
import { makeCuaDriver } from '../runtime/desktop-cua-driver.js';
import { 화면손찾기, 앱을제자리에 } from '../runtime/desktop-bin.js';
import { DESKTOP_SLOT, 화면등록소 } from '../runtime/desktop-slot.js';
import { makeChannelSender } from '../runtime/channel-sender.js';
import { makeLocalFileTool } from '../runtime/local-file.js';
import { makeCapsuleTool } from '../runtime/capsule.js';
import { sandboxAvailable } from '../runtime/sandbox.js';
import { defaultFileRoots, 부르는이름들 } from '../runtime/file-scope.js';
import { makeLocalTerminalTool } from '../runtime/local-terminal.js';
import { makeLocalProcessTool } from '../runtime/local-process.js';
import { makeLocalLocateTool } from '../runtime/local-locate.js';
import { makeLocalDiscoveryTool } from '../runtime/local-discovery.js';
import { makeLocalSystemTool } from '../runtime/local-system.js';
import { ProcessStore } from '../runtime/process-store.js';
import { defaultSessionDir } from './session-store.js';
import { makeSessionSearchTool } from '../runtime/session-search-tool.js';
import { makeBrowser, findBrowserSync } from '../runtime/browser.js';
import { makeHostManners } from '../runtime/host-manners.js';
import { makeBrowserObserveTool, makeBrowserActTool } from '../runtime/browser-tool.js';
import { EXECUTABLE_KINDS, makeConnectorConnectTool } from '../runtime/connector-connect.js';
import { DeclaredConnectorStore } from './declared-connector-store.js';
import { makeConnectorDeclareTool } from '../runtime/connector-declare.js';
import { ConnectorCredentialStore } from './connector-credential-store.js';
import { makeModelConnection } from './model-connection.js';
import { defineConnector } from '../kernel/l2-plan/connector-profile.js';
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';
import { defineChannel } from '../kernel/l2-plan/channel-registry.js';

/**
 * 라이브 채널 상태를 **실제 자격**에서 파생한다(P6-16 blocker 보정). demoChannels(고정 fixture)를
 * 라이브 표면에 쓰지 않는다 — "보이는 것 = 실제 가능한 것". 토큰/수신 설정 없으면 connected:false →
 * `/channels`가 "받을 준비됨(초록)"으로 보이지 않고 연결 안내를 준다(2.0-A slack 초록 오표시와 같은 계열).
 * @param {Record<string,string|undefined>} processEnv
 */
/**
 * **로그인된 브라우저 관찰 — 아직 옵트인이다**(스윕 2번 진행 중 · 2026-08-09).
 *
 * 기본 켬으로 뒤집었다가 **되돌렸다.** 봉인
 * (`test/a1-browser-opens-only-when-asked.test.js` — *"밝힐 때만 켠다 — 문서가 금지한
 * 우회로를 기본값으로 열지 않는다"*)이 정확히 물었고, 그 말이 맞다:
 *
 *   봉인이 지키는 것은 "플래그의 값"이 아니라 **"우리가 크롬 동의 시트를 직접 누르는 경로가
 *   기본으로 열리는 것"** 이다. 그 경로는 `desktop-cua-driver.js` 에 **아직 있다**
 *   (`browser_prepare` 실패 시 발화 게이트 안에서 '허용' 버튼 클릭). 2026-08-09 실측에서
 *   그 갈래를 **안 탔을 뿐**(로그인 화면이 시트 클릭 0 으로 읽혔다) 없어진 게 아니다.
 *   "안 타더라"에 기대어 기본값을 여는 것은 봉인을 결과에 맞춰 고치는 것이다.
 *
 * **올바른 순서**: ① 시트 클릭 갈래를 걷는다(벤더 계약이 정본 — 승인된 요청이면 드라이버가
 * 스스로 체크박스를 토글한다 · `describe browser_prepare`) → ② 봉인의 근거가 사라진다 →
 * ③ 그때 기본 켬을 연다. ①은 실패 시 붙기가 아예 막힐 수 있어(한국어 시트) PM 판정 자리다.
 *
 * F-54(화면도 자리다)는 이 플래그와 **독립**이다 — 창 목록 관측은 프로필 붙기가 아니다.
 */
export const 브라우저프로필허용 = (env = {}) => env?.GPAO_T5_BROWSER_PROFILE === '1';

export function liveChannels(processEnv = {}) {
  const tgToken = processEnv.TELEGRAM_BOT_TOKEN;   // 없으면 텔레그램 수신 불가 → 미연결
  const slackToken = processEnv.SLACK_BOT_TOKEN;   // 슬랙 채널 자격도 실제 토큰 유무로
  return [
    defineChannel({
      id: 'telegram',
      connector: defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: Boolean(tgToken) }),
      // P5-1: 토큰이 있으면 실수신기(long polling)가 실제로 돈다 — 이제 "받는다"고 말해도 참이다.
      // 오너 결정: 봇은 누구나 말을 걸 수 있으므로 기본은 허용된 사람만.
      inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send', hasReceiver: Boolean(tgToken),
    }),
    defineChannel({
      id: 'slack.channel',
      connector: defineConnector({ id: 'slack.channel', label: '슬랙 채널', kind: 'channel', authState: 'oauth', connected: Boolean(slackToken) }),
      inboundPolicy: 'mention_required', outboundTool: 'slack.post',
    }),
  ];
}

/**
 * @param {Record<string,string|undefined>} [processEnv]  실제 자격(SLACK_BOT_TOKEN 등)
 * @param {{fetchImpl?:Function}} [deps]  테스트 주입용 — 기본은 실 fetch(라이브 서버만 실제 호출)
 * @returns {{env:object, tools:object, descriptors:object[], channels:object[], model:object}}
 */
export function liveDeps(processEnv = {}, deps = {}) {
  const slackToken = processEnv.SLACK_BOT_TOKEN;
  const tgToken = processEnv.TELEGRAM_BOT_TOKEN;
  const webTimeoutMs = Number(processEnv.GPAO_T5_WEB_TIMEOUT_MS ?? 15_000);
  // 브라우저는 **있으면 쓰고 없으면 없는 대로**. 동기 탐지 — descriptor 조립이 동기다.
  const browserPath = processEnv.GPAO_T5_BROWSER_PATH ?? findBrowserSync();
  // P2-11: **하나의 예의를 두 손이 나눠 쓴다.** 같은 IP 로 나가므로 web.collect 가 만든 제한에
  // 브라우저도 걸린다(실측). 따로 두면 한쪽이 절제해도 다른 쪽이 문을 닫는다.
  const manners = deps.manners ?? makeHostManners();
  // 사용자 데이터는 **세션 저장소와 같은 자리**에 둔다. 여기를 안 맞춰서 켠 프로세스 기록이
  // 소스 트리(src/surface/processes.json)에 쌓이고 로그가 /tmp 로 흩어졌다 — 라이브에서 드러났다.
  // 자기보존 경계(lifecycle guard)도 이 경로를 알아야 "내 기억을 지우는 명령"을 알아본다.
  const stateDir = processEnv.GPAO_T5_DATA_DIR ?? defaultSessionDir();
  const localHome = processEnv.GPAO_T5_HOME ?? processEnv.HOME;
  const browserHand = browserPath ? (deps.browser ?? makeBrowser({ browserPath, manners })) : undefined;
  // discovery는 서버가 소유한 같은 커넥터 배열을 읽는다. 나중에 붙거나 끊긴 상태도 다음 턴에서
  // 같은 진실을 본다. 도구가 서비스 목록을 따로 복제하지 않는다.
  let connectors = [];

  const senders = {
    'slack.post': makeChannelSender({ channel: 'slack', token: slackToken, defaultTarget: processEnv.SLACK_DEFAULT_CHANNEL }),
    // 채널이 outboundTool 로 선언한 것에는 실제 손이 있어야 한다. 와이어는 이미 있었고 배선만 없었다 —
    // 그래서 텔레그램은 "받을 준비가 됐어요"라고 말하면서 답장을 못 보냈다(감사 지적).
    'telegram.send': makeChannelSender({ channel: 'telegram', token: tgToken, defaultTarget: processEnv.TELEGRAM_DEFAULT_CHAT }),
  };
  // Phase 0-1: 로컬 파일은 **실제 손발**을 배선한다(스텁 금지 — 등록된 도구는 실제로 동작해야 한다).
  // **화면 손은 백엔드가 실제로 있을 때만 선다**(발자국 사다리 3칸 · 조건부 도구).
  // 경로를 여기 박지 않는다 — 없는 컴퓨터에서 "있는데 실패"로 보이면 없는 능력을 있다고
  // 말하는 것이다. 환경이 알려줄 때만 붙이고, 없으면 선언조차 안 딸려온다(1축의 배당금).
  // **드라이버가 둘이다 — 슬롯이 고른다.** cua 가 있으면 그것(3개 OS), 없으면 옛 네이티브(macOS).
  // 둘 다 같은 슬롯 계약을 채우므로 **손과 검사는 어느 쪽인지 모른다** — 그게 슬롯의 값이다.
  // **손을 스스로 찾는다**(PM 판정 2026-08-06 · 판 3차). 예전엔 `GPAO_T5_CUA_BIN` 만 봤고,
  // 그 값을 **아무데서도 안 세웠다** — 개발자가 시험 때 손으로 넣어 띄웠을 뿐이다.
  // 그래서 실험실에서는 계산기·카톡·크롬이 다 됐는데 **사장님이 켠 T5 에는 화면 손이 0개**였다.
  // 오너 규율: *"영향 0 레인 작업을 제품 효과로 보고하지 말 것."*
  // **앱이 없으면 먼저 놓는다**(오너 결정 2026-08-07 · 장착을 공식대로).
  //
  // 손을 찾기 **전에** 해야 한다 — `.app` 이 제자리에 있어야 드라이버가 데몬을 띄우고,
  // 그래야 TCC 가 `com.trycua.driver` 에 붙는다. 없으면 예전처럼 남의 권한을 빌리게 된다.
  // 네트워크를 안 쓴다(동봉된 서명 앱을 복사할 뿐). 있으면 안 덮고, 실패해도 기동을 안 막는다.
  // **기다리지 않는다** — 복사가 늦어도 T5 가 뜨는 것을 막으면 안 되고, 이번 턴에 못 쓰면
  // 다음 턴에 쓴다. 결과는 아무도 안 읽으므로 실패는 조용히 삼킨다(그 이유는 함수가 남긴다).
  앱을제자리에({}).catch(() => null);
  const cua백엔드 = 화면손찾기({ env: processEnv });
  const 화면백엔드 = processEnv.GPAO_T5_DESKTOP_BIN;
  const desktop = (cua백엔드 || 화면백엔드) ? (() => {
    const 등록소 = 화면등록소();
    if (!등록소.드라이버(DESKTOP_SLOT).length) {
      // 붙이는 순서가 고르는 순서다(슬롯 계약). cua 를 먼저 — 크로스 플랫폼이 요구다.
      // **사용자가 이미 로그인해 둔 브라우저에 붙는다**(CU-④ · 오너 결정 2026-08-06).
      // 오너 정본: *"로그인이 화면 뒤에 있다 — 터미널이 아무리 강해져도 이 자리는 안 열린다."*
      // **기본으로 켠다**(오너 지시 2026-08-07 · 노드 A ①). 밝혀야만 켜지면 CU-④ 로 만든 것이
      // 사장님이 켠 T5 에는 **없다** — 오늘 아침 `GPAO_T5_CUA_BIN` 과 똑같은 모양이고,
      // 사장님이 환경변수 이름을 알아야 하는 것 자체가 비전 위반이다
      // (*"API·MCP·CLI·환경변수 같은 말을 알고 싶어 하지 않는다"*).
      //
      // **끄는 길은 남긴다**(`=0`). 기본값만 뒤집는 것이지 선택을 없애는 게 아니다.
      //
      // 권한을 프로세스에 붙이는 것과 **문을 따는 것**은 다르다 — 크롬 동의 시트를 누르는
      // 것은 손이 **사장님 발화 안에서만** 한다(`desktop-cua-driver.js` · BUTLER §B).
      // **되돌렸다**(오너 지시 2026-08-07). 기본 켬으로 바꿨다가 `BROWSER.md` 를 읽고 되돌린다 —
      // 우리가 크롬 동의 시트를 직접 누르는 코드가 있는데, 문서가 그걸 못박아 금지한다:
      //   *"Missing, localized, or ambiguous controls are refused;
      //     **never click a similar-looking prompt yourself.**"*
      // 드라이버가 거부하는 것은 못해서가 아니라 **비슷하게 생긴 것을 눌러 엉뚱한 것을
      // 승인하는 사고를 막으려고 일부러** 그러는 것이다. 우리는 그 안전장치를 우회했고,
      // 기본 켬은 그 우회로를 사장님이 켜자마자 열어 두는 것이었다.
      //
      // 그리고 우리가 *"cua 가 한국어 크롬을 못 연다"* 고 판정한 그 관측 자체가
      // **잘못 장착된 상태**(IDE 셸에서 생 바이너리 spawn · `CuaDriver.app` 없음 ·
      // `CUA_DRIVER_EMBEDDED` 없음)에서 나온 것일 수 있다. 장착을 바로 세운 뒤 같은 질문을
      // 다시 던진다 — 그 전에는 이 우회로가 필요한지조차 판정할 수 없다.
      const 브라우저허용 = 브라우저프로필허용(processEnv);
      if (cua백엔드) {
        등록소.붙이기(DESKTOP_SLOT, makeCuaDriver({ binPath: cua백엔드, 기존프로필허용: 브라우저허용 }));
      }
      if (화면백엔드) 등록소.붙이기(DESKTOP_SLOT, makeDesktopNativeDriver({ binPath: 화면백엔드 }));
    }
    return makeDesktopTool({ drivers: 등록소.드라이버(DESKTOP_SLOT) });
  })() : undefined;
  // 행동 손은 **읽기 손과 따로 선다.** 권한 종류가 손 단위로 판정되므로 합치면
  // 읽기가 행동 등급으로 오르거나 행동이 읽기로 샌다(정본 §4.1 이 나눈 이유).
  const desktopAct = (cua백엔드 || 화면백엔드)
    ? makeDesktopActTool({ drivers: 화면등록소().드라이버(DESKTOP_SLOT) })
    : undefined;

  const tools = demoTools({
    ...(desktop ? { desktop } : {}),
    ...(desktopAct ? { desktopAct } : {}),
    // **찾는 손.** 읽는 손과 나뉘어 있어야 모델이 목록을 보고 출처를 고를 수 있다.
    // 같은 검색 층(무키 → 키)을 쓰지만, 이쪽은 **읽지 않는다**.
    webSearch: makeWebSearchTool({ timeoutMs: webTimeoutMs }),
    webCollector: makeWebCollector({
      timeoutMs: webTimeoutMs, manners,
      // 실제 robots.txt 를 확인한다. 안 넘기면 검사가 아예 안 돌아 "수집을 막은 페이지는 읽지 못한다"는
      // 능력 문장이 라이브에서만 거짓이 된다(감사 지적).
      robotsCheck: makeRobotsCheck({ timeoutMs: webTimeoutMs }),
    }),
    senders,
    localFile: makeLocalFileTool({
      dataDir: processEnv.GPAO_T5_DATA_DIR,
      roots: defaultFileRoots(processEnv),
      homeDir: localHome,
    }),
    localTerminal: makeLocalTerminalTool({ dataDir: stateDir }),
    // S4 캡슐 — **커널 격리를 쓸 수 있을 때만 선다.** 없는 능력을 있는 척하지 않는다
    // (`sandboxAvailable()` 이 false 면 손 목록에 아예 안 들어가고 descriptor 도 안 딸려온다).
    // 안에서 부를 수 있는 손은 파일 하나다 — 넓히려면 그 손의 격리 성질을 먼저 증명한다.
    capsule: sandboxAvailable() ? makeCapsuleTool({ 허용손: ['local.file'] }) : undefined,
    localLocate: makeLocalLocateTool({ home: localHome }),
    localDiscovery: makeLocalDiscoveryTool({ connectors: () => connectors }),
    localSystem: makeLocalSystemTool({}),
    localProcess: makeLocalProcessTool({ store: new ProcessStore(stateDir), dataDir: stateDir }),
    // 지난 대화 찾기 — 실제 세션 저장소에서. 지운 대화는 제외한다(휴지통이 검색으로 되살아나지 않게).
    sessionSearch: deps.sessionStore ? makeSessionSearchTool({ store: deps.sessionStore }) : undefined,
    // P2-10: 이 컴퓨터에 브라우저가 있을 때만 손을 배선한다. 없으면 descriptor 도 안 딸려온다
    // (liveToolIds 가 손에서 파생하므로 — 1축의 배당금). 없는 손을 선언하지 않는다.
    // 같은 브라우저 인스턴스를 둘이 나눠 쓴다(창을 두 개 띄우지 않는다).
    browserObserve: browserHand ? makeBrowserObserveTool({ browser: browserHand }) : undefined,
    browserAct: browserHand ? makeBrowserActTool({ browser: browserHand }) : undefined,
  });

  // 1축(단일 진실화): **라이브가 선언하는 도구 = 라이브에 실제 손이 있는 도구.** 손에서 파생한다.
  // 예전엔 여기 `LIVE_TOOL_IDS` 손 목록이 있었고, demo 목록을 그대로 선언하던 시절엔 `mail.send`
  // (핸들러가 아예 없다)를 "연결됨"으로 사용자와 모델에게 말했다 — 없는 능력을 있다고 한 것이다.
  // 목록을 손으로 맞추면 손발이 늘거나 줄 때 또 어긋난다(절대원칙 8). 이제 어긋날 수가 없다.
  // **조건부 선언도 파생의 원천에 알려야 한다.** `desktop.screen` 은 백엔드가 있을 때만
  // 선언이 생기는데, 여기서 그 사실을 안 넘기면 **손은 붙었는데 선언이 없는** 상태가 된다
  // (P5-B-0 이 막으려던 그 자리 — 실제로 배선하자마자 났다: 손 true · 선언 false).
  const 선언옵션 = { ...(desktop ? { desktop } : {}), ...(desktopAct ? { desktopAct } : {}) };
  const liveToolIds = demoDescriptors(선언옵션)
    .map((d) => d.id)
    .filter((id) => typeof tools?.tools?.[id]?.handler === 'function');

  // P5-B-0: **연결 전 서비스도 선언한다.** 예전엔 손 없는 선언을 통째로 걸러냈다 — 그때는
  // 그게 유령(`mail.send`)을 막는 유일한 방법이었기 때문이다. 이제 2축이 있으니 걸러낼 필요가
  // 없다: 선언은 남기고 executable:false + reason 으로 표시하면 model schema 에는 안 나온다.
  // 걸러내면 사용자는 그 서비스가 **존재한다는 것조차** 못 듣고, 모델은 빈 자리를 상상으로 메운다.
  const 연결전 = demoDescriptors(선언옵션)
    .filter((d) => d.connector && !liveToolIds.includes(d.id))
    .map((d) => d.id);

  // 전송 도구의 연결 상태는 실제 토큰 유무로 결정한다. 토큰 없으면 도구함에서 "연결이 필요해요"(노랑),
  // 실행 게이트에서도 실행 불가 — 승인만 받고 뒤늦게 실패하는 불일치를 없앤다.
  const env = demoEnv({
    ...선언옵션,
    include: [...liveToolIds, ...연결전],
    // P5-B-0: 실제 손 목록을 그대로 넘긴다 — env 가 손을 다시 추측하지 않게(두 진실 금지).
    hands: liveToolIds,
    // **모델이 실제로 읽는 자리는 여기다.** 아래 `descriptors` 만 채웠더니 모델은 여전히
    // 안 채워진 선언을 봤다(라이브 실측 2026-08-04: 답에 `{방}` 이 글자 그대로 나왔다).
    // `buildSelfState(env)` → `modelSchemasFor` 가 이 배열에서 나오므로 여기가 진짜 문이다.
    rooms: 부르는이름들(defaultFileRoots(processEnv)),
    factOverrides: {
      'slack.post': { connected: Boolean(slackToken) },
      'telegram.send': { connected: Boolean(tgToken) },
      // P2-10: 브라우저는 **이 컴퓨터에 있으면 연결된 것**이다(토큰이 필요 없다).
      // 이걸 빠뜨려서 손·선언은 붙었는데 executable=false 라 **모델에게 안 보였다**(라이브 실측).
      // 그때 모델은 브라우저 없이 "하단부 1812~1902줄을 봤다"고 지어냈다 — 없는 손을 못 보면
      // 모델이 그 자리를 상상으로 메운다(§0: 빈 자리는 모델이 지어낸다).
      'browser.observe': { connected: Boolean(browserHand) },
      'browser.act': { connected: Boolean(browserHand) },
    },
  });

  // 모델(P-RT-1·2·4, 단일 진실): 연결 관리자가 소유한다 — 저장된 사용자 연결 > env(개발자) > stub.
  // doctor(두 축 반영·공개면 위생)와 화면 연결(connect/disconnect, 확실한 무효만 거절 §6.27)이 한 곳에 있다.
  const modelConnection = makeModelConnection({
    env, processEnv,
    store: deps.connectionStore, // 없으면 지속 없이 동작(demo·테스트)
    fetchImpl: deps.fetchImpl,
    timeoutMs: processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS ? Number(processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS) : undefined,
  });
  const model = modelConnection.model;
  const modelSupportsSearch = () => modelConnection.supportsSearch();
  const modelProviderId = () => modelConnection.providerId();
  const modelDoctor = () => modelConnection.doctor();

  // 채널도 실제 자격에서 파생해 함께 반환한다(단일 진실 — 라이브 표면이 fixture로 초록 오표시 안 하게).
  // connectors 는 그 채널이 들고 있는 자격 그대로다. 따로 만들면 두 진실이 갈라지고, 안 넘기면
  // 서버가 demo fixture(텔레그램 connected:true 하드코딩)로 폴백해 **토큰 없는 채널이 라이브에서
  // 열린다** — Phase 0-5 에서 실제로 그렇게 새고 있었다.
  const channels = liveChannels(processEnv);
  // **손이 자기 방을 말한다.** 선언에 방 이름을 박아 두면 `GPAO_T5_FILE_ROOTS` 가 다른
  // 설치에서 그 문장이 그대로 가고, 모델은 틀린 사실을 사용자에게 옮겨 적는다
  // (라이브 실측 2026-08-04: 방이 하나뿐인 설치에서 "~/Documents 도 다룬다"고 답했다).
  const descriptors = demoDescriptors({
    ...선언옵션,
    include: [...liveToolIds, ...연결전],
    rooms: 부르는이름들(defaultFileRoots(processEnv)),
  });
  connectors = [
    ...channels.map((c) => c.connector),
    ...demoConnectors().filter((c) => c.kind !== 'channel'),
  ];
  // P5-B-1B: **연결을 실행하는 손.** 이게 없어서 "붙여줘"에 남의 도구 설정으로 떠넘겼다.
  // 살아 있는 배열·객체를 그대로 넘긴다 — 편입은 제자리 갱신이라 그 턴부터 모델이 본다.
  const connectHand = makeConnectorConnectTool({
    ctx: () => ({ tools, descriptors, env }),
    connectors: () => connectors,
    // 원격 OAuth 로 받은 자격은 0600 파일에 남는다 — 껐다 켜도 다시 로그인시키지 않는다.
    credentialStore: new ConnectorCredentialStore(),
    // 사용자가 올린 서비스는 "연결 끊어줘" 로 선언까지 지워야 한다(승인 카드가 그렇게 약속했다).
    declaredStore: deps.declaredConnectorStore ?? new DeclaredConnectorStore(stateDir),
  });
  tools.tools['connector.connect'] = connectHand;
  // P-OP C: **낯선 서비스도 커넥터가 되는 길.** 여기서 올라온 것은 소스 선언과 같은 배열에
  // 들어가고, 그 뒤로 발견·승인·비밀 입력면·편입이 전부 같다(갈래를 새로 만들지 않는다).
  const declaredStore = deps.declaredConnectorStore ?? new DeclaredConnectorStore(stateDir);
  tools.tools['connector.declare'] = makeConnectorDeclareTool({
    connectors: () => connectors,
    store: declaredStore,
    connect: connectHand, // 선언 직후 같은 길로 이어 준다 — 사용자 승인은 한 번이다
  });
  // 모델이 연결 도구에 넘길 수 있는 이름도 현재 실제로 시작할 수 있는 연결 방식에서 파생한다.
  // 서비스 이름을 쓰는 목록이 아니라, 선언된 연결 방법과 이 런타임 실행기의 교집합이다.
  const connectableNames = [...new Set(connectors
    .filter((c) => (c.authMethods ?? []).some((m) => EXECUTABLE_KINDS.includes(m.kind)))
    .flatMap((c) => [c.id, c.label, ...(c.aliases ?? [])]))];
  descriptors.push(defineTool({
    id: 'connector.connect', label: '서비스 연결', owner: 'core',
    // **하는 일의 이름으로 부른다.** `unknown_kind` 로 두면 위층이 승인을 강제하려고 종류를
    // `send` 로 바꿔 달고, 카드에 "메시지를 실제로 밖으로 보내는 일이라"가 뜬다(라이브 실측
    // 2026-07-28 — 연결 카드에 전송 문구).
    // **자동성 헌장(2026-08-03): 여기서 승인을 미리 달지 않는다.** 붙일 준비는 아무 것도 바꾸지
    // 않는다 — 실제로 사람이 필요한 순간은 비밀값 입력면(헌장 ①)이고 그건 따로 열린다.
    // 팀원 실측에서 "새 서비스 붙이기 꼭 확인" 카드가 떴고, 그 카드가 오너가 든 6장 중 하나다.
    // 이 한 줄이 남아 있으면 authority 가 자동으로 판정해도 사용자 화면은 그대로다.
    availability: [{ kind: 'connected' }], toolKind: 'connect_account',
    capability: '외부 서비스를 T5 에 실제로 연결한다(연결·해제). 연결되면 그 서비스의 도구가'
      + ' 바로 쓸 수 있는 손으로 올라온다. 확인·등록·재연결은 T5 가 하고, 사람은 비밀값만 넣는다.',
    operatorFact: '연결 상태를 직접 확인하고, 필요한 연결은 동의나 비밀 입력 경계에서 이어서 처리한다.',
    schema: {
      description: '외부 서비스를 연결하거나 해제한다. 사용자가 "노션 붙여줘", "구글 연결해줘",'
        + ' "연결 끊어줘"처럼 말하면 이걸 쓴다. 연결 방법을 사용자에게 설명하는 대신 **직접 실행한다** —'
        + ' 다른 도구(Codex·ChatGPT 등)의 설정 화면으로 사용자를 보내지 않는다.'
        + ' 연결되면 그 서비스의 도구가 실제로 올라오고, 그때부터 바로 쓸 수 있다.',
      parameters: {
        type: 'object',
        properties: {
          connector: {
            type: 'string',
            // **목록은 사실로 주되 자물쇠로 걸지 않는다.** `enum` 으로 굳히면 이 목록은 부팅
            // 시점의 사진이 된다 — `connector.declare` 로 그 뒤에 올라온 서비스는 이름을 불러도
            // 스키마가 막아서 영영 못 붙는다(두 갈래를 합치며 드러난 자리, 2026-07-28).
            // 모르는 이름이 와도 안전하다: `findConnector` 가 못 찾으면 아는 목록을 사실로 돌려준다.
            description: `연결할 서비스 이름. 지금 실제 연결 방식을 가진 것: ${connectableNames.join(' · ')}`
              + ' (사용자가 올린 서비스는 이 목록 뒤에 늘어날 수 있다)',
          },
          action: { type: 'string', enum: ['connect', 'disconnect'], description: '기본은 connect' },
        },
        required: ['connector'],
      },
    },
  }));
  env.connections.push({ ...toConnection(descriptors[descriptors.length - 1], { connected: true }), hasHandler: true });

  descriptors.push(defineTool({
    id: 'connector.declare', label: '새 서비스 붙이기', owner: 'core',
    // **헌장(2026-08-03): 여기도 승인을 미리 달지 않는다.** 위 `connector.connect` 와 같은 이유인데,
    // 오너가 든 그 카드는 정확히 **이 도구**의 것이었다(라이브 실측 2026-08-03: connect 만 걷고
    // declare 를 놓쳐 카드가 그대로 떴다). 붙일 준비는 아무 것도 바꾸지 않는다 — 카드 자신이
    // "지금은 아무 값도 저장되지 않아요"라고 적으면서 승인을 물었다. 비밀값이 필요한 순간은
    // 헌장 ① 이고 안전 입력면이 따로 열린다. 되돌리기는 "연결 끊어줘" 한 마디다.
    availability: [{ kind: 'connected' }], toolKind: 'connect_account', reversible: true,
    capability: '아직 T5 에 선언되지 않은 외부 서비스를, 그 서비스의 원격 MCP 나 공개 API 로'
      + ' 연결할 수 있게 준비한다. 준비되면 선언돼 있던 서비스와 똑같이 승인·동의·안전 입력면·'
      + ' 도구 편입을 거쳐 연결된다. 비밀값은 이 도구가 받지 않는다 — 안전 입력면이 따로 열린다.',
    operatorFact: '아직 선언되지 않은 서비스라도, 붙는 방법을 확인해 연결 대상으로 직접 올린다.',
    schema: {
      description: '사용자가 부른 서비스가 T5 에 아직 없을 때, 붙을 수 있게 준비한다.'
        + ' **"제가 붙일 수 없으니 파일로 주세요"라고 답하기 전에 이걸 먼저 본다.**'
        + ' 붙는 길은 둘이다.'
        + ' (1) `authKind:"mcp"` — 그 서비스가 **원격 MCP 주소**를 열어 뒀다면 이게 먼저다.'
        + ' 사용자가 받아 올 값이 없고 동의 한 번이면 끝나서 문턱이 가장 낮다. url 만 채운다.'
        + ' (2) `authKind:"api_key"` — 그런 주소가 없을 때. 받아야 할 값의 **칸 이름**과 부를 주소를 채운다.'
        + ' 확실하지 않으면 먼저 공개 문서를 읽고 채운다.'
        + ' 값 자체(키·토큰)는 절대 여기 넣지 않는다 — 받을 **칸 이름**만 적는다.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: '서비스 이름 — 사용자가 부른 말 그대로' },
          authKind: { type: 'string', enum: ['mcp', 'api_key'], description: '붙는 길. 원격 MCP 주소가 있으면 mcp 가 먼저다(기본 api_key)' },
          url: { type: 'string', description: 'authKind 가 mcp 일 때 — 그 서비스의 원격 MCP 주소' },
          fields: {
            type: 'array', description: '연결에 필요한 값의 칸. 그 서비스 화면에 적힌 글자 그대로 label 을 쓴다.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '자리표시자로 쓸 이름(영문)' },
                label: { type: 'string', description: '사용자가 볼 이름' },
                secret: { type: 'boolean', description: '가려야 하는 값이면 true' },
              },
              required: ['name', 'label'],
            },
          },
          issue: {
            type: 'object', description: '값을 어디서 받는지. 사람 말로.',
            properties: {
              url: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
            },
          },
          verify: {
            type: 'object', description: '값이 맞는지 T5 가 한 번 직접 불러 볼 주소(읽기만 하는 것으로).',
            properties: {
              url: { type: 'string' },
              headers: { type: 'object', description: '{field_name} 으로 값을 끼워 넣는다' },
            },
            required: ['url'],
          },
          tools: {
            type: 'array', description: '연결되면 할 수 있게 될 일들. 하나 이상.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '영문 이름' },
                label: { type: 'string', description: '사용자가 볼 이름' },
                description: { type: 'string' },
                parameters: { type: 'object', description: 'JSON Schema' },
                defaults: { type: 'object' },
                request: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' }, method: { type: 'string' },
                    headers: { type: 'object' }, body: { type: 'string' },
                  },
                  required: ['url'],
                },
                probeArgs: { type: 'object', description: '실제로 되는지 한 번 두드려 볼 인자' },
              },
              required: ['name', 'label', 'request'],
            },
          },
        },
        // mcp 길에는 fields·verify·tools 가 필요 없다(붙으면 그쪽이 tools/list 로 알려 준다).
        // 그래서 여기서 강제하지 않고, 길마다 무엇이 있어야 하는지는 checkDeclaration 이 본다 —
        // 스키마가 한쪽 길만 강제하면 모델은 문턱 낮은 길을 아예 못 고른다.
        required: ['service'],
      },
    },
  }));
  env.connections.push({ ...toConnection(descriptors[descriptors.length - 1], { connected: true }), hasHandler: true });

  // **조건부로 붙은 손은 맨 뒤로 보낸다**(불변식 A · 2026-08-05 라이브에서 잡음).
  //
  // `desktop.screen` 은 `demoDescriptors` 안에서 붙어서 **커넥터 선언보다 앞**에 놓였다.
  // 커넥터는 여기 아래에서 `push` 로 뒤에 붙기 때문이다. 그래서 백엔드를 깔면
  // `… browser.act · **desktop.screen** · connector.connect …` 가 되어 **접두가 죽었다** —
  // 백엔드를 깐 컴퓨터에서만, 그것도 조용히.
  //
  // demo 만 재던 검사는 이걸 못 봤다(거기엔 커넥터 push 가 없다). **재는 자리가 좁았다**(§4.3).
  // 새로 붙는 것은 언제나 **맨 뒤**여야 한다 — 그래야 앞이 안 밀린다.
  if (desktop) {
    const 뒤로 = (arr, 맞나) => {
      const i = arr.findIndex(맞나);
      if (i >= 0) arr.push(arr.splice(i, 1)[0]);
    };
    for (const id of ['desktop.screen', 'desktop.act']) {
      뒤로(descriptors, (d) => d.id === id);
      뒤로(env.connections, (c) => c.id === id);
    }
  }

  return {
    env, tools, descriptors, channels,
    // P5-B-0: 채널 커넥터 + **연결 전 서비스 커넥터**. 선언이 없으면 "연결하면 가능"을 말할
    // 자리가 없다 — 그 자리가 비면 모델이 상상으로 메운다(§0).
    // 채널 커넥터(실자격 파생) + **채널이 아닌 서비스 선언 전부**(메일·노션·구글…).
    // 예전엔 "도구가 있는 커넥터"만 골랐는데, 그러면 도구 없는 서비스 선언(노션·구글)이
    // 라이브에서 통째로 사라진다 — 사용자가 그 이름을 말해도 T5 는 상태를 말할 자리가 없고,
    // 로컬 흔적 확인(P5-B-1A)도 그 서비스엔 영영 안 돈다(실측: /connectors/truth 에 메일만 남았다).
    connectors,
    model, modelDoctor, modelConnection, modelSupportsSearch, modelProviderId,
  };
}
