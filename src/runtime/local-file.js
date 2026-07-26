// L3 · 로컬 파일 손발 (Phase 0-1) — 스텁이었던 `local.file` 을 실제로 만든다.
//
// 이전 상태: 핸들러가 `{ scanned: true }` 만 반환하는 스텁인데 레지스트리에 등록돼 있어서
// CAPABILITIES.md 가 "읽고 정리한다"고 적고 T5 가 사용자에게 그렇게 말했다 — 자기 자신에 대한 거짓말.
//
// 계약:
//   · 모든 경로는 범위(scope) 안에서만(file-scope.js). 링크 탈출도 막는다.
//   · 덮어쓰기·삭제는 **되돌릴 수 있다** — 원본을 휴지통으로 옮기고 되돌리기 표를 남긴다.
//   · 승인 등급은 기존 계약 그대로: write·delete 는 SAFETY_FLOOR 라 항상 승인(A2+)을 받는다.
//   · 실패는 종류별로 사용자 언어. 못 한 것을 한 척하지 않는다.
import { readFile, writeFile, readdir, stat, mkdir, rename, rm, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveInScope, ensureRoot, outOfScopeMessage, defaultFileRoots } from './file-scope.js';
import { protectionBlocks, protectionMessage, protectionFor } from './local-protection.js';

const MAX_READ_BYTES = 1_000_000; // 너무 큰 파일은 통째로 읽지 않는다(메모리·프롬프트 보호)

// P6-L3 · 찾기의 상한. **한 번의 요청이 프롬프트도 디스크도 삼키지 않게 한다.**
// 상한에 걸리면 조용히 자르지 않고 "여기까지만 봤다"를 결과에 남긴다 —
// 잘린 걸 숨기면 모델이 "없다"고 단정한다(§compactResult 계약과 같은 원리).
const MAX_HITS = 40;            // 사용자에게 돌려줄 결과 수
const MAX_WALK_ENTRIES = 20_000; // 훑을 항목 수(폴더가 깊어도 멈춘다)
const MAX_CONTENT_BYTES = 2_000_000; // 내용까지 뒤질 때 한 번에 읽는 총량
const MAX_FILE_SCAN_BYTES = 200_000; // 파일 하나에서 내용을 볼 최대치

// 걷지 않는 자리. **비밀은 애초에 들어가지 않는다** — 이름만 스쳐도 되는 자리가 아니고,
// 내용 검색이 켜지면 그대로 유출 통로가 된다(보호 영역 정책을 찾기가 우회하면 안 된다).
// 나머지는 사용자의 자료가 아니라 도구가 만든 더미다. 건너뛴 것은 결과에 적는다(숨기지 않는다).
const SKIP_NAMES = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache', '.Trash']);

/**
 * 폴더를 훑는다. **보호 영역은 들어가지 않고, 상한에 걸리면 멈춘 사실을 돌려준다.**
 * @returns {Promise<{files:Array, walked:number, stopped:boolean, skipped:string[]}>}
 */
async function walkFiles(root, { maxEntries = MAX_WALK_ENTRIES } = {}) {
  const files = []; const skipped = []; let walked = 0; let stopped = false;
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { continue; } // 못 읽는 폴더는 건너뛴다(권한 등) — 전체를 실패시키지 않는다
    for (const e of entries) {
      if (walked >= maxEntries) { stopped = true; break; }
      walked += 1;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_NAMES.has(e.name) || e.name.startsWith('.')) { skipped.push(full); continue; }
        if (protectionFor(full)) { skipped.push(full); continue; } // 비밀·시스템은 들어가지 않는다
        queue.push(full);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('.')) continue;
      if (protectionFor(full)) { skipped.push(full); continue; } // 비밀 파일은 이름도 결과에 담지 않는다
      files.push(full);
    }
    if (stopped) break;
  }
  return { files, walked, stopped, skipped };
}

