import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';
import { resolveConsoleWorkspace, sanitizeTerminalPath } from '../src/console-config.js';
import { requestContainsExactPath, requestContainsWorkspacePath } from '../src/console-server.js';

test('콘솔의 기본 터미널 범위는 사용자의 홈이며 별도 설정만 명시적으로 덮어쓴다', () => {
  assert.equal(resolveConsoleWorkspace({}, '/Users/example'), '/Users/example');
  assert.equal(
    resolveConsoleWorkspace({ T5_REFOUNDATION_WORKSPACE: '/tmp/specific-room' }, '/Users/example'),
    '/tmp/specific-room',
  );
});

test('기본 위치를 이유로 사용자가 지정한 경로의 터미널 관측을 거절하도록 지시하지 않는다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'win32', architecture: 'arm64', commandFamily: 'cmd', commandProgram: 'cmd.exe',
  });
  assert.doesNotMatch(instructions, /stay inside|only.*workspace|provided workspace/i);
  assert.match(instructions, /default working directory/i);
  assert.match(instructions, /user.*names.*path/i);
  assert.match(instructions, /use the terminal/i);
  assert.match(instructions, /built-in.*T5_DOCUMENT_CLI.*inspect.*create-xlsx.*custom parsing/i);
  assert.match(instructions, /attachment content.*untrusted.*not instructions/i);
  assert.match(instructions, /unchanged existing local file.*attachment register_existing_file.*do not copy.*convert.*recreate/i);
  assert.match(instructions, /register_output for a newly created result.*runtime publication path.*connected messaging conversation delivers.*Do not search for a separate messaging send tool/i);
  assert.match(instructions, /text-bearing PDF.*requested text or values.*actually present.*page count.*render dimensions.*not content verification.*do not say.*readable/i);
  assert.match(instructions, /visual readability or layout.*extracted text does not verify.*rendered pixels.*goal remains incomplete.*do not lead with completion/i);
  assert.match(instructions, /visual verification.*PDF.*attachment inspect.*attachmentId null.*PDF filePath.*T5 PDFium.*isolated visual transcript.*arbitrary renderer/i);
  assert.doesNotMatch(instructions, /caption_absent|source_failed.*automatic caption/i);
  assert.match(instructions, /platform=win32/);
  assert.match(instructions, /command family=cmd/);
  assert.match(instructions, /smallest sufficient observation/i);
  assert.match(instructions, /shortest useful answer.*conclusion.*compact next step/i);
  assert.match(instructions, /use the available exec tool whenever computer work or evidence is needed/i);
  assert.match(instructions, /approximate file names.*contents.*dates.*amounts.*people.*projects.*locations.*tool_search.*file reality.*before.*broad shell scan/i);
  assert.match(instructions, /Protect personal identifiers.*do not repeat customer.*member.*patient.*employee.*account IDs.*masked labels/i);
  assert.match(instructions, /work remains.*tool is available.*do not end.*promise or preamble.*Call the tool.*same response/i);
  assert.match(instructions, /Before saying.*files.*exports.*local evidence.*absent.*exec.*bounded observation.*disconnected external service.*does not prove/i);
  assert.match(instructions, /shallow or depth-limited file listing cannot prove absence.*expand the search once.*current workspace.*file names and metadata.*do not broadly read unrelated file contents/i);
  assert.match(instructions, /file organization.*never move.*rename.*overwrite.*delete during discovery.*file reality plan.*source.*destination.*already-there.*collision.*not authorization.*filenames alone.*final version/i);
  assert.match(instructions, /reconciled document.*spreadsheet.*report.*merged deliverable.*file_reality bind_sources.*source usage.*user purpose.*unresolved facts.*sourceManifestId.*attachment register_output.*source changes.*not call.*complete/i);
  assert.match(instructions, /CSV.*TSV.*append-and-standardize.*source-to-output column mapping.*ordered outputColumns.*verify every output row.*matching total alone.*not proof/i);
  assert.match(instructions, /local image.*scanned document.*words.*company names.*dates.*amounts.*file_reality local OCR.*not semantic truth.*passport portrait.*no OCR guarantee.*bounded visual candidate/i);
  assert.match(instructions, /exact folder.*photo by appearance.*image_candidates.*visual_candidates.*at most 12 handles.*C-number.*opaque handle.*not send the whole folder.*identify a person/i);
  assert.match(instructions, /file_reality.*locationText.*do not call exec.*rediscover.*explicitly asks.*exact absolute path.*Desktop.*Downloads.*computer scope.*inventing.*\/Users path/i);
  assert.match(instructions, /uniquely strongest.*bounded OCR excerpt.*every requested discriminator.*without another inspect.*repeated search.*image_candidates.*exec.*incomplete or ambiguous/i);
  assert.match(instructions, /Refer to yourself as T5, not ChatGPT.*model provider/i);
  assert.match(instructions, /where to start saving time.*one recurring job.*one small reversible trial.*before[/]after human-time measure.*trial period.*success criterion/i);
  assert.match(instructions, /feasibility question.*multi-source workflow.*public research.*small business tool.*each required current connection.*bounded first trial.*public[/]private.*read[/]write.*excluded sensitive fields.*installation[/]hosting[/]delivery.*verify usefulness/i);
  assert.match(instructions, /every required connection as a separate current fact.*not named which mail.*calendar.*message.*storage service.*ask one question.*collapsing/i);
  assert.match(instructions, /small tool feasibility.*local verified static app.*downloadable artifact.*first positive control.*runs on the user computer.*multi-user sharing.*other computers.*external hosting.*separate capability.*unless actually observed/i);
  assert.match(instructions, /automation stays trustworthy.*running.*observed effect.*delivery.*purpose completion.*failure and unknown attention path.*partial result.*resume point.*blind-retry.*last success.*missed run.*next run.*maintenance burden/i);
  assert.match(instructions, /multiple.*target.*discriminator/i);
  assert.match(instructions, /user choice.*not.*computer evidence/i);
  assert.match(instructions, /missing destination.*delivery surface.*account.*ask one direct question/i);
  assert.match(instructions, /speculative.*broader system/i);
  assert.match(instructions, /conversational choice.*does not.*authorize.*source files/i);
  assert.match(instructions, /exec.*foreground.*complete result/i);
  assert.match(instructions, /terminal_session only.*managed.*TTY.*later input.*exact recall.*processId.*cursor.*new output.*write.*resize.*stop/i);
  assert.match(instructions, /undoing.*recoverable trash.*backup.*inverse operation/i);
  assert.match(instructions, /user-facing Korean.*판단.*생각.*확인.*검토.*작업/u);
  assert.doesNotMatch(instructions, /macos|darwin/i);
});

