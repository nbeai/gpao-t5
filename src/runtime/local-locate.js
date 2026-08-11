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
import { execFile } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, basename, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { protectionFor } from './local-protection.js';

const exec = promisify(execFile);
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

/** 사람이 부른 말을 낱말로. "정산 자료 봐줘" → [정산, 자료]. NFC 로 맞춘다(디스크는 NFD 일 수 있다). */
function 낱말(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s,./\\_-]+/)
    .map((w) => w.replace(/(자료|파일|폴더|봐줘|찾아줘|정리해줘|열어줘|보여줘)$/g, ''))
    .filter((w) => w.length >= 2);
}

/**
 * **확장자는 낱말이 아니다** — S3(2026-08-05).
 *
 * 라이브 사고: 사용자가 `YOON.md` 를 찾자 `낱말()` 이 `["yoon","md"]` 를 만들고
 * `.some(포함)` 이 `md` 로 **모든 `.md` 파일**을 잡았다. 무관한 다섯 개가
 * `why:"이름이 맞아요" · confidence:"high"` 로 돌아갔다. `계약서.pdf` 도 같다 —
 * 모든 PDF 가 "이름이 맞아요"가 된다. **커널이 프로세스에게 거짓말한 것이다.**
 *
 * 목록을 늘리지 않는다(§4-6). 구조로 가른다:
 * 부른 말이 `이름.확장자` 꼴이면 **확장자는 이름의 일부이지 독립된 낱말이 아니다.**
 * 다만 사용자가 확장자 **자체**를 물으면("pdf 파일 찾아줘") 그건 확장자 질문이므로 그대로 둔다.
 * 가르는 기준은 문구가 아니라 **꼴**이다: 앞에 이름이 붙어 있는가.
 */
function 이름낱말(말) {
  const 전부 = 낱말(말);
  const 원문 = String(말 ?? '').normalize('NFC').toLowerCase();
  // `이름.확장자` 꼴이 원문에 있으면, 그 확장자는 **그 이름에 딸린 것**이다.
  const 딸린확장자 = new Set();
  for (const m of 원문.matchAll(/([^\s,/\\]+)\.([a-z0-9]{1,8})(?![a-z0-9])/g)) {
    if (m[1] && m[1].length >= 1) 딸린확장자.add(m[2]);
  }
  if (!딸린확장자.size) return 전부;
  const 남은것 = 전부.filter((w) => !딸린확장자.has(w));
  // 확장자를 빼고 나면 아무것도 안 남는 경우(`.md` 만 부른 것)는 원래 목록을 쓴다 —
  // 그때는 정말 확장자를 물은 것이다.
  return 남은것.length ? 남은것 : 전부;
}

/** 이름이 부른 낱말과 맞는가. 디스크의 NFD 와 사용자의 NFC 를 같은 글자로 읽는다. */
/**
 * 이 이름이 부른 말과 **어떻게** 맞는가. 예전엔 둘(맞음/아님)이었는데 실제로는 셋이다.
 *
 * 라이브 사고(오너 2026-08-05): `지침.md` 를 찾자
 * `《Mixtral 8x7B 최적화형 존재 프롬프트 설계 지침》.md` 가 **"이름이 맞아요 · high"** 로
 * 돌아왔고, 모델이 그걸 답으로 삼아 열어 읽었다. 그 파일 이름은 `지침.md` 가 아니다 —
 * `지침` 이라는 낱말을 **품고 있을** 뿐이다.
 *
 * 이 파일 53줄이 같은 병을 이미 적어 뒀다("모든 PDF 가 '이름이 맞아요'가 된다 —
 * 커널이 프로세스에게 거짓말한 것이다"). 그때는 **입력 쪽**(확장자를 낱말로 만들지 않기)만
 * 고쳤다. 판정 쪽은 `.includes` 하나였고, 그래서 같은 매듭이 두 번째 얼굴로 돌아왔다.
 *
 * 목록을 늘리지 않는다(§4-6). **확신의 등급을 나눈다:**
 *   `exact`   부른 말이 곧 그 이름이다(확장자가 있든 없든) → 답이다
 *   `partial` 부른 낱말이 이름 안에 있다                    → 후보다
 *   `null`    아니다
 * @returns {'exact'|'partial'|null}
 */
function 이름맞음종류(name, 부른말, 낱말들) {
  const 이름 = String(name).normalize('NFC').toLowerCase().trim();
  const 말 = String(부른말 ?? '').normalize('NFC').toLowerCase().trim();
  if (말 && 이름 === 말) return 'exact';
  // `지침` 으로 불러도 `지침.md` 는 그 파일이다 — 확장자는 이름의 일부이지 다른 이름이 아니다.
  if (말 && 이름.replace(/\.[a-z0-9]{1,8}$/, '') === 말) return 'exact';
  return 낱말들.length > 0 && 낱말들.some((w) => 이름.includes(w)) ? 'partial' : null;
}

/** 부른 말이 **파일 이름 꼴**인가(`이름.확장자`). 그러면 폴더는 그 이름일 수 없다. */
function 파일이름꼴(부른말) {
  return /[^\s,/\\]+\.[a-z0-9]{1,8}$/i.test(String(부른말 ?? '').trim());
}

/**
 * 수정 시각을 사람 말로. 후보의 "왜"에 붙는다.
 * H08 실측(2026-08-01): 하루 단위로만 말하면 같은 날 파일들이 전부 "오늘 고쳤어요"가 되어
 * 모델 앞의 유일한 판별 신호가 이름('최종')만 남는다 — "방금 받은"의 방금은 분 단위 사실이다.
 * @param {number} [최근일] @param {number} [mtimeMs]
 */
