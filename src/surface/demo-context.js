// 슬라이스-1 데모 환경. 실서비스 연결·자격은 밀도화 단계에서 실제 provider/connector 로 대체한다.
// 여기서는 커널 흐름을 사람이 실제로 겪어 보게 하는 최소 실행 맥락만 만든다.
import { ToolRunner } from '../runtime/tool-runner.js';
import { sameSiteLinks } from '../kernel/l0-evidence/working-state.js';
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';
import { defineWebTool, makeSourceEvidence, classifyWebFetch } from '../kernel/l2-plan/web-tool.js';
import { defineConnector } from '../kernel/l2-plan/connector-profile.js';
import { defineChannel } from '../kernel/l2-plan/channel-registry.js';
import { makeSendPreview } from '../runtime/channel-sender.js';

// P6-2 Slice-3: 채널 커넥터를 ConnectorProfile로 선언(멀티채널). 실제 adapter는 P6 후속.
export function demoConnectors() {
  return [
    // P5-B-0.5: 채널도 **미연결일 때 다음 길**을 들어야 한다. 없으면 "슬랙 안 됩니다"로 끝난다.
    defineConnector({
      id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true,
      aliases: ['telegram', '텔레그램', '텔레'],
      userJobs: ['텔레그램으로 말 걸면 T5가 일합니다', '결과를 그 방으로 돌려보내요'],
      setupGuide: '텔레그램 봇 토큰을 연결하면 방에서 바로 일을 시킬 수 있어요.',
    }),
    defineConnector({
      id: 'slack.channel', label: '슬랙 채널', kind: 'channel', authState: 'oauth', connected: false,
      aliases: ['slack', '슬랙'],
      userJobs: ['슬랙 채널에 결과를 올려요'],
      setupGuide: '슬랙 봇 토큰을 연결하면 채널에 바로 올릴 수 있어요.',
    }),
    // P5-B-0: **연결 전 서비스도 선언한다.** 선언이 없으면 "연결하면 가능"을 말할 자리가 없어서
    // 모델이 그 자리를 상상으로 메운다. 연결 흐름(OAuth)은 다음 슬라이스 범위다.
    defineConnector({
      id: 'mail', label: '메일', kind: 'provider', category: 'mail', authState: 'oauth', connected: false,
      aliases: ['gmail', '지메일', '메일로', '이메일'],
      userJobs: ['메일을 대신 보내요', '보낼 내용을 미리 보여드리고 확인받아요'],
      requiredSetup: ['Gmail 또는 Outlook 계정 연결'],
      setupGuide: '메일 계정을 연결하면 T5가 대신 보낼 수 있어요. 보내기 전에 받는 사람과 내용을 보여드려요.',
      limits: ['받은 메일을 읽는 기능은 아직 없어요'],
      localeRelevance: 'kr',
      localSigns: [
        { kind: 'mcp', server: 'gmail', label: 'MCP 설정의 지메일 연결' },
      ],
    }),
    // P5-B-0.5: **사용자가 자주 부르는 서비스는 선언해 둔다.** 선언이 없으면 T5 는 그 이름을
    // 듣고도 자기 상태를 말할 자리가 없어서 "복사해서 붙여주세요"로 끝낸다(실측).
    // 선언만으로는 아무것도 실행되지 않는다 — 도구가 없으므로 model schema 에도 안 나온다.
    // 여기 있는 건 "이 서비스를 안다, 지금은 직접 연결이 없다, 대신 이런 길이 있다"까지다.
    defineConnector({
      id: 'notion', label: '노션', kind: 'provider', category: 'workspace', authState: 'oauth', connected: false,
      aliases: ['notion', '노션'],
      userJobs: ['노션 문서를 읽어와 정리해요', '노션에 정리한 내용을 남겨요'],
      requiredSetup: ['노션 계정 연결(API 또는 MCP)'],
      setupGuide: '자주 쓰시면 노션 연결을 붙이는 게 가장 편해요. 한 번만 보실 거면 지금도 브라우저로 열어서 볼 수 있어요.',
      localeRelevance: 'kr',
      // P5-B-1A: 이 컴퓨터에서 T5 가 직접 확인할 수 있는 흔적(사용자에게 확인시키지 않는다).
      localSigns: [
        { kind: 'app', path: '/Applications/Notion.app', label: '노션 앱' },
        { kind: 'mcp', server: 'notion', label: 'MCP 설정의 노션 연결' },
      ],
    }),
    defineConnector({
      id: 'google', label: '구글', kind: 'provider', category: 'workspace', authState: 'oauth', connected: false,
      aliases: ['google', '구글', '드라이브', 'drive', '캘린더', 'calendar', '구글독스', '스프레드시트'],
      userJobs: ['드라이브 자료를 찾아 읽어요', '캘린더 일정을 보고 정리해요'],
      requiredSetup: ['구글 계정 연결(OAuth)'],
      setupGuide: '구글 계정을 연결하면 드라이브·캘린더를 바로 다룰 수 있어요.',
      localeRelevance: 'kr',
      localSigns: [
        { kind: 'dir', paths: ['~/Library/CloudStorage/GoogleDrive-*', '~/Google Drive'], label: '구글 드라이브 동기화 폴더' },
        { kind: 'cli', command: 'gcloud', label: '구글 CLI(gcloud)' },
        { kind: 'mcp', server: 'google', label: 'MCP 설정의 구글 연결' },
      ],
    }),
  ];
}