/**
 * 바뀌는 자리 앞뒤를 보여 준다(미리보기용). 파일 전체를 승인 카드에 실을 수는 없고,
 * 그렇다고 "고칠게요"만 보여 주면 사용자가 **무엇을** 허락하는지 모른 채 누른다.
 */
function excerptAround(text, needle, pad = 80) {
  const i = text.indexOf(needle);
  if (i < 0) return text.slice(0, pad * 2);
  const from = Math.max(0, i - pad);
  const to = Math.min(text.length, i + needle.length + pad);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/** 되돌리기 표 한 줄. 휴지통 경로와 원래 자리를 함께 남긴다. */
function undoEntry(op, from, to) {
  return { id: randomUUID(), op, from, to, at: new Date().toISOString() };
}

/**
 * @param {{roots?:string[], trashDir?:string, dataDir?:string}} [deps]
 */
export function makeLocalFileTool(deps = {}) {
  // P6-L2: 다룰 수 있는 폴더는 **매 호출마다 다시 읽는다.** 시작할 때 한 번 고정하면 사용자가
  // 방금 연 폴더를 그 턴에도 다음 턴에도 못 본다 — "열었어요"라고 말해 놓고 못 여는 거짓말이 된다.
  const rootsNow = deps.rootsProvider
    ? () => deps.rootsProvider()
    : () => (deps.roots ?? defaultFileRoots());
  const roots = deps.roots ?? defaultFileRoots(); // trashDir 자리를 정할 기준(첫 루트)
  const trashDir = deps.trashDir ?? join(deps.dataDir ?? roots[0], '.trash');
  // 되돌리기 표는 **파일에 남긴다**. 메모리에만 두면 재시작 뒤 휴지통 파일은 있는데 되돌릴 방법이
  // 없어진다 — "되돌릴 수 있어요"라고 말해놓고 다음 날 못 되돌리는 거짓말이 된다(§18 지속성 계약).
  const undoFile = join(trashDir, 'undo-log.json');

  async function loadUndo() {
    try { return JSON.parse(await readFile(undoFile, 'utf8')); } catch { return []; }
  }
  async function saveUndo(list) {
    await mkdir(trashDir, { recursive: true });
    const tmp = `${undoFile}.tmp`;
    await writeFile(tmp, JSON.stringify(list.slice(-50)), 'utf8'); // 최근 50건만(무한 성장 금지)
    await rename(tmp, undoFile);
  }
  async function pushUndo(entry) {
    const list = await loadUndo();
    list.push(entry);
    await saveUndo(list);
  }

  /** 원본을 휴지통으로 옮긴다(덮어쓰기·삭제 전 필수). 없으면 아무 것도 안 한다. */
  async function toTrash(abs) {
    try { await stat(abs); } catch { return null; }
    await mkdir(trashDir, { recursive: true });
    const parked = join(trashDir, `${Date.now()}-${basename(abs)}`);
    await rename(abs, parked);
    return parked;
  }

  const ok = (userSafeSummary, result) => ({ result, userSafeSummary });
  const fail = (userSafeSummary, nextSafeAction) => ({ blocked: true, userSafeSummary, nextSafeAction });

  /**
   * P6-L4 · 옮기기·복사·이름 바꾸기의 **공통 안전장치.** 셋 다 "대상 자리에 이미 있는 것"을
   * 말없이 지울 수 있다 — copyFile 도 rename 도 조용히 덮어쓴다. 한 군데로 모아 두지 않으면
   * 하나를 고쳐도 나머지로 같은 손실이 그대로 난다(move 만 막아 놨다가 undo 로 샜던 그 일).
   */
  async function moveInto(from, dest, { keepSource, verb, preview }) {
    let destExists = false;
    try { await stat(dest); destExists = true; } catch { /* 없으면 진행 */ }
    if (destExists) {
      return fail(
        `${basename(dest)} 이(가) 이미 있어서 그대로 뒀어요(덮어쓰면 되돌릴 수 없어요).`,
        '다른 이름으로 할까요, 아니면 기존 파일을 휴지통으로 보낼까요?',
      );
    }
    if (preview) {
      return ok(`${basename(from)} → ${basename(dest)} 로 ${verb.replace('어요', '을게요')}(아직 안 했어요).`,
        { from, to: dest, applied: false });
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(from, dest);
    if (!keepSource) {
      await rm(from);
      await pushUndo(undoEntry('move', from, dest));
    }
    return ok(`${basename(from)} 을(를) ${basename(dest)} 로 ${verb}.`,
      { from, to: dest, applied: true, ...(keepSource ? { copied: true } : {}) });
  }

  /** 실패를 종류별로 사용자 언어로. 진단 원문은 화면에 내보내지 않는다. */
  function failureOf(e, path) {
    // 범위 밖은 **되는 방법을 제안할 수 있는 실패**다(§22). 사다리가 알아볼 표식을 단다.
    if (e?.isScopeError) return { blocked: true, scopeState: 'out_of_scope', ...outOfScopeMessage(e) };
    // **어디에서** 찾았는지 말한다. 이게 없으면 모델은 자기가 어디를 보고 있는지 몰라서
    // "접근이 막힌 것 같다"고 추측하고 터미널 명령을 시킨다(라이브 실측 — 개발자 떠넘김).
    if (e?.code === 'ENOENT') {
      return fail(
        `제가 다루는 폴더(${roots[0]}) 안에서 ${path} 을(를) 찾지 못했어요.`,
        '다른 폴더에 있다면 그 폴더를 열어 주시면 바로 볼게요.',
      );
    }
    if (e?.code === 'EACCES' || e?.code === 'EPERM') return fail('그 파일에 접근할 권한이 없어요.', '다른 파일로 해볼까요?');
    if (e?.code === 'EISDIR') return fail('그건 파일이 아니라 폴더예요.', '폴더 안을 보여드릴까요?');
    if (e?.code === 'ENOSPC') return fail('저장 공간이 부족해요.', '공간을 확보한 뒤 다시 할까요?');
    return fail('파일 작업 중 문제가 있었어요.', '다시 시도해 볼까요?');
  }

  return {
    toolKind: 'organize',
    /**
     * @param {{action?:string, path?:string, text?:string, to?:string}} args
     *   action: list | read | write | move | delete | undo (기본: path 있으면 read, 없으면 list)
     */
    async handler(args = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      const target = args.path ?? '.';
      try {
        const roots = await rootsNow(); // 이 호출 시점의 범위(위의 고정값을 가린다 — 의도적)
        await ensureRoot(roots);

        if (action === 'undo') {
          const list = await loadUndo();
          const last = list.pop();
          if (!last) return fail('되돌릴 작업이 없어요.');
          await mkdir(dirname(last.from), { recursive: true });
          // **되돌리는 자리에 지금 다른 파일이 있으면 그것부터 휴지통으로.** rename 은 말없이 덮어쓴다 —
          // move 의 copyFile 은 막아 놓고 undo 의 rename 을 열어 두면 같은 손실이 그대로 난다:
          // 옮기고 → 사용자가 그 이름으로 새로 쓰고 → 되돌리면 새 내용이 영영 사라졌다(감사에서 실증).
          const parked = await toTrash(last.from);
          await rename(last.to, last.from);
          await saveUndo(list); // 성공한 뒤에 표에서 지운다(중간에 실패하면 되돌릴 기회가 남아야 한다)
          return ok(
            parked
              ? `${basename(last.from)} 을(를) 되돌렸어요(그 자리에 있던 파일은 휴지통에 있어요).`
              : `${basename(last.from)} 을(를) 되돌렸어요.`,
            { undone: last.op, path: last.from, parked: Boolean(parked) },
          );
        }

        const abs = await resolveInScope(target, { roots });
        // P6-L1: **범위 안이어도 보호 영역은 막는다.** 루트를 넓혀도 여기는 안 열린다 —
        // 안전이 "좁은 루트"에서 나오던 구조를 대체하는 자리다(게이트가 불변식으로 검사한다).
        // secret 은 읽기까지, system 은 변경만 막는다(뭉뚱그리면 아무것도 못 하는 도구가 된다).
        // 읽기와 변경을 가른다. **찾기를 여기 빠뜨리면 읽기가 변경으로 분류돼** 시스템 폴더
        // 검색이 통째로 막히고, 승인 문구도 "바꿉니다"로 잘못 나간다.
        const READS = new Set(['list', 'read', 'search', 'recent']);
        const writes = !READS.has(action);
        const prot = protectionBlocks(abs, { write: writes });
        if (prot) {
          const msg = protectionMessage(prot, { write: writes });
          return { blocked: true, scopeState: 'protected', ...msg };
        }

        // ── P6-L3 · 찾기 ────────────────────────────────────────────────
        // 사용자는 경로를 외우지 않는다. "그 계약서 어디 있지"가 통해야 로컬을 실제로 다루는 것이다.
        // **어디를 뒤졌는지 결과에 남긴다** — 이게 없으면 모델이 자기가 어디를 봤는지 몰라
        // "없는 것 같다"고 단정하거나 터미널을 시킨다(라이브 실측).
        if (action === 'search' || action === 'recent') {
          const where = args.path ? [abs] : roots; // 자리를 안 정하면 다룰 수 있는 폴더 전부
          const name = String(args.query ?? args.name ?? '').trim().toLowerCase();
          const contains = String(args.contains ?? '').trim().toLowerCase();
          if (action === 'search' && !name && !contains) {
            return fail('무엇을 찾을지 알려주시면 찾아볼게요.', '파일 이름의 일부나, 안에 들어 있는 말을 알려주세요.');
          }

          const found = []; const skipped = []; let walked = 0; let stopped = false; let readBytes = 0;
          for (const r of where) {
            const w = await walkFiles(r);
            walked += w.walked; stopped = stopped || w.stopped; skipped.push(...w.skipped);
            for (const f of w.files) {
              let info;
              try { info = await stat(f); } catch { continue; }
              if (action === 'recent') { found.push({ path: f, bytes: info.size, modifiedAt: info.mtime.toISOString() }); continue; }
              const nameHit = name ? basename(f).toLowerCase().includes(name) : false;
              let textHit = false;
              // 내용까지 뒤지는 건 사용자가 그걸 물었을 때만. 총량 상한에 걸리면 멈춘 사실을 남긴다.
              if (contains && !nameHit && info.size <= MAX_FILE_SCAN_BYTES && readBytes < MAX_CONTENT_BYTES) {
                try {
                  const t = await readFile(f, 'utf8');
                  readBytes += info.size;
                  textHit = t.toLowerCase().includes(contains);
                } catch { /* 글이 아닌 파일은 건너뛴다 */ }
              } else if (contains && !nameHit && readBytes >= MAX_CONTENT_BYTES) {
                stopped = true;
              }
              if (nameHit || textHit) {
                found.push({ path: f, bytes: info.size, modifiedAt: info.mtime.toISOString(), matched: nameHit ? 'name' : 'text' });
              }
            }
          }

          // recent 는 최근 순, search 는 최근 순(같은 이름이 여럿이면 방금 쓴 게 대개 그거다).
          found.sort((x, y) => (x.modifiedAt < y.modifiedAt ? 1 : -1));
          const limit = Math.min(Number(args.limit) || (action === 'recent' ? 20 : MAX_HITS), MAX_HITS);
          const hits = found.slice(0, limit);
          const more = found.length - hits.length;

          return ok(
            hits.length
              ? `${hits.length}개를 찾았어요${more > 0 ? ` (더 있어요 — ${more}개는 안 보여드렸어요)` : ''}.`
              : '찾는 게 안 보여요.',
            {
              hits, searchedIn: where, walked,
              // **못 본 자리를 밝힌다.** "없다"와 "여기까지만 봤다"는 다른 말이다.
              ...(more > 0 ? { moreHits: more } : {}),
              ...(stopped ? { stoppedAtLimit: true } : {}),
              ...(skipped.length ? { skippedCount: skipped.length } : {}),
            },
          );
        }

        if (action === 'list') {
          const entries = await readdir(abs, { withFileTypes: true });
          const items = entries
            .filter((e) => !e.name.startsWith('.'))
            .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'folder' : 'file' }));
          return ok(
            items.length ? `${items.length}개를 찾았어요.` : '그 폴더는 비어 있어요.',
            { path: abs, items },
          );
        }

        if (action === 'read') {
          const info = await stat(abs);
          if (info.size > MAX_READ_BYTES) {
            return fail('파일이 너무 커서 통째로 읽지 못했어요.', '필요한 부분을 알려주시면 그 부분만 볼게요.');
          }
          const text = await readFile(abs, 'utf8');
          return ok(`${basename(abs)} 을(를) 읽었어요.`, { path: abs, text, bytes: info.size });
        }

        if (action === 'write') {
          const text = String(args.text ?? '');
          if (args.preview) {
            let old = null; try { old = await readFile(abs, 'utf8'); } catch { /* 새 파일 */ }
            return ok(
              old === null ? `${basename(abs)} 을(를) 새로 만들 거예요(아직 안 만들었어요).`
                // **덮어쓰기는 전체를 갈아 끼운다.** 몇 자가 몇 자로 바뀌는지 말해야 사용자가 판단한다.
                : `${basename(abs)} 의 내용 전체를 바꿀 거예요(${old.length}자 → ${text.length}자, 아직 안 바꿨어요).`,
              { path: abs, preview: { overwrite: old !== null, wasChars: old?.length ?? 0, willBeChars: text.length }, applied: false },
            );
          }
          await mkdir(dirname(abs), { recursive: true });
          const parked = await toTrash(abs); // 덮어쓰기면 원본을 휴지통으로(되돌릴 수 있게)
          await writeFile(abs, text, 'utf8');
          if (parked) await pushUndo(undoEntry('write', abs, parked));
          return ok(
            parked ? `${basename(abs)} 을(를) 새 내용으로 저장했어요(이전 내용은 되돌릴 수 있어요).`
              : `${basename(abs)} 을(를) 만들었어요.`,
            { path: abs, bytes: Buffer.byteLength(text), overwritten: Boolean(parked) },
          );
        }

        // ── P6-L4 · 부분 수정 ───────────────────────────────────────────
        // write 는 **파일 전체를 갈아 끼운다.** 한 줄 고치려고 write 를 쓰면 나머지가 사라진다.
        // 그래서 "찾아서 바꾸기"를 따로 둔다. **찾는 글이 없으면 조용히 넘어가지 않는다** —
        // 이 저장소에서 replace 를 assert 없이 써서 하루에 세 번 조용히 실패했다(§CLAUDE.md).
        if (action === 'patch') {
          const find = String(args.find ?? '');
          if (!find) return fail('무엇을 바꿀지 알려주세요.', '바꿀 글과 새 글을 알려주시면 그 부분만 고칠게요.');
          const replace = String(args.replace ?? '');
          let text;
          try { text = await readFile(abs, 'utf8'); }
          catch { return fail(`${basename(abs)} 을(를) 읽지 못했어요.`, '파일 이름이 맞는지 확인해 주시겠어요?'); }

          const count = text.split(find).length - 1;
          if (count === 0) {
            return fail(
              `${basename(abs)} 에서 그 글을 찾지 못해서 **아무것도 바꾸지 않았어요.**`,
              '파일을 먼저 읽어 드릴까요? 그 다음에 정확한 부분을 짚어 주시면 돼요.',
            );
          }
          // 여러 군데면 사용자가 어느 쪽을 뜻했는지 우리가 모른다. 다 바꾸라고 하지 않았으면 멈춘다.
          if (count > 1 && !args.all) {
            return fail(
              `${basename(abs)} 안에 그 글이 ${count}군데 있어서 바꾸지 않았어요.`,
              '전부 바꿀까요, 아니면 앞뒤 문장까지 알려주셔서 한 군데만 짚을까요?',
            );
          }
          const next = args.all ? text.split(find).join(replace) : text.replace(find, replace);
          const changed = { at: count, from: find.length, to: replace.length };
          // 미리보기: 무엇이 바뀌는지 보여주고 **적용하지 않는다**(승인 카드에 실릴 내용).
          if (args.preview) {
            return ok(`${basename(abs)} 에서 ${count}군데를 바꿀 거예요(아직 안 바꿨어요).`,
              { path: abs, preview: { ...changed, before: excerptAround(text, find), after: excerptAround(next, replace || find) }, applied: false });
          }
          const parked = await toTrash(abs); // 원본을 휴지통으로 — 되돌릴 수 있게
          await writeFile(abs, next, 'utf8');
          if (parked) await pushUndo(undoEntry('patch', abs, parked));
          return ok(`${basename(abs)} 에서 ${count}군데를 바꿨어요(되돌릴 수 있어요).`,
            { path: abs, changed, applied: true, recoverable: Boolean(parked) });
        }

        // 이름만 바꾸기. move 로도 되지만 사용자는 "이름 바꿔줘"라고 말하고, 그때 전체 경로를
        // 만들게 하면 모델이 엉뚱한 폴더로 옮긴다(옮기기와 이름 바꾸기는 사용자에게 다른 일이다).
        if (action === 'rename') {
          const name = String(args.to ?? args.name ?? '').trim();
          if (!name) return fail('새 이름을 알려주세요.');
          if (name.includes('/')) {
            return fail('이름에는 폴더 경로를 넣지 않아요.', '다른 폴더로 보내려면 "옮겨줘"라고 말씀해 주세요.');
          }
          return await moveInto(abs, join(dirname(abs), name), { keepSource: false, verb: '이름을 바꿨어요', preview: args.preview });
        }

        if (action === 'copy') {
          const dest = await resolveInScope(args.to ?? '', { roots });
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) return { blocked: true, scopeState: 'protected', ...protectionMessage(destProt, { write: true }) };
          return await moveInto(abs, dest, { keepSource: true, verb: '복사했어요', preview: args.preview });
        }

        if (action === 'move') {
          const dest = await resolveInScope(args.to ?? '', { roots });
          // 목적지도 본다 — 보호 영역으로 **옮겨 넣는 것**도 변경이다.
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) {
            const msg = protectionMessage(destProt, { write: true });
            return { blocked: true, scopeState: 'protected', ...msg };
          }
          // **조용한 덮어쓰기 금지**(P0-1b)는 moveInto 에 모아 뒀다 — 옮기기·복사·이름 바꾸기가
          // 같은 손실 경로를 공유하므로, 두 벌로 두면 한쪽만 고쳐진다(undo 로 샜던 그 일).
          return await moveInto(abs, dest, { keepSource: false, verb: '옮겼어요', preview: args.preview });
        }

        if (action === 'delete') {
          if (args.preview) {
            let info; try { info = await stat(abs); } catch { return fail(`${basename(abs)} 을(를) 찾지 못했어요.`); }
            return ok(`${basename(abs)} 을(를) 휴지통으로 보낼 거예요(아직 안 지웠어요).`,
              { path: abs, preview: { bytes: info.size, kind: info.isDirectory() ? 'folder' : 'file' }, applied: false, recoverable: true });
          }
          const parked = await toTrash(abs);
          if (!parked) return fail(`${basename(abs)} 을(를) 찾지 못했어요.`);
          await pushUndo(undoEntry('delete', abs, parked));
          return ok(`${basename(abs)} 을(를) 지웠어요(되돌릴 수 있어요).`, { path: abs, recoverable: true });
        }

        return fail(`'${action}' 은(는) 제가 할 수 있는 파일 작업이 아니에요.`, '보기·찾기·최근 파일·읽기·저장·부분 수정·이름 바꾸기·복사·옮기기·지우기·되돌리기가 가능해요.');
      } catch (e) {
        return failureOf(e, target);
      }
    },
  };
}
