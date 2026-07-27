// L3 · 작업 대상 찾기 (P6-W2) — **사용자는 경로를 말하지 않는다.**
//
// "정산 자료 봐줘", "계약서 찾아줘", "이 프로젝트 테스트 돌려봐".
// W1 이 최근에 다룬 자리를 사실로 주지만, 대화에 **한 번도 안 나온** 대상은 그것으로 못 찾는다.
//
// terminal 의 `find` 로 안 되는 이유는 실측에 있다: 모델이 짠 `find ~ | head -20` 이
// 닷폴더에 밀려 잘렸다. 필요한 건 탐색이 아니라 **랭킹과 근거**다 —
// 후보 몇 개와 "왜 이게 후보인지"를 짧게 주면 고르는 건 모델이 한다(§24).
//
// **코드 프로젝트만 찾는 도구가 아니다.** T5 사용자의 작업 대상은 정산 엑셀·계약서 pdf·
// 원고 폴더·디자인 시안일 때가 더 많다. 두 갈래 표식을 같은 무게로 본다.
import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { protectionFor } from './local-protection.js';

const MAX_CANDIDATES = 5;
const MAX_DIRS = 4000;        // 한 번에 들여다볼 폴더 수(넘으면 멈추고 그 사실을 남긴다)
const MAX_ENTRIES_PER_DIR = 400;

/** 들어가지 않는 자리. 사용자의 자료가 아니라 도구·OS 가 만든 더미다. */
const SKIP = new Set([
  'node_modules', 'Library', 'Applications', '.Trash', 'venv', '.venv',
  '__pycache__', 'dist', 'build', 'target', 'vendor', 'Pods', '.git',
]);

/** 코드 작업 자리의 표식. 있으면 거의 확실하다. */
const PROJECT_MARKS = new Set([
  '.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml',
  'build.gradle', 'Gemfile', 'composer.json', 'Makefile', 'CMakeLists.txt', 'README.md',
]);

/** 업무 자료의 표식 — 확장자로 본다. **T5 사용자에게는 이쪽이 더 흔하다.** */
const DOC_EXT = /\.(xlsx?|xlsm|csv|pdf|docx?|hwpx?|pptx?|numbers|pages|key)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|svg|ai|psd|sketch|fig)$/i;
const TEXT_EXT = /\.(md|txt|rtf)$/i;

/** 사람이 부른 말을 낱말로. "정산 자료 봐줘" → [정산, 자료] */
function 낱말(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[\s,./\\_-]+/)
    .map((w) => w.replace(/(자료|파일|폴더|봐줘|찾아줘|정리해줘|열어줘|보여줘)$/g, ''))
    .filter((w) => w.length >= 2);
}

/** 폴더 하나가 무엇으로 보이는가. **파일을 열지 않는다** — 이름과 개수만 본다. */
function 성격(entries) {
  const counts = { doc: 0, image: 0, text: 0, code: 0, mark: 0 };
  for (const e of entries) {
    if (PROJECT_MARKS.has(e.name)) counts.mark += 1;
    else if (DOC_EXT.test(e.name)) counts.doc += 1;
    else if (IMAGE_EXT.test(e.name)) counts.image += 1;
    else if (TEXT_EXT.test(e.name)) counts.text += 1;
    else if (/\.(js|ts|jsx|tsx|py|go|rs|java|rb|php|c|cpp|swift|kt)$/i.test(e.name)) counts.code += 1;
  }
  if (counts.mark > 0 || counts.code >= 3) return { kind: 'project', counts };
  if (counts.doc >= 2) return { kind: 'documents', counts };
  if (counts.image >= 3) return { kind: 'images', counts };
  if (counts.text >= 3) return { kind: 'notes', counts };
  return { kind: undefined, counts };
}

const 종류이름 = { project: '작업 프로젝트', documents: '문서·자료', images: '이미지', notes: '글' };

/**
 * 사용자가 종류를 직접 부를 때가 있다 — "이 **프로젝트**", "그 **문서**", "**사진** 정리해줘".
 * 이름이 안 맞아도 종류가 맞으면 후보로 볼 근거가 된다. 목록이 아니라 **부르는 말과 종류의 대응**이다.
 */