// P6-16 Slice-1: ChannelRegistry 데모 fixture — 커넥터(자격) + inbound 정책 + outbound 도구 바인딩.
//   ⚠️ **demo/test 전용 fixture다.** telegram을 connected:true로 박아두므로 **라이브 표면에 쓰면 안 된다** —
//   라이브 채널 상태는 실제 자격에서 파생한다(live-context.liveChannels). server 기본은 이 fixture(테스트 편의).
export function demoChannels() {
  const byId = Object.fromEntries(demoConnectors().map((c) => [c.id, c]));
  return [
    defineChannel({ id: 'telegram', connector: byId.telegram, inboundPolicy: 'mention_required', outboundTool: 'telegram.send' }),
    defineChannel({ id: 'slack.channel', connector: byId['slack.channel'], inboundPolicy: 'mention_required', outboundTool: 'slack.post' }),
  ];
}

// P6-2: 도구를 ToolDescriptor로 정의한다(소유≠실행, availability 신호, auth≠approval).
// web.collect는 WebToolDescriptor로 확장(입력스키마·출처계약·세션·스크래핑 정책).
const DESCRIPTORS = [
  defineWebTool({ id: 'web.collect', label: '웹 자료 수집', sessionMode: 'anonymous' }),
  defineTool({
    id: 'local.file', label: '로컬 파일', owner: 'core', availability: [{ kind: 'connected' }], toolKind: 'organize',
    capability: '정해진 작업 폴더 안에서 파일을 보고·읽고·만들고·옮기고·지운다. 지우거나 덮어쓴 것은 되돌릴 수 있다.',
    // 모델 노출 스키마도 같은 선언에 둔다(1축) — 예전엔 tool-schema.js 의 수동 맵에 있었다.
    schema: {
      description: '정해진 작업 폴더 안의 파일을 보거나 읽거나 저장하거나 옮기거나 지운다. 되돌리기도 가능.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'move', 'delete', 'undo'] },
          path: { type: 'string', description: '대상 파일·폴더(작업 폴더 기준 상대 경로)' },
          to: { type: 'string', description: 'move 일 때 옮길 위치' },
          text: { type: 'string', description: 'write 일 때 저장할 내용' },
        },
        required: ['action'],
      },
    },
    // 지우거나 덮어쓴 것은 휴지통에 남고 되돌리기 표가 있다(local-file.js) — 사실이므로 선언한다.
    reversible: true, reversibleNote: '휴지통에 남아 "되돌려줘"로 되살릴 수 있어요',
  }),
  // P6-T2 · 터미널. **사용자에게 명령을 치라고 하지 않는다** — T5 가 직접 돌린다.
  // 등급은 고정이 아니다: 계획 단계 probe 가 "아무것도 안 바꿨다"를 증명하면 A0, 못 하면 A2.
  defineTool({
    id: 'local.terminal', label: '터미널 실행', owner: 'core', availability: [{ kind: 'connected' }],
    toolKind: 'run_command', needsApproval: false, reversible: false,
    // 능력 문장은 **사실의 끝까지** 말해야 한다. 예전엔 "…먼저 확인받는다"에서 끊겼다.
    // 그 문장은 제한으로 읽힌다 — 모델은 "내가 사용자에게 물어야 한다"로 해석하고, 물으려면
    // 명령어를 보여줄 수밖에 없어서 **떠넘김이 된다.** 실측(2026-07-27 라이브):
    //   "제가 여기서 직접 파일 복사 실행은 못 하지만, 터미널에서 아래만 실행하면…" + cp 명령 3줄
    // 파일 3개를 정확히 찾아 놓고 마지막 한 걸음을 사용자에게 넘겼다. 있는 손을 없다고 한 것이다.
    //
    // schema 쪽은 이미 맞게 적혀 있었다("그냥 쓰면 된다 … 필요하면 확인을 받는다"). 또 두 축이
    // 다른 말을 한 것이고, 시스템 프롬프트에 늘 실리는 건 이쪽(capability)이다.
    // 규칙을 더하지 않는다 — **빠진 사실을 채운다**: 확인은 누가 받고, 그 뒤 누가 실행하는가.
    capability: '이 컴퓨터에서 명령을 직접 실행한다. 위치를 모르면 직접 찾는다. 확인·검사·테스트·빌드는 바로 하고,'
      + ' 파일을 바꾸거나 인터넷에 연결하는 명령은 그냥 실행하면 된다 —'
      + ' T5 가 실행 전에 사용자에게 확인 카드를 띄우고, 승인되면 T5 가 이어서 실행한다.'
      + ' 그러니 사용자에게 명령어를 보여주며 대신 치라고 하지 않는다. 비밀 자리는 승인해도 읽지 않는다.',
    schema: {
      description:
        '셸 명령을 실행한다. 파이프·리다이렉션·&& 다 된다.'
        + ' 사용자가 상태를 묻거나("테스트 돌려봐", "왜 안 되는지 봐줘") 확인이 필요하면 **직접 실행한다** —'
        + ' 사용자에게 터미널을 켜서 붙여 달라고 하지 않는다.'
        + ' **위치를 모르면 먼저 찾는다** — "이 프로젝트", "그 파일"처럼 어디인지 안 밝힌 말에는'
        + ' find·ls 로 직접 찾아본다(홈부터 훑어도 된다. 읽기는 승인 없이 바로 된다).'
        + ' 후보가 여럿이라 어느 쪽인지 정말 모를 때만 사용자에게 묻는다 —'
        + ' **경로를 되묻는 건 찾아보고 나서의 마지막 선택이다.**'
        + ' 파일 변경·설치·네트워크가 필요한 명령도 그냥 쓰면 된다. 먼저 안전하게 시험해 보고'
        + ' 필요하면 사용자에게 확인을 받는다. 오래 걸리는 서버 실행은 아직 이 도구로 하지 않는다.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '실행할 셸 명령 전체' },
          cwd: { type: 'string', description: '실행할 폴더(비우면 현재 작업 폴더)' },
          timeoutMs: { type: 'number', description: '최대 대기 시간(기본 120초, 최대 600초)' },
        },
        required: ['command'],
      },
    },
  }),
  // P6-T3 · 장기 프로세스. terminal 과 나누는 이유는 **수명**이다 — 명령은 한 턴에 끝나지만
  // 서버는 턴을 넘어 산다. 그래서 켠 것을 기억하고, 진짜 살아있는지 매번 확인하고, 말하면 끈다.
  defineTool({
    id: 'local.process', label: '실행 중인 것', owner: 'core', availability: [{ kind: 'connected' }],
    toolKind: 'organize', needsApproval: false, reversible: true,
    reversibleNote: '"꺼줘"라고 하시면 바로 꺼요',
    capability: '서버처럼 계속 도는 것을 켜고, 지금 살아있는지 확인하고, 로그를 읽고, 끈다.'
      + ' 기록에 남아 있어도 실제로 죽었으면 죽었다고 말한다.',
    schema: {
      description:
        '오래 도는 것(서버·워치·데몬)을 켜고 관리한다. 한 번에 끝나는 명령은 local.terminal 을 쓴다.'
        + ' 사용자가 "서버 켜줘"라고 하면 켜고, "아까 그거 꺼줘"라고 하면 target 으로 찾아 끈다 —'
        + ' PID 를 사용자에게 묻지 않는다. 안 켜지는 이유를 물으면 logs 로 끝부분을 읽고 원인을 말한다.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'status', 'logs', 'stop'] },
          command: { type: 'string', description: 'start 일 때 실행할 명령' },
          cwd: { type: 'string', description: 'start 일 때 실행할 폴더' },
          label: { type: 'string', description: '나중에 사용자가 부를 이름(예: 개발 서버)' },
          target: { type: 'string', description: 'status·logs·stop 에서 찾을 대상 — 이름·명령 일부·pid' },
        },
        required: ['action'],
      },
    },
  }),
  // P6-W2 · 작업 대상 찾기. 사용자는 경로를 말하지 않는다 — "정산 자료", "그 계약서", "이 프로젝트".
  defineTool({
    id: 'local.locate', label: '작업 대상 찾기', owner: 'core', availability: [{ kind: 'connected' }],
    toolKind: 'read', needsApproval: false, reversible: true,
    capability: '사용자가 말한 대상이 어느 폴더인지 후보와 근거를 찾는다(코드 폴더든 정산·계약서·원고든).',
    schema: {
      description:
        '사용자가 부른 대상("정산 자료", "그 계약서", "이 프로젝트")이 어디인지 후보를 찾는다.'
        + ' **최근에 다룬 자리로 알 수 있으면 이걸 부르지 않는다** — 이미 아는 것을 다시 찾지 않는다.'
        + ' 후보가 하나면 그대로 쓰고, 여럿이면 짧게 보여주고 고르게 한다.'
        + ' 못 찾으면 depth 를 늘리거나 from 을 바꿔 다시 부를 수 있다. 파일을 열지는 않는다.'
        + ' 사용자가 장소를 이름으로 말하면("외장하드", "작업용SSD", "거기") 그 이름을 **그대로** from 에 넣어 다시 부른다 —'
        + ' 경로를 알 필요 없다. 쓸 수 있는 이름은 [지금 다루는 것]의 "볼 수 있는 자리"에 있다.'
        + ' 못 찾았을 때 결과의 placesToLook 은 **지금 볼 수 있는 자리들**이다 —'
        + ' 사용자에게 경로를 복사해 오라고 하지 말고 이 이름들 중에서 고르게 한다'
        + '("외장하드요" 하면 그 이름으로 from 을 바꿔 다시 부른다).',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', description: '사용자가 부른 말 그대로 — "정산 자료", "이 프로젝트"' },
          from: { type: 'string', description: '어디서부터 찾을지 — "볼 수 있는 자리"의 이름 그대로("작업용SSD", "Downloads") 또는 경로. 비우면 홈' },
          depth: { type: 'number', description: '몇 단계까지(기본 3, 최대 5). 못 찾으면 늘려서 다시 부른다' },
        },
        required: ['what'],
      },
    },
  }),
  defineTool({ reversible: false, id: 'mail.send', label: '메일 발송', owner: 'channel', availability: [{ kind: 'connected' }, { kind: 'auth' }], toolKind: 'send', needsApproval: true,
    // P5-B-0 오너 결정(2026-07-27): **선언을 지우지 않고 연결 전 기능으로 낮춘다.**
    // 실행할 손이 없으므로 실행 가능 도구가 아니다 — model schema·도구함·능력 문장 어디에도
    // "지금 된다"로 나오지 않는다. 메일 커넥터가 붙고 handler·previewOf·receipt 가 닫히면
    // 그때 실행 가능으로 올라온다(그 전에 올리지 않는다).
    connector: 'mail',
    capability: '메일 계정을 연결하면 메일을 보낼 수 있다(보내기 전 확인을 받는다).',
    // 지금은 실행 불가라 모델에게 안 보이지만, **연결되는 순간 보여야 한다.** 스키마가 없으면
    // 그때 `session.search` 와 똑같은 일이 난다 — 도구는 있는데 모델이 존재를 모른다.
    schema: {
      description: '메일을 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '받는 사람(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
  defineTool({ reversible: false, id: 'slack.post', label: '슬랙 게시', owner: 'channel', connector: 'slack.channel', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true,
    capability: '슬랙에 글을 올린다(올리기 전 확인을 받는다).',
    schema: {
      description: '슬랙에 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '채널·대상(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
  // 채널 레지스트리가 outboundTool 로 선언하는 도구는 descriptor 도 있어야 한다 — 선언만 있고
  // 손이 없으면 T5 가 "텔레그램으로 보낸다"고 말해 놓고 못 보낸다(감사 지적, 게이트가 불변식으로 막는다).
  // 지난 대화 검색 — 읽기 전용이라 자연 진행(A0). 결과는 후보이지 자동 반영이 아니다.
    // 능력 문장이 없어서 자기파악에서 이름만 보였다(1축에서 발견 — 맵에 안 적혀 있었다).
  defineTool({ id: 'session.search', label: '지난 대화 찾기', owner: 'core', availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    capability: '지난 대화들에서 찾는다. 제목·시각·짧은 조각만 돌려주며 대화 내용을 통째로 옮기지 않는다.',
    schema: {
      description: '지난 대화들에서 찾는다. 사용자가 "전에 말했던", "그때 그거", "물어봤던 세션"처럼'
        + ' 과거 대화를 가리키면 이걸로 찾는다. 제목·시각·짧은 조각만 돌려주며 대화 내용을 통째로 옮기지 않는다.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '찾을 말(주제·상호·키워드)' } },
        required: ['query'],
      },
    } }),
  // P2-10: 브라우저 표면. **URL 읽기로 닿지 않는 화면**을 실제로 보는 손이다.
  // 보기(observe)와 조작(act)을 나눈다 — 조작이라 해도 이 슬라이스는 관찰 목적뿐이다.
  // 둘 다 읽기(A0): 입력·전송·구매는 만들지 않았으므로 실수로도 못 한다.
  // 브라우저가 없는 컴퓨터에서는 손이 안 붙고, 손이 없으면 선언도 안 딸려온다(1축의 배당금).
  defineTool({
    id: 'browser.observe', label: '브라우저로 화면 보기', owner: 'core',
    availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    // **로그인 사실을 반드시 적는다.** 브라우저는 매번 **새 임시 프로필**로 연다
    // (browser.js: `--user-data-dir=<임시폴더>`, 끝나면 삭제). 사용자의 로그인 세션이 없다.
    //
    // 이 사실이 빠져 있어서 실측(2026-07-27)에서 두 번 거짓 약속이 나왔다:
    //   · "이 브라우저에 노션 로그인이 되어 있고 네가 화면을 열어 달라고 하면 볼 수 있어"
    //   · "브라우저에서 Google 로그인만 해주세요. 끝나면 바로 Gmail에서 검색할게요"
    // 둘 다 원리적으로 불가능하다 — 임시 프로필이라 사용자가 로그인해도 반영되지 않는다.
    // 모델이 거짓말한 게 아니라, **로그인 여부라는 사실이 능력 문장에 없어서 합리적으로 추정**한 것이다.
    capability: '주소를 브라우저로 열어 **실제로 그려진 화면**을 본다. 자바스크립트로 그려지거나 탭 뒤에 있는 내용도 볼 수 있고,'
      + ' 어디까지 봤고 얼마가 남았는지를 함께 남긴다. 보기만 하고 화면을 바꾸지 않는다.'
      + ' **로그인은 안 되어 있다** — 매번 새 브라우저 자리로 열기 때문에 사용자가 평소 쓰는'
      + ' 로그인 상태가 따라오지 않는다. 그래서 로그인이 필요한 화면은 로그인 페이지까지만 보인다.',
    schema: {
      description: '주소를 브라우저로 열어 실제 화면을 본다. `web.collect` 로 읽었는데 내용이 비어 있거나'
        + ' 자바스크립트로 그려지는 화면일 때 쓴다. 본 범위와 못 본 범위를 함께 돌려준다.'
        + ' 화면을 더 보려면(내리기·탭 전환·더보기) `browser.act` 를 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'snapshot'] },
          url: { type: 'string', description: 'open 일 때 열 주소' },
        },
        required: ['action'],
      },
    },
  }),
  defineTool({
    id: 'browser.act', label: '브라우저 화면 넘기기', owner: 'core',
    availability: [{ kind: 'connected' }], toolKind: 'read', reversible: true,
    capability: '보고 있는 화면을 더 본다 — 아래로 내리거나, 탭을 바꾸거나, 더보기를 편다.'
      + ' 몇 번 내렸는지와 왜 멈췄는지를 남긴다. 글을 쓰거나 보내거나 사는 일은 하지 않는다.',
    schema: {
      description: '보고 있는 화면을 더 본다. scroll(아래로 내리기 — 최대 5번, 새 내용이 안 나오면 멈춘다) ·'
        + ' click(앞선 관찰이 준 ref 의 **탭·더보기만**). 링크는 누르지 않는다 — 주소를 알면 browser.observe 로 연다.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['scroll', 'click'] },
          ref: { type: 'string', description: 'click 일 때, 앞선 관찰이 준 ref(탭·더보기만)' },
          times: { type: 'number', description: 'scroll 일 때 몇 번 내릴지(최대 5)' },
        },
        required: ['action'],
      },
    },
  }),
  defineTool({ reversible: false, id: 'telegram.send', label: '텔레그램 전송', owner: 'channel', connector: 'telegram', availability: [{ kind: 'connected' }], toolKind: 'send', needsApproval: true,
    capability: '텔레그램으로 보낸다(보내기 전 확인을 받는다).',
    schema: {
      description: '텔레그램으로 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '보낼 내용' },
          target: { type: 'string', description: '보낼 방(없으면 기본 대상)' },
        },
        required: ['text'],
      },
    } }),
];
/**
 * 도구함 투영용 descriptor 목록(라벨·toolKind·needsApproval·sourcePolicy 포함).
 * @param {{include?:string[]}} [opts] include 를 주면 **그 id 만** 선언한다 — 라이브는 실제 손이 있는
 *   것만 선언한다(손 없는 선언 = 사용자에게 하는 거짓말).
 */
