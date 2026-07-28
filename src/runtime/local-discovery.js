// L3 · 공통 엔지니어링 탐색. 서비스 이름을 아는 것이 아니라, 이미 있는 연결 단서를 읽는다.
// 비밀·설정 본문·자동 연결은 다루지 않는다. 후보는 다음 판단의 근거일 뿐 연결 성공이 아니다.
import { readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { mcpServerNames } from './local-signs.js';

const norm = (v) => String(v ?? '').normalize('NFC').toLowerCase().replace(/[\s._-]+/g, '');
// 실측(감사 2026-07-28): `듣도보도못한상점ABC` 에 `bc(cli)`·`ab(cli)` 가 단서로 나왔다.
// `bc`(계산기)·`ab`(apache bench)는 실제로 설치된 명령이라 짧은 이름이 아무 말 안에나 들어간다.
// `abc마켓` 도 같은 둘을 낸다. 모델은 이걸 **"기존 연결 단서를 찾았어요"** 로 읽는다 —
// 오탐이 아니라 **거짓 현실**이다(없는 연결을 사실로 주는 것).
//
// 그래서 겹침이 **근거가 될 만큼 길 때만** 단서로 센다. 완전 일치는 길이와 무관하다.
// 값: `gh` ↔ `github` 같은 두 글자 명령은 이제 못 잡는다. 그건 감수한다 — 그런 서비스는
// 커넥터가 `localSigns` 로 직접 선언하고(깃허브가 그렇게 한다), 여기서 없다고 말하는 것은
// 정직한 결과다("없음은 불가능이 아니다" — P-OP-3 설계).
const MIN_CLUE_CHARS = 3;
const matches = (name, subject) => {
  const a = norm(name); const b = norm(subject);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < MIN_CLUE_CHARS) return false;
  return a.includes(b) || b.includes(a);
};

async function commandNames(deps = {}) {
  const dirs = deps.pathDirs ?? String(deps.path ?? process.env.PATH ?? '').split(delimiter);
  const out = new Set();
  for (const dir of dirs.slice(0, 24)) {
    for (const entry of await readdir(dir).catch(() => [])) out.add(entry);
  }
  return [...out];
}

const HOME = () => homedir();
const defaultRoots = (deps = {}) => ({
  apps: deps.appDirs ?? ['/Applications', join(HOME(), 'Applications')],
  sync: deps.syncDirs ?? [join(HOME(), 'Library', 'CloudStorage'), join(HOME(), 'Library', 'Mobile Documents')],
  settings: deps.settingsDirs ?? [join(HOME(), '.config'), join(HOME(), 'Library', 'Application Support')],
  files: deps.fileRoots ?? [join(HOME(), 'Desktop'), join(HOME(), 'Documents'), join(HOME(), 'Downloads')],
});

async function matchingEntries(dirs, subject, deps = {}) {
  const found = [];
  for (const dir of dirs) {
    const entries = await (deps.readdirImpl ?? readdir)(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches(entry.name, subject)) found.push({ name: entry.name, directory: entry.isDirectory() });
    }
  }
  return found;
}

async function matchingLocalFiles(roots, subject, deps = {}) {
  const found = [];
  const visit = async (dir, depth) => {
    if (depth > (deps.fileSearchDepth ?? 2) || found.length >= 5) return;
    const entries = await (deps.readdirImpl ?? readdir)(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= 5) break;
      const path = join(dir, entry.name);
      if (matches(entry.name, subject)) found.push(entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) await visit(path, depth + 1);
    }
  };
  for (const root of roots) await visit(root, 0);
  return found;
}

