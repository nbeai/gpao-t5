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
import { protectionBlocks, protectionMessage } from './local-protection.js';

const MAX_READ_BYTES = 1_000_000; // 너무 큰 파일은 통째로 읽지 않는다(메모리·프롬프트 보호)

/** 되돌리기 표 한 줄. 휴지통 경로와 원래 자리를 함께 남긴다. */
function undoEntry(op, from, to) {
  return { id: randomUUID(), op, from, to, at: new Date().toISOString() };
}

/**
 * @param {{roots?:string[], trashDir?:string, dataDir?:string}} [deps]
 */
export function makeLocalFileTool(deps = {}) {
  const roots = deps.roots ?? defaultFileRoots();
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
    /** 방금 다룬 파일이 다음 턴의 대상이다("그거 정리해줘"가 이어진다). */
    subjectOf(rec) {
      const path = rec?.result?.path ?? rec?.actualCall?.args?.path;
      return path ? { key: `file:${path}`, kind: 'file', label: String(path) } : null;
    },
    async handler(args = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      const target = args.path ?? '.';
      try {
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
        const writes = action !== 'list' && action !== 'read';
        const prot = protectionBlocks(abs, { write: writes });
        if (prot) {
          const msg = protectionMessage(prot, { write: writes });
          return { blocked: true, scopeState: 'protected', ...msg };
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

        if (action === 'move') {
          const dest = await resolveInScope(args.to ?? '', { roots });
          // 목적지도 본다 — 보호 영역으로 **옮겨 넣는 것**도 변경이다.
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) {
            const msg = protectionMessage(destProt, { write: true });
            return { blocked: true, scopeState: 'protected', ...msg };
          }
          // **조용한 덮어쓰기 금지**(P0-1b): 대상이 이미 있으면 막고 확인을 요구한다.
          // copyFile 은 대상을 말없이 덮어쓰는데, 그러면 undo(대상→원본)로도 대상의 원래 내용은
          // 영영 사라진다 — 되돌릴 수 없는 손실이다. write 는 휴지통 백업이 있는데 move 만 빠져 있었다.
          let destExists = false;
          try { await stat(dest); destExists = true; } catch { /* 없으면 진행 */ }
          if (destExists) {
            return fail(
              `${basename(dest)} 이(가) 이미 있어서 옮기지 않았어요(덮어쓰면 되돌릴 수 없어요).`,
              '다른 이름으로 옮기거나, 기존 파일을 먼저 지울까요?',
            );
          }
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(abs, dest);
          await rm(abs);
          await pushUndo(undoEntry('move', abs, dest));
          return ok(`${basename(abs)} 을(를) ${basename(dest)} 로 옮겼어요.`, { from: abs, to: dest });
        }

        if (action === 'delete') {
          const parked = await toTrash(abs);
          if (!parked) return fail(`${basename(abs)} 을(를) 찾지 못했어요.`);
          await pushUndo(undoEntry('delete', abs, parked));
          return ok(`${basename(abs)} 을(를) 지웠어요(되돌릴 수 있어요).`, { path: abs, recoverable: true });
        }

        return fail(`'${action}' 은(는) 제가 할 수 있는 파일 작업이 아니에요.`, '보기·읽기·저장·옮기기·지우기·되돌리기가 가능해요.');
      } catch (e) {
        return failureOf(e, target);
      }
    },
  };
}