export function demoDescriptors(opts = {}) {
  return opts.include ? DESCRIPTORS.filter((d) => opts.include.includes(d.id)) : DESCRIPTORS;
}

// 환경 사실(연결·인증 존재 여부). mail.send는 연결됐으나 발송 인증 미준비 → needs_auth.
const FACTS = {
  'web.collect': { connected: true },
  'local.file': { connected: true },
  'local.terminal': { connected: true },
  'local.process': { connected: true },
  'local.locate': { connected: true },
  'mail.send': { connected: true, auth: false },
  'slack.post': { connected: true },
  'telegram.send': { connected: true },
  'session.search': { connected: true },
};

/**
 * 슬라이스-1 기본 환경(SelfState 입력). 연결은 descriptor availability로 판정한다.
 * @param {{factOverrides?:Record<string,object>, include?:string[]}} [opts]
 *   factOverrides: 실제 자격 상태를 반영할 때 FACTS를 덮어쓴다(라이브).
 *   include: 그 도구만 자기 상태에 싣는다 — descriptor 선언과 같은 집합이어야 한다(단일 진실).
 */
/**
 * **선언과 손을 한 번에 만든다(P5-B-0).** 따로 만들면 어긋나고, 어긋난 쪽이 모델에게 노출된다 —
 * demo 에서 `local.terminal`·`local.process`·`local.locate` 가 실제로 그랬다(손을 주입 안 하면
 * 손은 없는데 schema 엔 있었다). 검사도 라이브와 같은 조합만 보게 한다.
 * @param {object} [opts] demoTools 와 같은 주입 옵션(localTerminal·localFile·senders…)
 * @returns {{env:object, tools:object, descriptors:object[]}}
 */
