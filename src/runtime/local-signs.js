// L3 · 로컬 흔적 확인 (P5-B-1A Local Connector Probe Layer)
//
// 오너 지시: 사용자가 "노션 연결하고 싶어", "구글 볼 수 있어?", "MCP 깔려 있어?"라고 말했을 때
// **T5가 직접 확인 가능한 것들을 확인하고**, 그 결과를 connector status / selfState /
// model reality 에 반영한다. 사용자에게 터미널로 확인하게 하지 않는다.
//
// 침범 회피가 이 파일의 존재 이유다: **러너는 서비스를 모른다.** 노션·구글이라는 단어가
// 여기 없다 — 커넥터가 자기 흔적을 선언하고(ConnectorDescriptor.localSigns), 러너는 흔적의
// **종류**(app·dir·cli·mcp·file)만 안다. previewOf·subjectOf 와 같은 계약 패턴이라,
// 커넥터가 늘어도 이 파일은 안 바뀐다(도구별 if 는 이미 세 번 새어 본 자리다).
//
// 비밀 경계: **존재 여부만 확인한다.** 어떤 종류도 파일 내용을 사용자면·모델면으로 옮기지
// 않는다. mcp 종류만 설정 파일을 파싱하는데, 서버 **이름 키**만 보고 값(명령·토큰)은 버린다.
import { access, readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const 존재 = (p) => access(p).then(() => true, () => false);
const 홈풀기 = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** MCP 호스트들의 설정 자리(서비스가 아니라 **호스트** 목록이다 — 서비스 분기가 아니다). */
const MCP_CONFIG_PATHS = [
  '~/Library/Application Support/Claude/claude_desktop_config.json',
  '~/.claude.json',
  '~/.codex/config.toml',
];

/** `GoogleDrive-*` 같은 마지막 조각의 * 만 지원한다 — 더 큰 글롭이 필요해지면 그때 넓힌다. */
async function 폴더찾기(pattern) {
  const p = 홈풀기(pattern);
  if (!p.includes('*')) return (await 존재(p)) ? p : undefined;
  const dir = dirname(p);
  const name = basename(p);
  const [head, tail] = name.split('*');
  const entries = await readdir(dir).catch(() => []);
  const hit = entries.find((e) => e.startsWith(head) && e.endsWith(tail ?? ''));
  return hit ? join(dir, hit) : undefined;
}

async function cli있나(command, deps) {
  return new Promise((resolve) => {
    (deps.execFileImpl ?? execFile)('which', [command], (err, stdout) => {
      resolve(err ? undefined : String(stdout).trim() || undefined);
    });
  });
}

/** 설정 파일에서 **서버 이름 키만** 꺼낸다. 값(명령줄·env·토큰)은 여기서 버린다. */
async function mcp서버이름들(deps) {
  const names = [];
  for (const raw of deps.mcpConfigPaths ?? MCP_CONFIG_PATHS) {
    const p = 홈풀기(raw);
    const text = await readFile(p, 'utf8').catch(() => undefined);
    if (!text) continue;
    if (p.endsWith('.toml')) {
      // 의존성 0 유지 — toml 파서를 들이지 않고 `[mcp_servers.이름]` 헤더만 줍는다.
      for (const m of text.matchAll(/^\s*\[mcp_servers\.([^\]]+)\]/gm)) names.push({ name: m[1], where: p });
      continue;
    }
    try {
      const j = JSON.parse(text);
      const servers = j.mcpServers ?? j.mcp_servers ?? {};
      for (const name of Object.keys(servers)) names.push({ name, where: p });
      // claude.json 은 프로젝트별로도 든다 — 키 이름만 훑는다(값은 안 본다).
      for (const proj of Object.values(j.projects ?? {})) {
        for (const name of Object.keys(proj?.mcpServers ?? {})) names.push({ name, where: p });
      }
    } catch { /* 깨진 설정은 없는 것으로 — 지어내지 않는다 */ }
  }
  return names;
}

/**
 * 흔적 선언 하나를 확인한다. @returns {{label:string, found:boolean, where?:string}}
 * 종류:
 *   {kind:'app',  path, label}          앱 설치 여부
 *   {kind:'dir',  paths:[…], label}     폴더(동기화 폴더 등) — 첫 일치. 마지막 조각 * 허용
 *   {kind:'cli',  command, label}       명령 설치 여부(which)
 *   {kind:'mcp',  server, label}        MCP 호스트 설정에 그 이름의 서버가 있는가(키 이름만)
 *   {kind:'file', paths:[…], label}     설정·인증 **흔적의 존재만**(내용은 절대 읽지 않는다)
 */
export async function checkSign(sign, deps = {}) {
  const out = { label: sign.label, found: false };
  try {
    if (sign.kind === 'app' || sign.kind === 'file') {
      for (const p of sign.paths ?? [sign.path]) {
        if (await 존재(홈풀기(p))) return { ...out, found: true, where: 홈풀기(p) };
      }
    } else if (sign.kind === 'dir') {
      for (const p of sign.paths ?? [sign.path]) {
        const hit = await 폴더찾기(p);
        if (hit) return { ...out, found: true, where: hit };
      }
    } else if (sign.kind === 'cli') {
      const where = await cli있나(sign.command, deps);
      if (where) return { ...out, found: true, where };
    } else if (sign.kind === 'mcp') {
      const names = await mcp서버이름들(deps);
      const hit = names.find((n) => n.name.toLowerCase().includes(String(sign.server).toLowerCase()));
      if (hit) return { ...out, found: true, where: hit.where };
    }
  } catch { /* 확인 실패 = 못 찾음. 실패를 성공으로 기록하지 않는다 */ }
  return out;
}

/**
 * 커넥터 목록의 선언된 흔적을 전부 확인해 **커넥터에 결과를 얹는다**(제자리 갱신 —
 * 서버가 매 턴 같은 배열을 읽으므로 다음 턴부터 모델 현실에 반영된다).
 * 확인한 시각을 함께 남긴다: 확인 안 한 것을 확인했다고 말하지 않기 위한 근거다.
 */
export async function checkConnectorSigns(connectors = [], deps = {}) {
  const now = deps.now ?? (() => Date.now());
  for (const c of connectors) {
    if (!Array.isArray(c.localSigns) || !c.localSigns.length) continue;
    try {
      c.localSignsResult = await Promise.all(c.localSigns.map((s) => checkSign(s, deps)));
      c.lastCheckedAt = now();
      c.lastError = undefined;
    } catch (e) {
      c.lastError = '로컬 흔적 확인에 실패했어요';
      c.lastCheckedAt = now();
    }
  }
  return connectors;
}
