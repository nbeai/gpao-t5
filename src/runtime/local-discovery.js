// L3 · 공통 엔지니어링 탐색. 서비스 이름을 아는 것이 아니라, 이미 있는 연결 단서를 읽는다.
// 비밀·설정 본문·자동 연결은 다루지 않는다. 후보는 다음 판단의 근거일 뿐 연결 성공이 아니다.
import { readdir } from 'node:fs/promises';
import { delimiter } from 'node:path';
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

export function makeLocalDiscoveryTool(deps = {}) {
  const connectors = () => deps.connectors?.() ?? [];
  return {
    subjectOf(rec) {
      const subject = rec?.actualCall?.args?.subject;
      return subject ? { key: `discovery:${subject}`, kind: 'discovery', label: String(subject) } : null;
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
      for (const c of connectors()) {
        const names = [c.id, c.label, ...(c.aliases ?? [])];
        if (names.some((name) => matches(name, subject))) {
          add('connector', c.label ?? c.id, c.connected ? 'T5 연결 상태가 확인돼 있어요' : 'T5에 연결 선언은 있지만 현재 직접 연결은 아니에요');
        }
      }
      const connectionDiscovery = { subject, checked: ['mcp', 'cli', 'known_connectors'], candidates };
      return {
        result: { ...connectionDiscovery, checkedAt: Date.now() },
        connectionDiscovery,
        userSafeSummary: candidates.length ? '기존 연결 단서를 찾았어요.' : '바로 쓸 연결 단서는 아직 찾지 못했어요.',
      };
    },
  };
}