export function demoContext(opts = {}) {
  const tools = demoTools(opts);
  return {
    tools,
    env: demoEnv({ ...opts, hands: Object.keys(tools.tools ?? {}) }),
    descriptors: demoDescriptors(opts),
  };
}

export function demoEnv(opts = {}) {
  const facts = { ...FACTS, ...(opts.factOverrides ?? {}) };
  // P5-B-0: **손이 있는지를 같은 자리에서 함께 판정한다.** 선언(descriptor)과 손(handler)을
  // 따로 만들면 어긋나고, 어긋난 쪽이 모델에게 노출된다 — demo 에서 `local.terminal`·
  // `local.process`·`local.locate` 가 실제로 그랬다(주입 안 하면 손이 없는데 schema 엔 있었다).
  // `hasHandler` 를 실어 보내면 `toolReality` 가 그것부터 본다.
  // 손 목록을 직접 아는 쪽(live)이 넘기면 그걸 쓰고, 아니면 같은 opts 로 만든 손에서 판정한다.
  const hands = new Set(opts.hands ?? Object.keys(demoTools(opts).tools ?? {}));
  return {
    model: { id: 'beai5-stub', strengths: '자연 대화·판단', authSignal: 'ok' },
    connections: demoDescriptors(opts).map((d) => ({
      ...toConnection(d, facts[d.id] ?? {}),
      hasHandler: hands.has(d.id),
    })),
    grantedAuthorities: [],
  };
}