export function makeLocalDiscoveryTool(deps = {}) {
  const connectors = () => deps.connectors?.() ?? [];
  return {
    subjectOf(rec) {
      const subject = rec?.connectionDiscovery?.subject ?? rec?.actualCall?.args?.subject;
      if (!subject) return null;
      const found = rec?.connectionDiscovery?.candidates ?? [];
      const checked = rec?.connectionDiscovery?.checked ?? [];
      return {
        key: `discovery:${subject}`,
        kind: 'discovery',
        label: String(subject),
        // 다음 턴에 필요한 것은 설정 내용이 아니라, 무엇을 직접 확인했고 맞는 길이 있었는지다.
        detail: found.length
          ? `${checked.join(' · ')}에서 ${found.map((c) => c.label).join(' · ')} 단서를 찾음`
          : `${checked.join(' · ')}을 확인했지만 맞는 연결 단서는 없음`,
      };
    },
    async handler(args = {}) {
      const subject = String(args.subject ?? '').trim();
      if (!subject) return { blocked: true, userSafeSummary: '무엇의 연결 흔적을 볼지 알려주세요.' };
      const candidates = [];
      const seen = new Set();
      const add = (kind, label, evidence) => {
        const key = `${kind}:${label}`;
        if (!seen.has(key) && candidates.length < 5) { seen.add(key); candidates.push({ kind, label, evidence }); }
      };
      for (const entry of await (deps.mcpNames ?? mcpServerNames)(deps)) {
        if (matches(entry.name, subject)) add('mcp', entry.name, 'MCP 등록 이름이 요청과 맞아요');
      }
      for (const name of await commandNames(deps)) {
        if (matches(name, subject)) add('cli', name, '설치된 명령 이름이 요청과 맞아요');
      }
      // **선언 여부는 후보 목록이 아니라 커넥터 원장에서 센다.** 후보는 다섯 개로 자르는
      // **보여주기 목록**이고, 선언 여부는 "비밀 입력면을 열 수 있나"를 정하는 **사실**이다.
      // 후보에서 세면 MCP·CLI 단서가 다섯 칸을 먼저 채웠을 때 실제로 붙일 수 있는 서비스인데도
      // `declared:false` 가 나가고, T5 는 붙일 수 있는 것을 못 붙인다고 말한다(실측 재현
      // 2026-07-28: 카페24 이름의 MCP 단서 다섯 개 뒤에 커넥터가 있으면 false 였다).
      // 잘라도 되는 것과 잘리면 안 되는 것을 같은 목록에서 세지 않는다.
      let declared = false;
      for (const c of connectors()) {
        const names = [c.id, c.label, ...(c.aliases ?? [])];
        if (names.some((name) => matches(name, subject))) {
          declared = true;
          add('connector', c.label ?? c.id, c.connected ? 'T5 연결 상태가 확인돼 있어요' : 'T5에 연결 선언은 있지만 현재 직접 연결은 아니에요');
        }
      }
      // **보는 곳을 넓힌다(코덱스 65cb808).** MCP·PATH·알려진 커넥터 셋은 전부 "T5 가 이미
      // 아는 것"이라, 웹으로만 쓰는 서비스는 어디에도 안 걸린다. 설치된 앱·동기화 폴더·설정
      // 자리·이미 내려받은 자료까지 읽기 전용으로 본다.
      const roots = defaultRoots(deps);
      for (const entry of await matchingEntries(roots.apps, subject, deps)) {
        add('app', entry.name, '이 컴퓨터에 설치된 앱 이름이 요청과 맞아요');
      }
      for (const entry of await matchingEntries(roots.sync, subject, deps)) {
        add('sync_folder', entry.name, '동기화 폴더 이름이 요청과 맞아요');
      }
      for (const entry of await matchingEntries(roots.settings, subject, deps)) {
        add('settings_trace', entry.name, '설정 자리 이름이 요청과 맞아요');
      }
      for (const name of await matchingLocalFiles(roots.files, subject, deps)) {
        add('local_file', name, '이미 내려받은 자료 이름이 요청과 맞아요');
      }
      // **그리고 "못 찾았다"와 "없다"는 다른 사실이다.** 실측(오너 라이브 2026-07-28, C):
      // 단서가 없자 T5 는 "관리자에서 CSV 로 내려받아 주세요"라고 일을 넘겼고, 동시에
      // "안전 입력면이 열려야 합니다"라며 **열릴 수 없는 면**을 약속했다.
      //
      // 두 사실을 함께 낸다. 어느 길로 가라고 말하지 않는다(§24) — 판단은 모델이 한다.
      //   · scope     이 확인이 어디까지였나. 일곱 자리 전부 **이 컴퓨터 안**이다.
      //   · declared  T5 에 이 대상에 대한 연결 선언이 있나(위에서 원장으로 셌다). 없으면
      //               비밀 입력면 자체가 열릴 수 없다 — 못 지킬 약속을 막는 사실이다.
      // 대상 이름으로 갈리지 않는다. 선언이 있는지만 본다.
      const connectionDiscovery = {
        subject,
        checked: ['mcp', 'cli', 'known_connectors', 'apps', 'sync_folders', 'settings_names', 'local_files'],
        candidates,
        scope: 'this_computer', declared,
      };
      return {
        result: { ...connectionDiscovery, checkedAt: Date.now() },
        connectionDiscovery,
        userSafeSummary: candidates.length ? '기존 연결 단서를 찾았어요.' : '바로 쓸 연결 단서는 아직 찾지 못했어요.',
      };
    },
  };
}