const 종류말 = [
  [/프로젝트|프로젝|코드|개발|레포|repo|project/i, 'project'],
  [/문서|자료|서류|파일들|doc/i, 'documents'],
  [/사진|이미지|시안|디자인|image|photo/i, 'images'],
  [/글|원고|메모|노트|note/i, 'notes'],
];
const 부른종류 = (말) => 종류말.find(([re]) => re.test(말))?.[1];

/** 왜 이게 후보인지 사람 말로. 근거 없는 후보는 사용자가 고를 수 없다. */
function 근거(성, 이름맞음, 최근일) {
  const 조각 = [];
  if (이름맞음) 조각.push('이름이 맞아요');
  const c = 성.counts;
  if (성.kind === 'project') 조각.push(c.mark > 0 ? '작업 폴더 표식이 있어요' : `코드 파일 ${c.code}개`);
  if (성.kind === 'documents') 조각.push(`문서 ${c.doc}개`);
  if (성.kind === 'images') 조각.push(`이미지 ${c.image}개`);
  if (성.kind === 'notes') 조각.push(`글 ${c.text}개`);
  if (최근일 != null) {
    조각.push(최근일 === 0 ? '오늘 고쳤어요' : 최근일 <= 7 ? `${최근일}일 전에 고쳤어요` : `${Math.round(최근일 / 30)}달 전`);
  }
  return 조각.join(' · ');
}

/**
 * 지금 이 컴퓨터에서 **볼 수 있는 자리들.** 사용자에게 경로를 물어보는 대신 이걸 보여준다.
 *
 * 실측(라이브): "폴더를 어떻게 알려주면 돼?"에 T5 가 "Finder 우클릭 → Option → 경로명 복사 →
 * 붙여넣기"라고 답했다. 터미널 떠넘김의 GUI 판이다. 사용자는 경로를 모르고, 알 필요도 없다 —
 * **부르는 이름으로 고를 수 있어야 한다**("외장하드요", "다운로드요").
 */