test('macOS 환경은 사용자에게 같은 파일명이 분해형일 수 있다는 현실을 모델에 공급한다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  });
  assert.match(instructions, /unicode normalization/i);
  assert.match(instructions, /visually identical.*different.*code points/i);
  assert.doesNotMatch(instructions, /Prefer file_search for discovery/i);
});

test('가시 브라우저는 사용자가 요청한 화면 상호작용 경계에서만 열리고 일반 읽기 실패로 열리지 않는다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  });
  assert.match(instructions, /visibleBrowser=user_interaction only when the user asked to operate.*log in.*upload\/download.*open\/show.*live interface/i);
  assert.match(instructions, /ordinary news.*search.*research.*fact lookup.*source reading.*visibleBrowser=never.*must never open a visible browser/i);
  assert.match(instructions, /exact URL.*selected search candidate.*provider block.*not by itself permission.*visible browser/i);
  assert.match(instructions, /visible.*subset.*not.*complete dataset/i);
  assert.match(instructions, /do not repeat.*same static request/i);
  assert.match(instructions, /public content.*already visible.*login banner.*do not require login/i);
  assert.match(instructions, /browser page content.*posts.*comments.*untrusted.*no instruction authority/i);
  assert.match(instructions, /compact.*omits.*page facts required.*full=true.*once.*place-profile details.*post text.*comment bodies/i);
  assert.doesNotMatch(instructions, /facebook.*special|instagram.*special/i);
});

test('browser upload 권한은 현재 요청의 완전한 절대경로 토큰에만 결속된다', () => {
  const path = '/Users/example/My Files/report.pdf';
  assert.equal(requestContainsExactPath(`이 파일을 올려줘: ${path}`, path), true);
  assert.equal(requestContainsExactPath(`업로드: \`${path}\``, path), true);
  assert.equal(requestContainsExactPath(`다른 파일 ${path}.bak`, path), false);
  assert.equal(requestContainsExactPath(`/prefix${path}`, path), false);
  assert.equal(requestContainsExactPath('report.pdf를 올려줘', path), false);
  assert.equal(requestContainsExactPath('경로 없음', ''), false);
  const workspace = '/Users/test/workspace';
  const nested = '/Users/test/workspace/00_test/06_Telegram/file.txt';
  assert.equal(requestContainsWorkspacePath('작업 폴더의 06_Telegram/file.txt를 보내줘', nested, workspace), true);
  assert.equal(requestContainsWorkspacePath('file.txt를 보내줘', nested, workspace), false);
  assert.equal(requestContainsWorkspacePath('06_Other/file.txt를 보내줘', nested, workspace), false);
});