function 시각말(최근일, mtimeMs) {
  if (최근일 == null) return undefined;
  if (최근일 === 0 && mtimeMs) {
    const 분 = Math.max(1, Math.round((Date.now() - mtimeMs) / 60_000));
    if (분 < 60) return `${분}분 전에 고쳤어요`;
    return `${Math.round(분 / 60)}시간 전에 고쳤어요`;
  }
  return 최근일 === 0 ? '오늘 고쳤어요' : 최근일 <= 7 ? `${최근일}일 전에 고쳤어요` : `${Math.round(최근일 / 30)}달 전`;
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

/**
 * **형식으로도 찾는다** (콘솔 라이브 2026-08-12 · 오너 지시 「특화된 집게가 아니라 진짜 손」).
 *
 * 밟은 회차: *"내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘."* →
 * 이 손이 **이름으로만** 후보를 올려 `엑셀` 이라는 이름의 파일이 없으니 후보 0을 냈고,
 * 모델이 캡슐로 직접 훑다 Desktop·Documents·Downloads 셋만 보고
 * *"이 컴퓨터에는 엑셀 형식 파일이 없다"* 고 단정했다. 실제 파일은 `~/GPAO-T5/…/…xlsx` 였다.
 * **손이 못 하니 모델이 임시로 만들었고, 임시로 만든 것은 범위를 틀렸다.**
 *
 * 새 표를 발명하지 않는다 — 위 `DOC_EXT`·`IMAGE_EXT`·`TEXT_EXT` 가 이미 형식을 알고,
 * `표준폴더말`(다운로드→Downloads)이 「부르는 말 → 기계 값」 대응의 선례다. 같은 결로
 * **부르는 말 → 확장자**만 잇는다. 판정(무엇이 참인가)에 쓰는 문구 그물이 아니라
 * **질의 어휘**다 — 사용자가 그 형식을 뭐라고 부르는지는 우리가 정할 수 없는 사실이다.
 */
/**
 * **확장자 목록이 정본이고 자는 거기서 나온다**(2026-08-12).
 *
 * 예전엔 칸이 정규식 하나였다. 아래 「세는 자」가 OS 색인에 물어보려면 같은 형식의
 * **낱개 확장자**가 필요한데, 정규식(`/\.(xlsx?|xlsm|xlsb)$/`)에서 그걸 되꺼낼 수는 없다.
 * 그렇다고 색인용 표를 따로 두면 **두 벌 목록**이 되어 언젠가 벌어진다(§4-6).
 * 그래서 목록을 정본으로 두고 정규식을 거기서 만든다 — 자는 하나뿐이다.
 */
const 형식말 = [
  [/엑셀|excel|스프레드시트|xlsx?|xlsm/i, ['xlsx', 'xls', 'xlsm', 'xlsb']],
  [/pdf|피디에프/i, ['pdf']],
  [/워드|word|docx?/i, ['docx', 'doc']],
  [/한글\s*파일|hwpx?|아래아/i, ['hwpx', 'hwp']],
  [/파워포인트|ppt|프레젠테이션|슬라이드/i, ['pptx', 'ppt']],
  [/csv|씨에스브이/i, ['csv']],
  [/텍스트\s*파일|txt|메모장/i, ['txt', 'rtf']],
  [/마크다운|markdown|\.md\b/i, ['md']],
];
/** 확장자 목록 → 이름을 재는 자. 예전 정규식과 정확히 같은 것을 만든다. */
const 확장자자 = (확장자들) => new RegExp(`\\.(${확장자들.join('|')})$`, 'i');
/**
 * 부른 말이 형식을 가리키면 그 확장자 자. 아니면 null — 없는 자를 지어내지 않는다.
 *
 * **`이름.확장자` 꼴은 형식 질의가 아니다.** 「존재하지않는이름.md」는 *그 파일*을 부른
 * 것이지 「.md 전부」를 부른 것이 아니다 — 그렇게 읽으면 없는 파일을 물었는데 남의 파일이
 * 후보로 선다(검사 `s3-locate-honest ⑥` 가 그것을 문다). 위 `이름낱말()` 이 같은 꼴을
 * 이미 가르고 있다: **앞에 이름이 붙어 있는가**가 기준이고, 여기서도 같은 자를 쓴다.
 */
const 부른형식 = (말) => {
  const 원문 = String(말 ?? '');
  if (/[^\s,/\\]+\.[a-z0-9]{1,8}(?![a-z0-9])/i.test(원문)) return null;   // 이름에 딸린 확장자
  const 확장자들 = 형식말.find(([re]) => re.test(원문))?.[1];
  return 확장자들 ? { 자: 확장자자(확장자들), 확장자: 확장자들 } : null;
};

// ── **형식 질의는 「어느 것?」이 아니라 「있어? 몇 개? 어디?」다** (라이브 6회차 · 2026-08-12) ──
//
// `MAX_CANDIDATES = 5` 는 **고르기 자**다. "정산 자료 봐줘"에는 맞다 — 다섯을 보여 주면
// 고르는 건 모델이 한다(§24). 그런데 사용자가 **형식**으로 부를 때 묻는 것은 고르기가 아니다:
//   ⑤ "문서 폴더에 텍스트 파일" → 5칸을 다 쓴 목록을 「이렇게 있어요」로 냈다(빠뜨렸다).
//   ⑥ "내 컴퓨터에 텍스트 파일" → 5칸이 Downloads 로 차자 *"**전부** 다운로드 안에"* 라고 답했다.
//   ④ "내 컴퓨터에 PDF"        → 손이 못 세니 모델이 캡슐로 직접 훑다 예산에서 죽었다.
// 셋은 결함 셋이 아니라 **하나**다 — 세기 질문에 고르기 자를 댔다.
//
// **새 손도 새 갈래도 만들지 않는다.** 형식 갈래(`부른형식`)는 이미 서 있다. 그 갈래가
// 쥔 자만 바꾼다.

/** 걸음이 못 들어가는 자리인가. 위 `SKIP` 과 **같은 목록**을 경로 조각에 적용한다(두 벌 금지). */
const 건너뛴자리 = (path, from) =>
  String(path).slice(String(from).length).split(sep).some((칸) => SKIP.has(칸));

/**
 * **OS 색인에 한 번 물어본다** — §14 「더한다」에 등재된 항목이다:
 *   `design/T5-STATE-MAP-ko.md:517` — *"OS 색인 활용 | mdfind 사용 0(613줄 자체 구현) |
 *   비교군은 OS 도구를 그대로 | 더한다"*
 * 클로드코드(나)는 "내 컴퓨터에 PDF 있어?"에 디렉터리를 재귀로 걷지 않는다. 색인을 한 번
 * 부르고 전수를 센다. 걸음은 `depth`(기본 3)에 갇혀 있어서 ⑥의 「전부」가 나왔다.
 *
 * **자 고르기는 실측으로 정했다**(실물 홈 `~/Downloads` 실제 `.pdf` = 87):
 *   `kMDItemFSName == '*.pdf'c`             →  14  ← **점이 토크나이저를 깬다. 쓰면 안 된다**
 *                                                  (이름에 빈칸이 있는 파일이 통째로 빠진다)
 *   `mdfind -name '.pdf'`                   →  85  ← 2개 놓침
 *   `kMDItemContentType == 'com.adobe.pdf'` →  87  = 정확하나 **UTI 표**를 새로 들여야 한다
 *   `kMDItemFSName == '*pdf'c`              →  87  = 정확, **표가 필요 없다** ← 이걸 쓴다
 *
 * 점을 뺀 꼴은 상위집합이라 `…/skills/xlsx` 같은 **폴더**도 걸린다. 그건 위 `확장자자`
 * 로 거른다 — **색인은 자가 아니라 닿는 범위**다. 무엇이 그 형식인지는 우리가 판정한다.
 *
 * 바깥 프로세스 규율은 `document-intake.js:36-44` 선례 그대로다(절대 경로 · `timeout` ·
 * `maxBuffer`). 매달리면 턴이 죽으므로 **어떤 실패든 `null`** 이고, 그러면 걸음으로 되돌아간다.
 * macOS 가 아니면 `ENOENT` 로 여기서 끝난다 — 그것도 `null` 이다.
 */
const 색인시간제한 = 4_000;
const 색인최대바이트 = 4_000_000;
async function 색인에물어보기(from, 확장자들) {
  const 질의 = 확장자들.map((e) => `kMDItemFSName == '*${e}'c`).join(' || ');
  const { stdout } = await exec('/usr/bin/mdfind', ['-onlyin', from, 질의], {
    encoding: 'utf8', timeout: 색인시간제한, maxBuffer: 색인최대바이트,
  });
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 왜 이게 후보인지 사람 말로. 근거 없는 후보는 사용자가 고를 수 없다. */
function 근거(성, 이름맞음, 최근일, 요청에서부름 = false, 기간) {
  const 조각 = [];
  if (요청에서부름) 조각.push('이번 요청에서 이름을 직접 부른 폴더예요');
  if (이름맞음) 조각.push('이름이 맞아요');
  const c = 성.counts;
  if (성.kind === 'project') 조각.push(c.mark > 0 ? '작업 폴더 표식이 있어요' : `코드 파일 ${c.code}개`);
  if (성.kind === 'documents') 조각.push(`문서 ${c.doc}개`);
  // **몇 월 자료인지는 이름보다 강한 근거다** — "지난달"·"이번 달"을 그걸로 고른다.
  if (기간) 조각.push(`${기간} 자료예요`);
  if (성.kind === 'images') 조각.push(`이미지 ${c.image}개`);
  if (성.kind === 'notes') 조각.push(`글 ${c.text}개`);
  const 시각 = 시각말(최근일);
  if (시각) 조각.push(시각);
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
      // **자리에 내용 사실을 동봉한다**(F-54 ③ 완성 · PM 판정 2026-08-09). 이 병 계열에서
      // 행동을 움직인 재료는 언제나 **내용**이었다 — ⑤를 살린 건 이웃 파일의 존재가 아니라
      // 그 합계였고, 파일-먼저 흐름을 끌던 것도 이 파일의 힌트("2026-08 자료예요")였다.
      // 이름 9개는 화면에 이미 떠 있는 완성된 답과 싸울 수 없다.
      // **새 계산은 없다** — 이 파일이 이미 세는 자(성격·자료기간)를 명부에도 적용할 뿐이다.
      // 못 읽은 폴더는 이름만 남는다(없는 사실을 지어내지 않는다).
      let 사실;
      try {
        const 안 = await readdir(join(home, e.name), { withFileTypes: true });
        // 자 사용법은 locate 의 후보 스캔과 **한 벌**이다(450행) — 전체 항목 이름을 넘긴다.
        // 파일만 넘기면 날짜를 품은 하위 폴더 이름("2026-08 정산")이 빠져 사실이 빈다(실측).
        const 이름들 = 안.map((x) => x.name);
        const 성 = 성격(안.map((x) => ({ name: x.name })));
        const 기간 = 자료기간(e.name, 이름들);
        const 조각 = [];
        if (기간) 조각.push(`${기간} 자료`);
        if (성.kind === 'documents') 조각.push(`문서 ${성.counts.doc}`);
        else if (성.kind && 종류이름[성.kind]) 조각.push(종류이름[성.kind]);
        if (조각.length) 사실 = 조각.join(' · ');
      } catch { /* 폴더를 못 읽으면 이름만 — 지어내지 않는다 */ }
      자리.push({ label: e.name, path: join(home, e.name), kind: 'folder', hint: '내 폴더', ...(사실 ? { 사실 } : {}) });
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
  // 사용자·모델은 홈을 "홈"이라고 부른다(H08 실측: from='홈' 이 모르는 자리로 떨어져 걸음 낭비).
  if (/^(홈|홈\s*폴더|home)$/i.test(말)) return { path: home };
  if (말.startsWith('~/')) return { path: join(home, 말.slice(2)) };
  // 경로를 준 것을 이름으로 다시 해석하지 않는다(모델·스킬이 정확히 짚었을 때 가로채면 안 된다).
  if (말.startsWith('/')) return { path: 말 };
  // **눈에 같은 글자를 같게 본다.** macOS 는 마운트된 볼륨 이름을 NFD(자모 분해)로 돌려주고
  // 모델은 사용자가 친 그대로 NFC 로 보낸다 — `===` 로는 다른 문자열이다. 라이브에서 볼륨이
  // 붙어 있는데도 "작업용SSD라는 자리는 지금 안 보여요"가 나왔다(369d8d0d). 한글 이름의
  // 외장 디스크는 전부 여기서 죽는다. 정규화는 판단이 아니라 **같은 이름을 같다고 읽는 것**이다.
  const 같은이름 = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
  const 맞음 = 자리들.find((p) => 같은이름(p.label, 말));
  if (맞음) return { path: 맞음.path, name: 맞음.label };
  // **사용자는 표준 폴더를 우리말로 부른다** — "다운로드요", "바탕화면이요"(H08). 디스크의 이름은
  // Downloads·Desktop 이다. 이름을 자리로 바꾸는 게 우리 일이면, 부르는 말을 이름으로 바꾸는 것도
  // 우리 일이다. 목록에 실제로 있는 자리로만 승계한다(없는 폴더를 지어내지 않는다).
  const 표준 = 표준폴더말[말.normalize('NFC').replace(/\s+/g, '').toLowerCase()];
  const 표준맞음 = 표준 && 자리들.find((p) => 같은이름(p.label, 표준));
  if (표준맞음) return { path: 표준맞음.path, name: 표준맞음.label };
  return { unknown: 말 };
}

/**
 * **자리 이름에 사용자가 부르는 말을 붙인다**(PM 매듭 ① · 2026-08-07).
 *
 * 모델이 매 턴 받는 자리 목록이 `Desktop · Documents · Downloads · GPAO-T5` 였다 —
 * **이름만 있고 사장님이 부르는 말이 없다.** 사장님은 *"바탕화면에 저장해줘"* 라고 하지
 * `Desktop` 이라 하지 않는다. 그 대응이 프롬프트 어디에도 없어서, 판 ⑫에서 모델은 방금 읽은
 * `~/GPAO-T5/Desktop` 에 끌려 거기 썼다(그 문자열이 그 턴 문맥에 21회 있었다).
 * 파일도 내용도 맞았고 **자리만 틀렸다** — 사장님은 그것을 못 받는다.
 *
 * 아래 `표준폴더말` 이 이미 그 대응을 갖고 있다. 여기서는 **역방향으로 옮길 뿐**이다 —
 * 낱말 목록을 새로 만드는 것이 아니다.
 *
 * **표준 자리 하나만 그 말로 부른다.** 같은 이름이 딴 데 또 있으면(`~/GPAO-T5/Desktop`)
 * 둘 다 "바탕화면"이 되어 고르는 근거가 도로 사라진다 — 홈 바로 아래 것만 승계한다.
 */
export function 부르는말붙이기(자리들 = [], deps = {}) {
  const home = deps.home ?? homedir();
  const 쓴말 = new Set();
  return 자리들.map((p) => {
    const 이름 = String(p?.label ?? '');
    const 말 = 부름말역방향[이름];
    const 홈바로아래 = String(p?.path ?? '') === join(home, 이름);
    if (!말 || !홈바로아래 || 쓴말.has(말)) return 이름;
    쓴말.add(말);
    return `${말}(${이름})`;
  }).join(' · ');
}

/** 디스크 이름 → 사장님이 부르는 말. `표준폴더말` 의 역방향(같은 세 곳). */
const 부름말역방향 = { Downloads: '다운로드', Documents: '문서', Desktop: '바탕화면' };

/**
 * **이 자리가 몇 월 자료인가**(PM 매듭 ① · 2026-08-07).
 *
 * ⑫⑤가 *"지난달"*·*"이번 달"* 을 못 골랐다. 밟아 보니 모델은 오늘을 안다
 * (`[지금] 2026년 8월 7일`). 모르는 것은 **폴더가 몇 월 자료인지**다.
 * locate 가 주던 근거가 `"이름이 맞아요 · 문서 3개 · 오늘 고쳤어요"` 뿐이라,
 * *"지난달"* 이라는 말에 `지난달 정산 파일`(내용은 2026-06)이 이겼다 — 이름이 정확히 맞으니까.
 *
 * 손은 이미 그 폴더를 열어 파일 목록을 갖고 있다(`counts` 를 세려면 읽어야 한다).
 * **아는 것을 안 주고 있었을 뿐이다.**
 *
 * 낱말 규칙이 아니다 — 이름에서 **연-월을 읽는다.** 못 읽으면 `null` 이다.
 * *"6월"* 처럼 연도가 없으면 안 적는다: 어느 해인지 모르는 채로 적으면 그게 지어내는 것이다.
 * 여러 달이 섞이면 섞였다고 말한다 — 하나로 단정하면 틀린 달을 고르게 만든다.
 */
export function 자료기간(이름, 안의파일들 = []) {
  const 연월 = (t) => [...String(t ?? '').matchAll(/(20\d\d)[-_.\s]?(0[1-9]|1[0-2])(?![0-9])/g)]
    .map((m) => `${m[1]}-${m[2]}`);
  const 모은것 = [...연월(이름)];
  if (!모은것.length) for (const f of 안의파일들) 모은것.push(...연월(f));
  const 다른것 = [...new Set(모은것)].sort();
  if (!다른것.length) return null;
  return 다른것.length === 1 ? 다른것[0] : `${다른것[0]}~${다른것[다른것.length - 1]}`;
}

/** 우리말 부름 → 디스크의 표준 폴더 이름. 여기 있는 세 곳만 — 넓힘의 경계와 같다. */
const 표준폴더말 = {
  '다운로드': 'Downloads', '다운로드폴더': 'Downloads',
  '문서': 'Documents', '내문서': 'Documents',
  '바탕화면': 'Desktop', '데스크톱': 'Desktop', '데스크탑': 'Desktop',
};

/**
 * @param {{home?:string, volumesDir?:string}} [deps] 주입할 수 있어야 가짜 홈으로 검사할 수 있다
 *   (특정 사용자 경로를 하드코딩하면 그 순간 게이트에서 걸린다).
 */
export function makeLocalLocateTool(deps = {}) {
  const homeOf = () => deps.home ?? homedir();

  return {
    /**
     * 같은 사용자 턴에서 **사용자가 직접 부르고**, locate 가 실제로 연 폴더만 제한 읽기
     * 범위가 된다. 모델이 임의로 고른 시작점이나 검색 중 발견한 후보 전체를 권한으로 바꾸지
     * 않는다. 시작 폴더를 직접 불렀으면 그 루트 하나, 하위 폴더를 직접 불렀으면 그 폴더만 연다.
     */
    async readScopeOf(rec, executionContext = {}) {
      const currentRequest = String(executionContext.currentRequest ?? '').normalize('NFC');
      if (!currentRequest.trim()) return [];
      if (rec?.failureState !== 'none' || rec?.actualCall?.tool !== 'local.locate') return [];
      const searched = rec.result?.searched;
      const roots = [];

      // `from` 은 locate 가 실제로 연 자리다. 모델이 임의로 고른 것만으로는 부족하고, 사용자
      // 원문에도 그 자리 이름(또는 절대 경로)이 있어야 한다. Developer·외장 디스크처럼 사용자가
      // 직접 지목한 루트를 열되 홈 전체를 조용히 여는 일은 없다.
      const selected = String(searched?.from ?? '');
      const selectedName = String(searched?.fromName ?? rec.actualCall.args?.from ?? '').normalize('NFC');
      const askedName = String(rec.actualCall.args?.from ?? '').normalize('NFC');
      const selectedMentioned = selected && selectedName
        && (currentRequest.includes(selectedName) || (askedName && currentRequest.includes(askedName)));
      if (selectedMentioned) {
        try {
          const actual = await realpath(selected);
          if ((await stat(actual)).isDirectory() && !protectionFor(actual)) roots.push(actual);
        } catch { /* 실제로 확인할 수 없는 시작점은 범위가 아니다 */ }
      }

      // 시작 루트를 부르지 않았더라도 사용자가 하위 폴더 이름을 직접 말했다면 그 후보만 연다.
      for (const candidate of rec.result?.candidates ?? []) {
        if (!candidate?.explicitlyRequested || !candidate?.path || candidate.kind === 'file') continue;
        try {
          const actual = await realpath(candidate.path);
          if (!(await stat(actual)).isDirectory() || protectionFor(actual)) continue;
          roots.push(actual);
        } catch { /* 확인할 수 없는 후보는 범위가 아니다 */ }
      }
      return [...new Set(roots)];
    },
    /**
     * 지금 볼 수 있는 자리. **도구를 부르지 않아도** 매 턴 모델에게 사실로 간다 —
     * 실측: "폴더를 어떻게 알려주면 돼?"에 모델이 도구를 안 부르고 답했고(원장 0건),
     * 그래서 자리 목록을 못 봤다. 도구 결과로는 못 푸는 자리였다.
     */
    async places() { return 볼수있는자리(homeOf(), deps.volumesDir); },
    /**
     * 찾은 자리가 다음 걸음의 자리다 — 확신 낮은 후보는 자리라고 말하지 않는다.
     *
     * **후보는 후보다.** 실측(오너 라이브 G 행렬 2026-07-29): `정산 파일 정리해줘` 에
     * 런타임은 `5곳이 후보예요` 를 사실로 냈는데, 여기서 `candidates[0]` 하나만 자리로
     * 넘기는 바람에 다음 턴에는 **고른 자리 하나만** 남았다. 모델은 그것을 정해진 자리로 읽고
     * 말없이 진행했고, 사용자는 다섯 곳 중 하나가 골라졌다는 사실조차 듣지 못했다.
     * 다른 달 자료였다면 숫자가 통째로 틀린 채 끝난다.
     *
     * 그래서 **고른 것과 나머지를 함께** 넘긴다. 여기서 "물어봐라"라고 시키지 않는다 —
     * 사실만 주고 무엇을 할지는 모델이 정한다(§24).
     */
    subjectOf(rec) {
      const 후보들 = (rec?.result?.candidates ?? []).filter((c) => c?.path);
      const top = 후보들[0];
      if (!top?.path || top.confidence === 'low') return null;

      // **여러 곳이면 아직 자리가 아니다.** 앞선 회차에서는 나머지를 `detail` 에 붙여 놓고도
      // 첫 후보를 그대로 `place` 로 올렸다. 그러면 같은 모델 입력에 두 사실이 함께 간다:
      //   "후보는 5곳이다"  ·  "지금 자리는 첫째이고 여기서 이어서 보면 된다"
      // 모델 습관 이전에 **런타임 투영끼리 충돌한 것**이다(오너 감사 2026-07-29).
      // 그래서 복수 후보는 **선택되지 않은 후보 집합**으로 올린다. `detail` 도 경로로 시작하지
      // 않게 한다 — working-state 가 `/` 로 시작하는 detail 을 `지금 자리` 로 승격하기 때문이다.
      // 여기서 "물어봐라"라고 시키지 않는다. **아직 고르지 않았다는 사실**만 정확히 준다(§24).
      if (후보들.length > 1) {
        const 보일것 = 후보들.slice(0, 5);
        return {
          key: `place_candidates:${후보들.map((c) => c.path).join('|')}`,
          kind: 'place_candidates',
          label: `${후보들.length}곳`,
          detail: `아직 고른 자리 없음 — ${보일것.map((c) => `${c.path}${c.why ? `(${c.why})` : ''}`).join(' · ')}`
            + (후보들.length > 보일것.length ? ` 외 ${후보들.length - 보일것.length}곳` : ''),
          candidates: 보일것.map((c) => c.path),
        };
      }
      return { key: `place:${top.path}`, kind: 'place', label: String(top.path), detail: String(top.path) };
    },
    async handler(args = {}, executionContext = {}) {
      const 말 = String(args.what ?? args.query ?? args.request ?? '').trim();
      const 현재요청 = String(executionContext.currentRequest ?? '').normalize('NFC');
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
      // **확장자는 낱말이 아니다**(S3) — `YOON.md` 가 모든 `.md` 를 잡던 자리.
      const 낱말들 = 이름낱말(말);
      const 찾는종류 = 부른종류(말);
      const 찾는형식 = 부른형식(말);   // 「엑셀 파일」처럼 형식을 부른 경우의 확장자 자

      const 후보 = [];
      let 본폴더 = 0; let 멈춤 = false; const 안본자리 = [];
      // **필터 전에 잘린 폴더**(§12-J6). 어디서 몇 개를 못 봤는지를 기계 사실로 모은다 —
      // 이게 없으면 「폴더 N개를 훑었어요」가 「다 봤어요」로 읽힌다.
      const 잘린폴더 = [];
      const 대기 = [{ dir: from, d: 0 }];
      const 지금 = Date.now();

      while (대기.length) {
        const { dir, d } = 대기.shift();
        if (본폴더 >= MAX_DIRS) { 멈춤 = true; break; }
        let entries;
        // **절단은 필터 앞에 있다** — 401번째부터는 이름이 정확히 맞아도 후보가 될 기회조차
        // 없다. 그 사실을 여기서 세어 두지 않으면 아래 어디에서도 복원할 수 없다(§12-J6).
        // 상한 값 자체는 안 건드린다 — 바꿀 근거가 없다. 바꾸는 것은 **침묵**뿐이다.
        let 전부;
        try { 전부 = await readdir(dir, { withFileTypes: true }); }
        catch { continue; }
        entries = 전부.length > MAX_ENTRIES_PER_DIR ? 전부.slice(0, MAX_ENTRIES_PER_DIR) : 전부;
        if (전부.length > MAX_ENTRIES_PER_DIR) {
          잘린폴더.push({ path: dir, seen: MAX_ENTRIES_PER_DIR, unseen: 전부.length - MAX_ENTRIES_PER_DIR });
        }
        본폴더 += 1;

        const 성 = 성격(entries);
        // **파일 이름을 물었으면 폴더는 그 이름일 수 없다.** `지침.md` 를 물었는데
        // `Developer` 폴더가 후보로 올라와 모델이 고를 것을 늘렸다(라이브 2026-08-05).
        const 이름맞음 = !파일이름꼴(말) && Boolean(이름맞음종류(basename(dir), 말, 낱말들));
        // 모델이 locate 질의를 한 대상으로 좁혀 쓰더라도, 같은 사용자 요청에서 이름을 직접 부른
        // 형제 폴더는 놓치지 않는다. 실제 탐색으로 연 폴더의 basename 과 사용자 원문을 정확히
        // 대조할 뿐이며, 경로를 추측하거나 홈 전체를 권한으로 올리지 않는다.
        const 요청에서부름 = d > 0 && basename(dir).length >= 2
          && 현재요청.includes(basename(dir).normalize('NFC'));

        if (d > 0 && (성.kind || 이름맞음 || 요청에서부름)) {
          let 최근일;
          try { 최근일 = Math.floor((지금 - (await stat(dir)).mtimeMs) / 86_400_000); } catch { /* 못 보면 안 쓴다 */ }
          후보.push({
            path: dir,
            kind: 성.kind ?? 'folder',
            kindLabel: 종류이름[성.kind] ?? '폴더',
            why: 근거(성, 이름맞음, 최근일, 요청에서부름, 자료기간(basename(dir), entries.map((e) => e.name))),
            // **몇 월 자료인가**(PM 매듭 ① · 2026-08-07). 이름·개수·수정시각만 주면
            // *"지난달"* 이라는 말에 `지난달 정산 파일`(내용은 2026-06)이 이긴다 — 이름이
            // 맞으니까. 오늘은 모델이 안다(`[지금] …8월 7일`). **폴더가 몇 월인지를 몰랐다.**
            // `entries` 는 이미 손에 있다(`성격()` 이 그걸로 셌다) — 아는 것을 주는 것뿐이다.
            ...(((기간) => (기간 ? { 자료기간: 기간 } : {}))(
              자료기간(basename(dir), entries.map((e) => e.name)))),
            // 확신도: 이름이 맞고 성격도 맞으면 높다. 성격만이면 낮다 — 모델이 이걸 보고 묻는다.
            // 이름이 맞으면 높다. 이름 대신 **부른 종류**가 맞아도 볼 만하다.
            // 둘 다 아니면 그냥 "이런 자리도 있다"일 뿐이라 낮게 둔다(모델이 이걸 보고 묻는다).
            confidence: 요청에서부름 ? 'high'
              : 이름맞음 && 성.kind ? 'high'
              : 이름맞음 ? 'medium'
                : (찾는종류 && 성.kind === 찾는종류) ? 'medium' : 'low',
            ...(요청에서부름 ? { explicitlyRequested: true } : {}),
            modifiedDaysAgo: 최근일,
            counts: 성.counts,
          });
        }

        // **파일도 후보다.** H08 실측(인간 기준선 실패 3/3): "다운로드 폴더에 방금 받은 견적서"의
        // 대상은 폴더가 아니라 파일인데, 여기가 폴더만 올려서 영영 못 찾았다. 이름이 맞는 파일은
        // 파일로 올린다 — 폴더처럼 성격을 추측하지 않고(파일은 열지 않는다), 이름과 시각만 근거로 준다.
        for (const e of entries) {
          const 맞음 = e.isDirectory() ? null : 이름맞음종류(e.name, 말, 낱말들);
          // **형식을 부른 경우 이름이 안 맞아도 그 형식이면 후보다.** 「엑셀 파일 찾아줘」의
          // 대상은 이름이 아니라 확장자다 — 이름만 보면 영영 0이 나온다(위 `형식말` 주석).
          const 형식맞음 = !e.isDirectory() && 찾는형식 ? 찾는형식.자.test(e.name) : false;
          if (e.isDirectory() || e.name.startsWith('.') || (!맞음 && !형식맞음)) continue;
          const full = join(dir, e.name);
          // 비밀 이름 파일(.env·토큰·키)은 후보로도 안 올린다 — 보여주면 그리로 가게 된다.
          if (protectionFor(full)) { 안본자리.push(full); continue; }
          let 최근일; let mtimeMs;
          try { mtimeMs = (await stat(full)).mtimeMs; 최근일 = Math.floor((지금 - mtimeMs) / 86_400_000); } catch { /* 못 보면 안 쓴다 */ }
          후보.push({
            path: full,
            kind: 'file',
            kindLabel: '파일',
            why: [맞음 === 'exact' ? '이름이 정확히 맞아요'
              : 맞음 ? '이름에 그 낱말이 있어요' : '부르신 형식의 파일이에요',
            시각말(최근일, mtimeMs)].filter(Boolean).join(' · '),
            // **확신은 정확히 맞을 때만 준다.** 낱말이 들었다는 것은 후보의 근거이지
            // "그 파일"이라는 근거가 아니다 — 그 둘을 같은 등급으로 주면 모델이 고를 수 없다.
            confidence: 맞음 === 'exact' ? 'high' : 'medium',
            ...(!맞음 && 형식맞음 ? { 형식일치: true } : {}),
            이름맞음: 맞음,
            modifiedDaysAgo: 최근일,
            // 기계 대조 가능한 시각 — "최종본" 판단은 이름이 아니라 이 사실 위에서 선다(H08).
            ...(mtimeMs ? { modifiedAt: new Date(mtimeMs).toISOString() } : {}),
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

      // ── **세기**(형식 질의일 때만) ──────────────────────────────────────────
      // 걸음은 이미 **전부** 세어 놓았다 — `후보` 에 다 들어 있고 아래 `slice(0,5)` 가
      // 자를 뿐이다. 이 파일이 두 번 쓴 그 말과 같은 자리다: **아는 것을 안 주고 있었다.**
      let 세기;
      if (찾는형식) {
        // **같은 파일을 같다고 읽는다.** 걸음(`readdir`)은 디스크가 적힌 대로 NFD 를 주고
        // 색인(`mdfind`)은 NFC 를 준다 — `Set` 은 그 둘을 **다른 파일로 센다.**
        // 실물 홈에서 잡았다(2026-08-12): `엑셀 파일` → *"모두 2개 — …/2026-08 정산(1개) ·
        // …/2026-08 정산(1개)"*, 실제로는 하나다. `pdf` 는 170 이 나왔는데 사용자 자리
        // 실측은 133 이었고, 「색인이 못 봤다」던 37개가 통째로 **같은 파일의 다른 표기**였다.
        // 없는 파일을 세고, 없는 자리를 만들고, 색인을 모함한다 — 셋 다 한 원인이다.
        // 이 파일 286행이 볼륨 이름에 대해 같은 매듭을 이미 풀었다. 세는 자에서 세 번째 얼굴이다.
        const 같은키 = (p) => String(p).normalize('NFC');
        const 걸음집합 = new Set(후보
          .filter((c) => c.kind === 'file' && 찾는형식.자.test(basename(c.path)))
          .map((c) => 같은키(c.path)));

        // 색인은 **닿는 범위**를 넓힐 뿐 판정하지 않는다. 우리 자로 거르고, 보호구역과
        // 걸음이 안 들어가는 자리(`SKIP`)는 색인이 알아도 내지 않는다 — 자가 두 벌이면 안 된다.
        let 색인원본 = null;
        try { 색인원본 = await (deps.mdfind ?? 색인에물어보기)(from, 찾는형식.확장자); }
        catch { 색인원본 = null; }          // 매달리지 않는다 — 걸음으로 되돌아간다
        let 뺀시스템자리 = 0;
        const 색인집합 = new Set();
        for (const p of 색인원본 ?? []) {
          if (!찾는형식.자.test(basename(p))) continue;      // 폴더 `…/skills/xlsx` 등
          if (protectionFor(p)) continue;                    // 세기에서도 안 샌다
          if (건너뛴자리(p, from)) { 뺀시스템자리 += 1; continue; }
          색인집합.add(같은키(p));
        }
        // **색인이 0을 냈다고 파일이 없는 것은 아니다.** 비색인 볼륨·외장·방금 만든 파일은
        // 색인이 조용히 0을 낸다 — 그걸 사실로 받으면 그게 ⑥의 거짓 완결이다.
        // 걸음이 본 것이 있는데 색인이 하나도 못 냈으면 **색인이 이 자리를 못 보는 것**이다.
        const 색인씀 = 색인집합.size > 0;
        const 전부 = 색인씀 ? new Set([...색인집합, ...걸음집합]) : 걸음집합;
        // 색인이 못 본 것 = 걸음만 아는 것. 있으면 그 사실이 답에 남는다(반대시험 ④).
        const 색인놓침 = 색인씀 ? [...걸음집합].filter((p) => !색인집합.has(p)).length : 0;

        // 자리별 분포. ⑥의 *"전부 다운로드 안에"* 는 이 칸이 비어서 나온 말이다.
        const 자리별 = new Map();
        for (const p of 전부) 자리별.set(dirname(p), (자리별.get(dirname(p)) ?? 0) + 1);

        세기 = {
          formatTotal: 전부.size,
          formatByPlace: [...자리별].map(([path, count]) => ({ path, count }))
            .sort((a, b) => b.count - a.count).slice(0, 12),
          formatPlaceCount: 자리별.size,
          countedBy: 색인씀 ? 'index+walk' : 'walk',
          ...(색인놓침 ? { indexMissed: 색인놓침 } : {}),
          ...(뺀시스템자리 ? { excludedSystemPlaces: 뺀시스템자리 } : {}),
        };

        // 색인만 아는 파일(걸음의 `depth` 밖)도 고를 수 있어야 한다 — 세어 놓고 어디인지
        // 못 말하면 반쪽이다. 다섯 칸을 채울 만큼만 `stat` 한다(수백 개를 다 열지 않는다).
        for (const p of 색인집합) {
          if (후보.length >= MAX_CANDIDATES * 2 || 걸음집합.has(같은키(p))) continue;
          let 최근일; let mtimeMs;
          try { mtimeMs = (await stat(p)).mtimeMs; 최근일 = Math.floor((지금 - mtimeMs) / 86_400_000); }
          catch { continue; }              // 색인에만 남은 유령 항목은 후보가 아니다
          후보.push({
            path: p, kind: 'file', kindLabel: '파일',
            why: ['부르신 형식의 파일이에요', 시각말(최근일, mtimeMs)].filter(Boolean).join(' · '),
            confidence: 'medium', 형식일치: true, 이름맞음: null, modifiedDaysAgo: 최근일,
            ...(mtimeMs ? { modifiedAt: new Date(mtimeMs).toISOString() } : {}),
          });
        }
      }

      // 확신도 → 최근 수정 순. "아까 그거"는 대개 방금 고친 것이다.
      const 순서 = { high: 0, medium: 1, low: 2 };
      후보.sort((a, b) => (Boolean(b.explicitlyRequested) - Boolean(a.explicitlyRequested))
        || (순서[a.confidence] - 순서[b.confidence])
        || ((a.modifiedDaysAgo ?? 9999) - (b.modifiedDaysAgo ?? 9999)));

      // **부른 말 자체가 자리 이름이면 그 자리가 답이다.** H08 라이브 실측(2026-08-01):
      // 모델이 what 에 'Downloads'·'다운로드 폴더'를 넣어 "못 찾았어요"를 두 번 받고 걸음을
      // 허비했다. 파일·폴더 매치가 하나도 없을 때, 부른 말이 볼 수 있는 자리의 이름과 맞으면
      // 그 자리를 후보로 준다 — 추측이 아니라 이름 대조다(자리로()와 같은 정규화).
      // 이름·종류가 맞은 후보가 없을 때만 — 실제 파일 매치를 자리 이름이 가리면 안 된다.
      if (말 && !후보.some((c) => c.confidence !== 'low')) {
        const 통말 = 말.normalize('NFC').replace(/\s+/g, '').toLowerCase().replace(/(폴더|자리)$/, '');
        const 이름들 = [통말, 표준폴더말[통말]].filter(Boolean);
        const 같은 = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
        const 자리 = (await 자리목록()).find((p) => 이름들.some((n) => 같은(p.label, n)));
        if (자리) {
          후보.unshift({
            path: 자리.path, kind: 'folder', kindLabel: '폴더',
            why: '부르신 이름의 자리예요', confidence: 'high',
          });
        }
      }
      // **못 찾은 것을 찾은 척하지 않는다.** 사용자가 뭔가를 특정해서 물었는데 이름도 종류도
      // 안 맞으면, 낮은 후보를 잔뜩 늘어놓는 건 "찾았다"는 오해만 만든다(실측: "포토샵 파일"에
      // 무관한 폴더 셋이 나왔다). 그럴 땐 몇 개만 곁들이고 못 찾았다고 말한다.
      const 짚었나 = 후보.some((c) => c.confidence !== 'low');
      const 물었나 = 낱말들.length > 0 || Boolean(찾는종류);
      // **이름이 정확히 맞는 것을 앞세운다.** 뒤에 섞이면 모델은 목록의 앞부터 고른다 —
      // 라이브에서 정확한 `지침.md` 가 다른 후보들 사이에 묻혀 있었고, 모델은 자기가 훑던
      // 폴더(Documents) 안의 낱말 후보를 답으로 삼았다.
      후보.sort((a, b) => (b.이름맞음 === 'exact' ? 1 : 0) - (a.이름맞음 === 'exact' ? 1 : 0));
      const 고른것 = 후보.slice(0, 물었나 && !짚었나 ? 2 : MAX_CANDIDATES);
      const 정확한것 = 고른것.filter((c) => c.이름맞음 === 'exact');
      // ── **못 본 것을 말한다**(§12-J6 · 2026-08-12) ────────────────────────────
      // 비교군의 축은 둘 다 「잘라 버리되 잘랐다고 말한다」다 —
      //   쿠아 `SKILL.md:665-668`: 트리가 너무 크면 파일로 내보내고 **그 경로를 준다**.
      //   클로드코드: *"Output too large (106.3KB). Full output saved to: …"*
      // 우리는 전체를 줄 수 없다(수천 항목은 그 자체가 덤프다). 그러나 **잘렸다는 사실과
      // 어디서 몇 개인지**는 줄 수 있고, 그것 없이는 침묵이 곧 거짓말이다.
      //
      // **찾았을 때도 뺀 자리에 붙인다.** 후보가 나왔다고 조용해지면, 401번째에 있던 더 나은
      // 것은 영영 없는 것이 된다 — 모델도 사용자도 그 사실을 볼 자리가 없다.
      const 못본총 = 잘린폴더.reduce((n, f) => n + f.unseen, 0);
      const 잘림말 = 잘린폴더.length
        ? ` 다만 항목이 아주 많은 폴더 ${잘린폴더.length}곳은 앞 ${MAX_ENTRIES_PER_DIR}개만 봤어요`
          + ` — 거기서 ${못본총}개는 못 봤어요(더 좁혀 주시면 그 안을 볼게요).`
        : '';

      // **세었으면 세었다고 말한다**(형식 질의 전용). 비교군 둘 다 「자르되 잘랐다고 말하고
      // 다음 길을 준다」가 축이다 — 오픈클로 `find`:
      //   *"1000 results limit reached. Use limit=2000 for more, or refine pattern"*
      //   (`openclaw/dist/sessions-DIwWArcp.js:6349`)
      // 헤르메스 `search_files`:
      //   *"[Hint: Results truncated. Use offset=50 to see more, or narrow with a more
      //   specific pattern or file_glob.]"* (`hermes-agent/tools/file_tools.py:2140`)
      // 우리는 **자르지 않고 센다**(그게 이 회차에서 바꾼 자다). 그래도 같은 의무는 남는다 —
      // 어느 자로 쟀는지, 무엇을 못 봤는지, 무엇을 뺐는지.
      const 세기말 = (() => {
        if (!세기?.formatTotal) return '';
        const 앞 = 세기.formatByPlace.slice(0, 5)
          .map((p) => `${p.path}(${p.count}개)`).join(' · ');
        const 나머지 = 세기.formatPlaceCount > 5 ? ` 외 ${세기.formatPlaceCount - 5}곳` : '';
        const 잰자 = 세기.countedBy === 'index+walk'
          ? 'OS 색인으로 셌어요' : `폴더를 직접 훑어 셌어요(${depth}단계까지)`;
        return `"${말}"은 모두 ${세기.formatTotal}개예요 — ${앞}${나머지}. (${잰자}`
          + (세기.indexMissed ? `, 색인이 못 본 ${세기.indexMissed}개는 직접 훑어 채웠어요` : '')
          + (세기.countedBy === 'walk'
            ? ' — 색인을 못 써서 그 아래는 못 봤을 수 있어요' : '')
          + (세기.excludedSystemPlaces
            ? `, 앱이 쓰는 자리(Library 등) ${세기.excludedSystemPlaces}개는 뺐어요` : '')
          + ')';
      })();

      return {
        result: {
          candidates: 고른것,
          ...(세기 ?? {}),
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
          // 폴더 상한(`stoppedAtLimit`)과 **다른 절단**이다 — 그건 폴더를 덜 연 것이고,
          // 이건 연 폴더 안을 덜 본 것이다. 둘을 한 칸에 섞으면 어느 쪽인지 못 가린다.
          ...(잘린폴더.length
            ? { truncatedFolders: 잘린폴더.slice(0, 20), unseenEntries: 못본총, entryLimitPerFolder: MAX_ENTRIES_PER_DIR }
            : {}),
        },
        // **세었으면 세기가 답이다.** 「어느 것?」 문장들은 고르기 갈래의 것이고, 형식 질의에
        // 그걸 내면 ⑤처럼 다섯 개를 「이렇게 있어요」로 내밀게 된다.
        userSafeSummary: (세기말 ? 세기말 : 고른것.length === 0
          // **얼마나 훑었는지를 함께 말한다.** `본폴더` 는 이미 세고 있었는데 사용자면 문장에만
          // 안 실렸다 — 사실을 갖고 있으면서 침묵한 것이다.
          //
          // S1 실측(2026-08-04): 묶음 이동이 "조건에 맞는 파일이 없어요"만 주자 모델이 원인을
          // 경로 문제로 **지어내** 사용자에게 그렇게 말했다. 도구가 이유를 안 주면 모델은
          // 이유를 지어낸다. 여기도 같은 자리다 — 3개를 뒤졌는지 300개를 뒤졌는지 모르면
          // 모델은 "권한 문제인가"·"경로가 틀렸나"를 추측하게 된다.
          ? (말
            ? `"${말}"에 해당하는 자리를 못 찾았어요. 폴더 ${본폴더}개를 ${depth}단계까지 훑었어요`
              + `${멈춤 ? '(한도에 닿아 멈췄어요)' : ''}`
              + `${안본자리.length ? `, 보호된 자리 ${안본자리.length}개는 건너뛰었어요` : ''}.`
            : '찾을 대상을 알려주시면 찾아볼게요.')
          // **재고를 앞세운다**(3단계 매듭 ① · 2026-08-08). 옛 문장은 *"딱 맞는 자리는 못
          // 찾았어요"* 로 시작했다 — 모델이 그 앞머리를 "자료 없음"으로 읽고, 눈앞의 후보를
          // 버린 채 사용자를 심문했다(⑬ 아홉 회차 실측). 이름이 그대로 없다는 것은 사실이라
          // 남기되, **방에 무엇이 있는지가 먼저다** — 모델 앞에 놓는 것은 실패 판정이 아니라 현실이다.
          : (물었나 && !짚었나)
            ? `지금 자료가 있는 자리는 이 ${고른것.length}곳이에요("${말}" 이름 그대로의 자리는 따로 없어요). 안에 무엇이 있는지는 각 후보에 적혀 있어요.`
            : 정확한것.length === 1
            // **정확한 답을 갖고 있으면 그렇게 말한다.** 예전엔 정확한 것 하나와 낱말만 든 것
            // 넷을 묶어 "5곳이 후보예요"라고 했다. 모델은 후보 목록을 받으면 그중 하나를
            // 골라야 하고, 그때 엉뚱한 것을 골랐다(라이브 2026-08-05: `지침.md` 를 물었는데
            // `《… 설계 지침》.md` 를 열어 읽었다). **사실을 갖고 있으면서 뭉갠 것이다.**
            ? `${정확한것[0].path} 예요 (${정확한것[0].why}).`
            : 정확한것.length > 1
            ? `이름이 정확히 맞는 자리가 ${정확한것.length}곳이에요.`
            : 고른것.length === 1
            ? `${고른것[0].path} 인 것 같아요 (${고른것[0].why}).`
            // 같은 이유로 여기도 재고가 먼저다 — 괄호의 "정확히 맞는 건 없어요"가 문장의
            // 알맹이가 되면 모델은 다섯 후보를 들고도 빈손이라고 믿는다.
            : `자료가 있는 자리 ${고른것.length}곳을 찾았어요. 이름이 그대로 맞는 곳은 없지만, 무엇이 든 자리인지는 각 후보에 적혀 있어요.`)
          // **모든 갈래에 붙는다.** 어느 문장으로 끝나든 못 본 것은 못 본 것이다.
          + 잘림말,
        ...(고른것.length === 0 || (물었나 && !짚었나) ? { nextSafeAction: 이름으로골라 } : {}),
      };
    },
  };
}