/**
 * 슬라이스-1 스텁 도구. web.collect 는 차단 사례를 재현할 수 있게 한다(복구 흐름 시연).
 * @param {{webCollector?:object, senders?:Record<string,object>}} [opts]
 *   webCollector 주입 시 web.collect를 실제 어댑터로(P6-5). senders 주입 시 해당 send 도구를 실제 어댑터로(P6-6).
 */
export function demoTools(opts = {}) {
  const senders = opts.senders ?? {};
  return new ToolRunner({
    'web.collect': opts.webCollector ?? {
      subjectOf(rec) {
        const src = rec?.sources?.[0];
        if (!src?.sourceUrl) return null;
        return { key: src.sourceUrl, kind: 'web', label: src.title || src.sourceUrl, detail: src.sourceUrl,
          links: sameSiteLinks(src.sourceUrl, rec.result?.links) };
      },
      // 출처 원장 필수 — ToolRunner가 assertWebEvidence를 강제한다(handler 관례에 안 맡김).
      sourceLedgerRequired: true,
      async handler(args) {
        const q = String(args?.request ?? '');
        // 로그인벽/차단/봇벽을 성공과 분리(정직한 상태). 실패는 내용·출처 없음.
        const fetchState = classifyWebFetch({ status: q });
        if (fetchState !== 'ok') {
          const msg = fetchState === 'login_wall' ? '로그인이 필요한 페이지예요.'
            : fetchState === 'bot_wall' ? '봇 차단이 걸려 있어요.'
              : fetchState === 'robots_disallow' ? '그 사이트가 수집을 허용하지 않아요.'
                : '그 사이트가 접근을 막고 있어요.';
          return { blocked: true, fetchState, userSafeSummary: msg };
        }
        // 성공: 반드시 출처 근거(SourceEvidence)를 만든다. 런타임 assertWebEvidence가 출처 없는 성공을 막는다.
        const sources = [makeSourceEvidence({ sourceUrl: 'https://example.com/public', title: '공개 자료', excerpt: q, confidence: 0.6 })];
        return { result: { note: '공개 자료 기준 요약' }, sources, userSafeSummary: '공개 자료로 확인했어요.' };
      },
    },
    // 라이브는 실제 손발(makeLocalFileTool)을 주입한다. 여기 기본값은 **테스트/데모 전용 fixture** 이며
    // 스텁 금지 게이트가 라이브에서 이게 쓰이면 실패시킨다(§16-C).
    'local.file': opts.localFile ?? {
      subjectOf(rec) {
        const path = rec?.result?.path ?? rec?.actualCall?.args?.path;
        return path ? { key: `file:${path}`, kind: 'file', label: String(path) } : null;
      },
      isFixture: true,
      async handler() {
        return { result: { scanned: true }, userSafeSummary: '로컬 파일을 확인했어요(변경 없음).' };
      },
    },
    // 데모 손도 **같은 미리보기 계약**을 쓴다 — 문구를 따로 지으면 사용자가 보는 말이 갈라진다.
    'slack.post': senders['slack.post'] ?? {
      previewOf: makeSendPreview({ channel: 'slack' }),
      async handler() {
        return { result: { posted: true }, userSafeSummary: '슬랙에 게시했어요.' };
      },
    },
    // 라이브는 makeChannelSender 로 실제 전송을 주입한다. 여기 기본값은 데모/테스트 전용이다.
    // 지난 대화 찾기 — 라이브는 실제 세션 저장소를 주입한다(여기 기본값은 빈 결과).
    // P2-10: 브라우저 손. 실제 손을 안 넘기면 **등록하지 않는다** — 스텁 금지(게이트가 검사한다).
    ...(opts.localTerminal ? { 'local.terminal': opts.localTerminal } : {}),
    ...(opts.localProcess ? { 'local.process': opts.localProcess } : {}),
    ...(opts.localLocate ? { 'local.locate': opts.localLocate } : {}),
    ...(opts.browserObserve ? { 'browser.observe': opts.browserObserve } : {}),
    ...(opts.browserAct ? { 'browser.act': opts.browserAct } : {}),
    'session.search': opts.sessionSearch ?? {
      subjectOf(rec) {
        const hits = (rec?.result?.hits ?? []).filter((h) => h?.title);
        if (!hits.length) return null;
        return { key: `search:${rec?.actualCall?.args?.query ?? ''}`, kind: 'session',
          label: hits.map((h) => h.title).slice(0, 3).join(', ') };
      },
      async handler() { return { result: { hits: [] }, userSafeSummary: '지난 대화에서 찾지 못했어요.' }; },
    },
    'telegram.send': senders['telegram.send'] ?? {
      isFixture: true,
      previewOf: makeSendPreview({ channel: 'telegram' }),
      async handler() {
        return { result: { sent: true }, userSafeSummary: '텔레그램으로 보냈어요.' };
      },
    },
  });
}