async function 볼수있는자리(home, volumesDir = '/Volumes') {
  const 자리 = [];
  try {
    for (const name of await readdir(volumesDir)) {
      if (name.startsWith('.')) continue;
      const full = join(volumesDir, name);
      // 시스템 디스크는 "다른 자리"로 제안할 대상이 아니다(홈이 이미 거기 있다).
      if (/^Macintosh HD$/i.test(name)) continue;
      자리.push({ label: name, path: full, kind: 'volume', hint: '연결된 디스크' });
    }
  } catch { /* 볼륨을 못 보면 그냥 안 넣는다 */ }
  try {
    for (const e of await readdir(home, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      자리.push({ label: e.name, path: join(home, e.name), kind: 'folder', hint: '내 폴더' });
    }
  } catch { /* 홈을 못 보면 넣지 않는다 */ }
  return 자리.slice(0, 14); // 목록이 길면 고르기 어렵다
}

/** 경로를 복사해 오라고 하지 않는다. 이름으로 고르게 한다. */
const 이름으로골라 = '어느 자리에 있는지 이름으로 알려주시면(예: 외장하드, 다운로드) 거기서 찾아볼게요.';

/**
 * 모델이 준 `from` 을 **실제 자리로 승계한다.**
 *
 * 라이브 실측(2026-07-27): 사용자가 "작업용SSD"라고 답하자 모델은 `from: "작업용SSD"` 를 골랐다.
 * **모델은 옳게 골랐다** — 화면에 나가는 "볼 수 있는 자리"가 이름만 싣기 때문이다(경로를 늘어놓으면
 * 프롬프트를 먹는다). 그런데 여기서 그 이름을 폴더 경로로 그대로 써서 아무 데도 못 봤다.
 * 이름만 준 쪽이 우리이므로 **이름을 자리로 바꾸는 것도 우리 일이다.**
 *
 * 모르는 이름을 홈으로 바꿔치기하지 않는다 — 그러면 홈을 뒤진 결과를 그 자리 결과인 척 말하게 된다.
 * @returns {{path?:string, name?:string, unknown?:string}}
 */
function 자리로(from, 자리들, home) {
  // 빈 칸은 없는 칸이다 — 모델은 안 쓰는 인자도 `''` 로 채워 보낸다(같은 실수를 세 번 했다).
  const 말 = typeof from === 'string' ? from.trim() : '';
  if (!말) return { path: home };
  if (말 === '~') return { path: home };
  if (말.startsWith('~/')) return { path: join(home, 말.slice(2)) };
  // 경로를 준 것을 이름으로 다시 해석하지 않는다(모델·스킬이 정확히 짚었을 때 가로채면 안 된다).
  if (말.startsWith('/')) return { path: 말 };
  const 맞음 = 자리들.find((p) => p.label.toLowerCase() === 말.toLowerCase());
  return 맞음 ? { path: 맞음.path, name: 맞음.label } : { unknown: 말 };
}

/**
 * @param {{home?:string, volumesDir?:string}} [deps] 주입할 수 있어야 가짜 홈으로 검사할 수 있다
 *   (특정 사용자 경로를 하드코딩하면 그 순간 게이트에서 걸린다).
 */
export function makeLocalLocateTool(deps = {}) {
  const homeOf = () => deps.home ?? homedir();

  return {
    /**
     * 지금 볼 수 있는 자리. **도구를 부르지 않아도** 매 턴 모델에게 사실로 간다 —
     * 실측: "폴더를 어떻게 알려주면 돼?"에 모델이 도구를 안 부르고 답했고(원장 0건),
     * 그래서 자리 목록을 못 봤다. 도구 결과로는 못 푸는 자리였다.
     */
    async places() { return 볼수있는자리(homeOf(), deps.volumesDir); },
    async handler(args = {}) {
      const 말 = String(args.what ?? args.query ?? args.request ?? '').trim();
      // 한 번만 읽고 두 곳(이름 승계·placesToLook)에서 같이 쓴다 — 모델이 본 이름과
      // 우리가 푸는 이름이 **같은 목록**에서 나와야 한다(두 진실 금지).
      let 자리캐시;
      const 자리목록 = async () => (자리캐시 ??= await 볼수있는자리(homeOf(), deps.volumesDir));
      const 고른자리 = 자리로(args.from, await 자리목록(), homeOf());
      // 모르는 이름이면 **찾지 않는다.** 엉뚱한 자리를 뒤지고 "못 찾았다"고 하면, 사용자는
      // 자료가 없는 줄 알지만 사실은 우리가 그 자리를 못 연 것이다(다른 사실이다).
      if (고른자리.unknown) {
        return {
          result: {
            candidates: [],
            searched: { from: null, folders: 0 },
            unknownPlace: 고른자리.unknown,
            placesToLook: await 자리목록(),
          },
          userSafeSummary: `"${고른자리.unknown}"라는 자리는 지금 안 보여요.`,
          nextSafeAction: 이름으로골라,
        };
      }
      const from = 고른자리.path;
      const depth = Math.min(Math.max(Number(args.depth) || 3, 1), 5);
      const 낱말들 = 낱말(말);
      const 찾는종류 = 부른종류(말);

      const 후보 = [];
      let 본폴더 = 0; let 멈춤 = false; const 안본자리 = [];
      const 대기 = [{ dir: from, d: 0 }];
      const 지금 = Date.now();

      while (대기.length) {
        const { dir, d } = 대기.shift();
        if (본폴더 >= MAX_DIRS) { 멈춤 = true; break; }
        let entries;
        try { entries = (await readdir(dir, { withFileTypes: true })).slice(0, MAX_ENTRIES_PER_DIR); }
        catch { continue; }
        본폴더 += 1;

        const 성 = 성격(entries);
        const 이름 = basename(dir).toLowerCase();
        const 이름맞음 = 낱말들.length > 0 && 낱말들.some((w) => 이름.includes(w));

        if (d > 0 && (성.kind || 이름맞음)) {
          let 최근일;
          try { 최근일 = Math.floor((지금 - (await stat(dir)).mtimeMs) / 86_400_000); } catch { /* 못 보면 안 쓴다 */ }
          후보.push({
            path: dir,
            kind: 성.kind ?? 'folder',
            kindLabel: 종류이름[성.kind] ?? '폴더',
            why: 근거(성, 이름맞음, 최근일),
            // 확신도: 이름이 맞고 성격도 맞으면 높다. 성격만이면 낮다 — 모델이 이걸 보고 묻는다.
            // 이름이 맞으면 높다. 이름 대신 **부른 종류**가 맞아도 볼 만하다.
            // 둘 다 아니면 그냥 "이런 자리도 있다"일 뿐이라 낮게 둔다(모델이 이걸 보고 묻는다).
            confidence: 이름맞음 && 성.kind ? 'high'
              : 이름맞음 ? 'medium'
                : (찾는종류 && 성.kind === 찾는종류) ? 'medium' : 'low',
            modifiedDaysAgo: 최근일,
            counts: 성.counts,
          });
        }

        if (d >= depth) continue;
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
          const full = join(dir, e.name);
          // 보호 영역은 후보로도 올리지 않는다 — 열어 볼 자리가 아니다.
          if (protectionFor(full)) { 안본자리.push(full); continue; }
          대기.push({ dir: full, d: d + 1 });
        }
      }

      // 확신도 → 최근 수정 순. "아까 그거"는 대개 방금 고친 것이다.
      const 순서 = { high: 0, medium: 1, low: 2 };
      후보.sort((a, b) => (순서[a.confidence] - 순서[b.confidence])
        || ((a.modifiedDaysAgo ?? 9999) - (b.modifiedDaysAgo ?? 9999)));
      // **못 찾은 것을 찾은 척하지 않는다.** 사용자가 뭔가를 특정해서 물었는데 이름도 종류도
      // 안 맞으면, 낮은 후보를 잔뜩 늘어놓는 건 "찾았다"는 오해만 만든다(실측: "포토샵 파일"에
      // 무관한 폴더 셋이 나왔다). 그럴 땐 몇 개만 곁들이고 못 찾았다고 말한다.
      const 짚었나 = 후보.some((c) => c.confidence !== 'low');
      const 물었나 = 낱말들.length > 0 || Boolean(찾는종류);
      const 고른것 = 후보.slice(0, 물었나 && !짚었나 ? 2 : MAX_CANDIDATES);

      return {
        result: {
          candidates: 고른것,
          // 어느 이름을 어느 자리로 읽었는지 함께 남긴다 — 나중에 "왜 거기를 봤나"를 따질 수 있어야 한다.
          searched: { from, ...(고른자리.name ? { fromName: 고른자리.name } : {}), depth, folders: 본폴더 },
          ...(후보.length > 고른것.length ? { moreCandidates: 후보.length - 고른것.length } : {}),
          // 못 찾았으면 **넓힐 수 있다는 사실**을 준다 — 모델이 다시 부를 근거가 된다.
          ...(고른것.length === 0 ? { canWiden: depth < 5, suggestDepth: Math.min(depth + 2, 5) } : {}),
          // 못 찾았으면 **어디를 더 볼 수 있는지**를 준다. 이게 없으면 모델이 사용자에게
          // 경로를 복사해 오라고 시킨다(실측). 사용자는 "외장하드요"라고 부를 수 있으면 된다.
          ...(고른것.length === 0 || (물었나 && !짚었나)
            ? { placesToLook: await 자리목록() } : {}),
          ...(멈춤 ? { stoppedAtLimit: true } : {}),
          ...(안본자리.length ? { skippedProtected: 안본자리.length } : {}),
        },
        userSafeSummary: 고른것.length === 0
          ? (말 ? `"${말}"에 해당하는 자리를 못 찾았어요.` : '찾을 대상을 알려주시면 찾아볼게요.')
          : (물었나 && !짚었나)
            ? `"${말}"에 딱 맞는 자리는 못 찾았어요. 근처에 이런 자리는 있어요.`
            : 고른것.length === 1
            ? `${고른것[0].path} 인 것 같아요 (${고른것[0].why}).`
            : `${고른것.length}곳이 후보예요.`,
        ...(고른것.length === 0 || (물었나 && !짚었나) ? { nextSafeAction: 이름으로골라 } : {}),
      };
    },
  };
}
