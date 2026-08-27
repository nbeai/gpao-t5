import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, open as openFile, opendir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { inspectBusinessDocument } from './document-data-inspector.js';

const runFile = promisify(execFile);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm', '.css',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.hpp', '.swift', '.kt', '.kts', '.yaml', '.yml', '.toml', '.ini',
  '.log', '.sql', '.sh', '.zsh', '.ps1', '.bat', '.cmd',
]);
const DEFAULT_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git', 'node_modules', '__pycache__', '.cache', '.Trash', '$RECYCLE.BIN', 'System Volume Information',
]);
const DEFAULT_PROTECTED_DIRECTORY_NAMES = new Set([
  '.ssh', '.gnupg', '.aws', '.azure', 'Keychains',
]);

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\s._\-()[\]{}]+/gu, ' ').trim();
}

function compact(value) { return normalize(value).replace(/\s+/gu, ''); }
function words(value) { return normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []; }
function grams(value) {
  const text = ` ${compact(value)} `; const output = new Set();
  if (text.length <= 3) { if (text.trim()) output.add(text.trim()); return output; }
  for (let index = 0; index <= text.length - 3; index += 1) output.add(text.slice(index, index + 3));
  return output;
}
function dice(left, right) {
  const a = grams(left); const b = grams(right); if (!a.size || !b.size) return 0;
  let shared = 0; for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}