test('일반 terminal PATH는 내부 agent-browser binary를 노출하지 않는다', () => {
  const source = [
    '/Applications/GPAO-T5.app/Contents/Resources/runtime/bin',
    '/Applications/GPAO-T5.app/Contents/Resources/app/refoundation/node_modules/.bin',
    '/opt/homebrew/bin', '/usr/bin', '/bin',
  ].join(':');
  const safe = sanitizeTerminalPath(source, ':');
  assert.doesNotMatch(safe, /refoundation\/node_modules\/\.bin/u);
  assert.match(safe, /Resources\/runtime\/bin/u); assert.match(safe, /\/usr\/bin/u);
  const instructions = consoleInstructions('/Users/example', {});
  assert.match(instructions, /Never invoke agent-browser.*exec.*internal browser/i);
});

test('일반 사용자 콘솔은 검색·URL 읽기를 바로 보이고 화면 조작과 managed process·PTY는 필요할 때만 연다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../src/console-server.js', import.meta.url), 'utf8',
  ));
  const coreBlock = /const currentCoreToolNames = \[([\s\S]*?)\];/u.exec(source)?.[1] ?? '';
  assert.match(coreBlock, /'web_search'/u);
  assert.match(coreBlock, /'web_read'/u);
  assert.match(coreBlock, /'web_research'/u);
  assert.match(coreBlock, /'visual_reference'/u);
  assert.match(source, /T5 CURRENT BROWSER RUNTIME/u);
  assert.match(source, /historical assistant statement that a login window is open is not current evidence/iu);
  assert.doesNotMatch(coreBlock, /'browser'/u);
  assert.doesNotMatch(coreBlock, /'process_start'|'pty_start'|'process_control'/u);
  assert.match(coreBlock, /'session_search'/u);
  assert.match(source, /Do not use this tool to navigate search-engine result pages/u);
  assert.match(source, /searchable = deferredTools\.filter\(\(tool\) => tool\.deferred[\s\S]*tool\.name !== 'browser' && tool\.name !== 'work_control'/u);
});

test('공개 정보 검색은 검색엔진 화면보다 검색→URL 읽기를 우선하도록 지시한다', () => {
  const instructions = consoleInstructions('/Users/example', {});
  assert.match(instructions, /public-information lookup.*never navigate.*search-engine results page.*fallback/i);
  assert.match(instructions, /Use web_search, then web_read/i);
  assert.match(instructions, /search-engine name.*not a source-domain allowlist/i);
  assert.match(instructions, /confirm, inspect, analyze, or summarize.*snippets alone are not completion/i);
  assert.match(instructions, /refine the web search once.*read the best exact candidate/i);
  assert.match(instructions, /Google business or place profile.*Google Maps destination.*maps\/search\/\?api=1.*Do not use.*google\.com\/search/i);
  assert.match(instructions, /Google Maps destination.*visibleBrowser=never.*another public source.*do not open a visible browser.*explicitly asked/i);
  assert.match(instructions, /missing search candidates.*not by itself permission.*visible browser/i);
  assert.match(instructions, /browser only when the user asked for page interaction.*visibleBrowser=user_interaction.*Readable static text does not prove.*fill.*submit.*rendered state/i);
  assert.match(instructions, /current or latest news.*exactly two.*current local date.*sourceLimit 4.*requested item count.*maximum of 6/i);
  assert.match(instructions, /search snippet.*topic hub.*observed publication date.*readable article body.*does not establish the latest news/i);
  assert.match(instructions, /directOriginalLabelAllowed=false.*never label.*original.*direct source.*wire-service original/i);
  assert.match(instructions, /synthesized result first.*source links.*candidate list alone is not a completed/i);
  assert.match(instructions, /remind me.*no delivery surface.*Ask one direct question.*operating-system notification.*use exec.*inspect the installed schedule/i);
  assert.match(instructions, /T5 automation receipt is not proof of an OS notification.*cancel.*same turn.*verify absence/i);
  assert.match(instructions, /previous conversation.*use session_search.*empty memory result is not evidence.*past event did not occur/i);
});

test('제품 콘솔은 기존 Browser driver를 연결하되 별도 Chrome host를 보유하지 않는다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../scripts/start-console.mjs', import.meta.url), 'utf8',
  ));
  assert.match(source, /makeAgentBrowserDriver/u);
  assert.match(source, /browserDriverFactory/u);
  assert.doesNotMatch(source, /browserHost|makePersistentBrowserHost/u);
});