function lexicalEvidence(query, name, location) {
  const queryWords = words(query); const nameText = normalize(name); const pathText = normalize(location);
  const matchedName = queryWords.filter((item) => compact(nameText).includes(compact(item)));
  const matchedPath = queryWords.filter((item) => !matchedName.includes(item) && compact(pathText).includes(compact(item)));
  const nameSimilarity = dice(query, nameText); const pathSimilarity = dice(query, pathText);
  return { matchedName, matchedPath, nameSimilarity, pathSimilarity,
    score: matchedName.length * 7 + matchedPath.length * 2 + nameSimilarity * 8 + pathSimilarity * 2 };
}
function contentEvidence(query, content) {
  const queryWords = words(query).filter((item) => item.length >= 2); const text = normalize(content);
  const matched = queryWords.filter((item) => compact(text).includes(compact(item)));
  return { matched, score: matched.length * 5 };
}
function safeInteger(value, fallback, min, max) {
  const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function pathInside(candidate, root) {
  const rel = relative(root, candidate); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function locationText(path, home) {
  const exact = resolve(path); const root = resolve(home);
  if (pathInside(exact, root)) return `~/${relative(root, exact).split(sep).join('/')}`;
  return exact.split(sep).filter(Boolean).slice(-4).join('/');
}
function protectedPath(path, protectedRoots) {
  const exact = resolve(path);
  if (protectedRoots.some((root) => pathInside(exact, root))) return true;
  return exact.split(sep).some((part) => DEFAULT_PROTECTED_DIRECTORY_NAMES.has(part));
}
async function streamSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function boundedText(path, bytes = 64 * 1024) {
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return null;
  const handle = await openFile(path, 'r');
  try {
    const bounded = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await handle.read(bounded, 0, bytes, 0);
    const observed = bounded.subarray(0, bytesRead);
    if (observed.includes(0)) return null;
    return observed.toString('utf8');
  } finally { await handle.close(); }
}
async function documentText(path) {
  const extension = extname(path).toLowerCase();
  if (!['.pdf', '.xlsx', '.xlsm', '.xltx'].includes(extension)) return null;
  try {
    const observed = await inspectBusinessDocument({ file: path, maxPages: 30, maxCells: 3_000 });
    if (observed.kind === 'pdf') return observed.pdf.pages.map((page) => page.text).join('\n').slice(0, 256_000);
    return observed.workbook.sheets.flatMap((sheet) => [sheet.name,
      ...(sheet.cells ?? []).map((cell) => String(cell.value ?? cell.result ?? cell.formula ?? ''))]).join('\n').slice(0, 256_000);
  } catch { return null; }
}
async function defaultIndexSearch({ query, roots, platform, limit }) {
  if (platform !== 'darwin') return [];
  const found = [];
  for (const root of roots) {
    try {
      const { stdout } = await runFile('/usr/bin/mdfind', ['-0', '-onlyin', root, query], {
        timeout: 8_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer',
      });
      for (const value of Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean)) {
        if (!found.includes(value)) found.push(value);
        if (found.length >= limit) return found;
      }
    } catch { /* bounded filesystem fallback below */ }
  }
  return found;
}
async function walkFiles(roots, { maxFiles, deadline, excludedDirectoryNames, protectedRoots }) {
  const files = []; let visited = 0; let unreadable = 0; let truncated = false;
  const pending = roots.map((item) => resolve(item));
  while (pending.length && files.length < maxFiles && Date.now() < deadline) {
    const directory = pending.shift(); if (protectedPath(directory, protectedRoots)) continue;
    let opened;
    try { opened = await opendir(directory); } catch { unreadable += 1; continue; }
    try {
      for await (const entry of opened) {
        if (Date.now() >= deadline || files.length >= maxFiles) { truncated = true; break; }
        const path = join(directory, entry.name); visited += 1;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!excludedDirectoryNames.has(entry.name) && !protectedPath(path, protectedRoots)) pending.push(path);
        } else if (entry.isFile()) files.push(path);
      }
    } catch { unreadable += 1; }
  }
  if (pending.length || files.length >= maxFiles || Date.now() >= deadline) truncated = true;
  return { files, visited, unreadable, truncated };
}
function exactRecord(path, stat, home, evidence = {}) {
  return { path, displayName: basename(path), locationText: locationText(path, home),
    extension: extname(path).toLowerCase(), bytes: stat.size, modifiedAt: stat.mtime.toISOString(),
    identity: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }, evidence };
}
function currentIdentity(record, stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.dev === record.identity.dev && stat.ino === record.identity.ino
    && stat.size === record.identity.size && stat.mtimeMs === record.identity.mtimeMs;
}
function organizationEffect(effect) {
  return effect?.kind === 'local_change' && effect?.reversible === true && effect?.backupAvailable === true;
}
async function statOrNull(path) {
  try { return await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
function identityMatches(identity, stat) {
  return stat != null && currentIdentity({ identity }, stat);
}

export function makeFileRealityTool({
  workspace,
  home,
  platform = process.platform,
  computerRoots = [home],
  protectedRoots = [],
  organizationRoot = null,
  sourceManifestStore = null,
  sessionId = null,
  indexSearch = defaultIndexSearch,
  now = Date.now,
} = {}) {
  if (!workspace || !home) throw new TypeError('file reality workspace and home are required');
  const handles = new Map();
  const volatilePlans = new Map();
  const canonicalProtectedRoots = Promise.all(protectedRoots.map(async (item) => {
    try { return await realpath(resolve(item)); } catch { return resolve(item); }
  }));
  const rootsFor = async (scope, path) => {
    const selected = scope ?? 'computer';
    const raw = selected === 'workspace' ? [workspace]
      : selected === 'path' ? [path] : computerRoots;
    if (!raw.length || raw.some((item) => !item || !isAbsolute(String(item)))) throw new TypeError('file search scope is invalid');
    const output = []; let unavailableRoots = 0;
    for (const item of raw) {
      try {
        const exact = await realpath(resolve(item)); const stat = await lstat(exact);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('file search root is unavailable');
        if (!output.includes(exact)) output.push(exact);
      } catch (error) {
        if (selected === 'path') throw error;
        unavailableRoots += 1;
      }
    }
    if (!output.length) throw new Error('file search roots are unavailable');
    return { roots: output, unavailableRoots };
  };
  const remember = (record) => {
    const handle = `file-${randomUUID()}`; handles.set(handle, record); return handle;
  };
  const planFile = (planId) => organizationRoot ? join(organizationRoot, `${planId}.json`) : null;
  const savePlan = async (plan) => {
    volatilePlans.set(plan.planId, structuredClone(plan));
    if (!organizationRoot) return;
    await mkdir(organizationRoot, { recursive: true, mode: 0o700 }); await chmod(organizationRoot, 0o700);
    const target = planFile(plan.planId); const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(plan), { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  };
  const loadPlan = async (planId) => {
    const id = String(planId ?? ''); if (!/^plan-[0-9a-f-]{36}$/iu.test(id)) throw new Error('organization plan is unavailable');
    if (organizationRoot) {
      try { return JSON.parse(await readFile(planFile(id), 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const plan = volatilePlans.get(id); if (!plan) throw new Error('organization plan is unavailable'); return structuredClone(plan);
  };
  const reopen = async (handle) => {
    const record = handles.get(String(handle ?? '')); if (!record) throw new Error('file candidate handle is unavailable');
    const stat = await lstat(record.path);
    if (!currentIdentity(record, stat)) {
      const mismatch = { dev: stat.dev !== record.identity.dev, ino: stat.ino !== record.identity.ino,
        size: stat.size !== record.identity.size, mtime: stat.mtimeMs !== record.identity.mtimeMs };
      throw Object.assign(new Error('file candidate changed after search'), { code: 'T5_FILE_CHANGED', mismatch });
    }
    return { record, stat };
  };
  return {
    name: 'file_reality',
    description: 'Find real local files when the user remembers only approximate names, contents, dates, amounts, people, projects, or prior context; search either the whole requested computer scope, the current workspace, or one exact folder. Return bounded opaque candidates and evidence without sending the whole filesystem or file contents to the model. Inspect selected candidates, compare exact duplicates or possible versions, and preview an exact organization plan with collision facts before any file is changed. Never declare a final version from the filename alone.',
    searchTerms: [
      'find local file whole computer vague name content duplicate latest version',
      '컴퓨터 전체 파일 찾기 이름 위치 모름 내용 단서 중복 최종본 버전',
      '다운로드 문서 엑셀 계약서 견적서 어디 뒀는지 기억 안남',
    ],
    relatedTools: ['attachment'],
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['search', 'inspect', 'compare', 'plan', 'apply', 'rollback', 'bind_sources'] },
      query: { type: ['string', 'null'], maxLength: 500 },
      scope: { type: ['string', 'null'], enum: ['computer', 'workspace', 'path', null] },
      path: { type: ['string', 'null'], maxLength: 4096 },
      handles: { type: ['array', 'null'], maxItems: 12, items: { type: 'string', maxLength: 64 } },
      maxCandidates: { type: ['integer', 'null'], minimum: 1, maximum: 20 },
      placements: { type: ['array', 'null'], maxItems: 12, items: { type: 'object', additionalProperties: false,
        properties: { handle: { type: 'string', maxLength: 64 }, destinationDirectory: { type: 'string', maxLength: 4096 } },
        required: ['handle', 'destinationDirectory'] } },
      planId: { type: ['string', 'null'], maxLength: 64 },
      effect: { type: ['object', 'null'], additionalProperties: false, properties: {
        kind: { type: 'string', enum: ['local_change'] }, reversible: { type: 'boolean' }, backupAvailable: { type: 'boolean' },
      }, required: ['kind', 'reversible', 'backupAvailable'] },
      sourceUses: { type: ['array', 'null'], maxItems: 12, items: { type: 'object', additionalProperties: false,
        properties: { handle: { type: 'string', maxLength: 64 }, usage: { type: 'string', maxLength: 500 } }, required: ['handle', 'usage'] } },
      purpose: { type: ['string', 'null'], maxLength: 500 },
      unknowns: { type: ['array', 'null'], maxItems: 20, items: { type: 'string', maxLength: 500 } },
    }, required: ['action', 'query', 'scope', 'path', 'handles', 'maxCandidates', 'placements', 'planId', 'effect', 'sourceUses', 'purpose', 'unknowns'] },
    async preflight(args) {
      if (!['apply', 'rollback'].includes(args?.action)) return { allowed: true };
      return organizationEffect(args.effect) ? { allowed: true }
        : { allowed: false, outcome: 'not_executed', result: { state: 'reversible_local_change_required' } };
    },
    async execute({ action, query, scope, path, handles: requestedHandles, maxCandidates, placements, planId, effect,
      sourceUses, purpose, unknowns } = {}) {
      if (action === 'search') {
        const clue = String(query ?? '').trim(); if (clue.length < 2) throw new TypeError('file search clues are required');
        const rootState = await rootsFor(scope, path); const roots = rootState.roots;
        const exactProtectedRoots = await canonicalProtectedRoots;
        const limit = safeInteger(maxCandidates, 10, 1, 20);
        const startedAt = now(); const deadline = startedAt + 7_500;
        const indexed = await indexSearch({ query: clue, roots, platform, limit: 500 });
        const walk = await walkFiles(roots, { maxFiles: 200_000, deadline,
          excludedDirectoryNames: DEFAULT_EXCLUDED_DIRECTORY_NAMES, protectedRoots: exactProtectedRoots });
        const indexedSet = new Set();
        for (const item of indexed) {
          let candidate; try { candidate = await realpath(resolve(item)); } catch { continue; }
          if (roots.some((root) => pathInside(candidate, root))) indexedSet.add(candidate);
        }
        const paths = [...new Set([...indexedSet, ...walk.files])];
        const ranked = []; let contentProbes = 0;
        for (const candidate of paths) {
          if (now() >= deadline && !indexedSet.has(resolve(candidate))) break;
          if (protectedPath(candidate, exactProtectedRoots)) continue;
          let stat; try { stat = await lstat(candidate); } catch { continue; }
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          const lexical = lexicalEvidence(clue, basename(candidate), locationText(candidate, home));
          let content = { matched: [], score: 0 };
          if (indexedSet.has(resolve(candidate)) || lexical.score > 1
            || (contentProbes < 2_000 && TEXT_EXTENSIONS.has(extname(candidate).toLowerCase()))) {
            contentProbes += 1;
            const observed = await boundedText(candidate).catch(() => null);
            if (observed) content = contentEvidence(clue, observed);
          }
          const score = lexical.score + content.score + (indexedSet.has(resolve(candidate)) ? 10 : 0);
          if (score <= 0) continue;
          ranked.push({ record: exactRecord(candidate, stat, home, { indexed: indexedSet.has(resolve(candidate)),
            matchedNameTerms: lexical.matchedName, matchedLocationTerms: lexical.matchedPath,
            matchedContentTerms: content.matched, nameSimilarity: Number(lexical.nameSimilarity.toFixed(3)) }), score });
        }
        ranked.sort((left, right) => right.score - left.score
          || right.record.modifiedAt.localeCompare(left.record.modifiedAt)
          || left.record.displayName.localeCompare(right.record.displayName));
        const candidates = ranked.slice(0, limit).map(({ record, score }) => ({
          handle: remember(record), displayName: record.displayName, locationText: record.locationText,
          extension: record.extension, bytes: record.bytes, modifiedAt: record.modifiedAt,
          evidence: record.evidence, rankScore: Number(score.toFixed(3)),
        }));
        return { state: 'observed', scope: scope ?? 'computer', candidates,
          coverage: { roots: roots.length, unavailableRoots: rootState.unavailableRoots,
            indexedCandidates: indexedSet.size, filesystemFilesVisited: walk.files.length,
            filesystemEntriesVisited: walk.visited, unreadableDirectories: walk.unreadable,
            contentProbes, truncated: walk.truncated || now() >= deadline, elapsedMs: Math.max(0, now() - startedAt) },
          contentIncluded: false };
      }
      if (action === 'inspect') {
        if (!Array.isArray(requestedHandles) || requestedHandles.length !== 1) throw new TypeError('one file handle is required');
        const { record } = await reopen(requestedHandles[0]); const sha256 = await streamSha256(record.path);
        let content = await boundedText(record.path, 96 * 1024).catch(() => null);
        if (content == null) content = await documentText(record.path);
        return { state: 'observed', file: { handle: requestedHandles[0], displayName: record.displayName,
          locationText: record.locationText, extension: record.extension, bytes: record.bytes,
          modifiedAt: record.modifiedAt, sha256 },
        content: content == null ? null : content.slice(0, 48_000), contentTruncated: content != null && content.length > 48_000 };
      }
      if (action === 'compare') {
        if (!Array.isArray(requestedHandles) || requestedHandles.length < 2) throw new TypeError('two or more file handles are required');
        const records = [];
        for (const handle of [...new Set(requestedHandles.map(String))]) {
          const { record } = await reopen(handle); const sha256 = await streamSha256(record.path);
          const content = await boundedText(record.path, 256 * 1024).catch(() => null);
          records.push({ handle, record, sha256, content });
        }
        const comparisons = [];
        for (let left = 0; left < records.length; left += 1) for (let right = left + 1; right < records.length; right += 1) {
          const a = records[left]; const b = records[right];
          comparisons.push({ left: a.handle, right: b.handle, exactDuplicate: a.sha256 === b.sha256,
            filenameSimilarity: Number(dice(a.record.displayName, b.record.displayName).toFixed(3)),
            contentSimilarity: a.content != null && b.content != null
              ? Number(dice(a.content, b.content).toFixed(3)) : null,
            sizeDeltaBytes: b.record.bytes - a.record.bytes,
            newer: a.record.modifiedAt === b.record.modifiedAt ? null
              : a.record.modifiedAt > b.record.modifiedAt ? a.handle : b.handle });
        }
        return { state: 'observed', files: records.map(({ handle, record, sha256 }) => ({ handle,
          displayName: record.displayName, locationText: record.locationText, bytes: record.bytes,
          modifiedAt: record.modifiedAt, sha256 })), comparisons,
        finalVersionSelected: false, finalVersionReason: 'user purpose and file history are required' };
      }
      if (action === 'plan') {
        if (!Array.isArray(placements) || placements.length < 1) throw new TypeError('one or more file placements are required');
        const roots = (await rootsFor('computer')).roots; const exactProtectedRoots = await canonicalProtectedRoots;
        const seenSources = new Set(); const seenTargets = new Set(); const changes = []; const operations = [];
        for (const placement of placements) {
          const { record, stat } = await reopen(placement.handle);
          if (seenSources.has(record.path)) throw new TypeError('a file can appear only once in an organization plan');
          seenSources.add(record.path);
          const destination = await realpath(resolve(placement.destinationDirectory));
          const destinationStat = await lstat(destination);
          if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()
            || protectedPath(destination, exactProtectedRoots)
            || !roots.some((root) => pathInside(destination, root))) throw new Error('organization destination is unavailable');
          const target = join(destination, record.displayName);
          if (seenTargets.has(target)) throw new TypeError('organization plan has duplicate destinations');
          seenTargets.add(target);
          let targetStat = null; try { targetStat = await lstat(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
          const alreadyThere = resolve(record.path) === resolve(target);
          const collision = targetStat != null && !alreadyThere;
          const crossVolume = !alreadyThere && stat.dev !== destinationStat.dev;
          changes.push({ handle: placement.handle, displayName: record.displayName,
            from: record.locationText, to: locationText(target, home), bytes: stat.size,
            state: alreadyThere ? 'already_there' : collision ? 'collision' : crossVolume ? 'cross_volume_unsupported' : 'ready' });
          operations.push({ source: record.path, target, identity: record.identity,
            displayName: record.displayName, state: alreadyThere ? 'unchanged' : 'pending' });
        }
        const id = `plan-${randomUUID()}`; const readyToApply = changes.every((item) => ['ready', 'already_there'].includes(item.state));
        await savePlan({ schema: 't5.file-organization-plan.v1', planId: id, state: 'planned', operations,
          createdAt: new Date(now()).toISOString() });
        return { state: 'planned', planId: id, changes, readyToApply,
          filesChanged: 0, note: 'preview only; no file was moved, renamed, overwritten, or deleted' };
      }
      if (action === 'apply') {
        if (!organizationEffect(effect)) throw new Error('reversible local change declaration is required');
        const plan = await loadPlan(planId); if (plan.state !== 'planned') throw new Error('organization plan is not ready to apply');
        if (plan.operations.some((item) => !['pending', 'moved', 'unchanged'].includes(item.state))) throw new Error('organization plan state is invalid');
        for (const operation of plan.operations) {
          if (operation.state === 'unchanged') continue;
          const source = await statOrNull(operation.source); const target = await statOrNull(operation.target);
          if (source == null && identityMatches(operation.identity, target)) {
            operation.state = 'moved'; await savePlan(plan); continue;
          }
          const parent = await lstat(parse(operation.target).dir);
          if (!identityMatches(operation.identity, source) || source.dev !== parent.dev) throw new Error('organization source changed after preview');
          if (target != null) throw new Error('organization destination collision');
        }
        const moved = [];
        try {
          for (const operation of plan.operations) {
            if (operation.state !== 'pending') continue;
            await rename(operation.source, operation.target); operation.state = 'moved'; moved.push(operation); await savePlan(plan);
          }
        } catch (error) {
          let rollbackVerified = true;
          for (const operation of moved.reverse()) {
            try { await rename(operation.target, operation.source); operation.state = 'pending'; await savePlan(plan); }
            catch { rollbackVerified = false; operation.state = 'recovery_required'; }
          }
          plan.state = rollbackVerified ? 'planned' : 'recovery_required'; await savePlan(plan); throw error;
        }
        plan.state = 'applied'; plan.appliedAt = new Date(now()).toISOString(); await savePlan(plan);
        return { state: 'applied', planId: plan.planId,
          filesMoved: plan.operations.filter((item) => item.state === 'moved').length,
          rollbackAvailable: true, files: plan.operations.map((item) => ({ displayName: item.displayName, state: item.state })) };
      }
      if (action === 'rollback') {
        if (!organizationEffect(effect)) throw new Error('reversible local change declaration is required');
        const plan = await loadPlan(planId); if (plan.state !== 'applied') throw new Error('organization plan is not applied');
        for (const operation of plan.operations.filter((item) => item.state === 'moved')) {
          const source = await statOrNull(operation.source); const target = await statOrNull(operation.target);
          if (target == null && identityMatches(operation.identity, source)) {
            operation.state = 'rolled_back'; await savePlan(plan); continue;
          }
          if (!identityMatches(operation.identity, target)) throw new Error('organized file changed after apply');
          if (source != null) throw new Error('original location is no longer empty');
        }
        const moved = plan.operations.filter((item) => item.state === 'moved').reverse();
        for (const operation of moved) { await rename(operation.target, operation.source); operation.state = 'rolled_back'; await savePlan(plan); }
        plan.state = 'rolled_back'; plan.rolledBackAt = new Date(now()).toISOString(); await savePlan(plan);
        return { state: 'rolled_back', planId: plan.planId, filesRestored: moved.length };
      }
      if (action === 'bind_sources') {
        if (!sourceManifestStore || !sessionId) throw new Error('source manifest capability is unavailable');
        if (!Array.isArray(sourceUses) || sourceUses.length < 1) throw new TypeError('one or more source uses are required');
        const sources = [];
        for (const item of sourceUses) { const { record } = await reopen(item.handle); sources.push({ ...record, usage: item.usage }); }
        return { state: 'bound', ...(await sourceManifestStore.create({ sessionId, purpose, unknowns: unknowns ?? [], sources })) };
      }
      throw new TypeError('file reality action is invalid');
    },
  };
}
