// L3 · 설치된 앱 확인 (P6-L5) — **"열어줄게요"라고 말하기 전에 있는지부터 본다.**
//
// 왜 이것만 하는가: 앱을 실제로 실행하는 것은 되돌리기 어렵고 밖으로 나가는 행동이라
// 별도 승인 경계가 필요하다. 그 전에 T5 가 먼저 알아야 하는 것은 **사실**이다 —
// 이 컴퓨터에 그 앱이 있는가, 실행 가능한 모양인가. 이게 없으면 모델은 빈 자리를 지어낸다
// ("한글로 열어드릴게요" → 설치돼 있지도 않음).
//
// §24: **코드는 사실, 모델은 판단.** 여기서 "엑셀"을 Microsoft Excel 로 잇는 표를 만들지 않는다 —
// 그건 사례 전용 누더기가 되고(§4), 이름 하나 바뀌면 깨진다. 설치된 것을 그대로 주면
// 모델이 "엑셀 = Microsoft Excel"을 안다. 우리는 목록만 정확히 준다.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const MAX_APPS = 300; // 사용자 기계에 이보다 많으면 모델에게 다 줄 이유가 없다

/** 앱이 있는 자리. 한 단계 아래(유틸리티 등)까지만 본다 — 더 깊이는 앱이 아니라 앱 내부다. */
const APP_DIRS = [
  '/Applications', '/System/Applications', '/System/Applications/Utilities',
  '/Applications/Utilities', join(homedir(), 'Applications'),
];

/** 번들이 실제로 실행 가능한 모양인가. 있다고만 하고 깨진 것을 권하면 그것도 거짓말이다. */
async function launchable(appPath) {
  try {
    const entries = await readdir(join(appPath, 'Contents', 'MacOS'));
    return entries.length > 0;
  } catch { return false; }
}

export function makeLocalAppsTool(deps = {}) {
  const dirs = deps.dirs ?? APP_DIRS;
  const os = deps.platform ?? platform();
  return {
    async handler(args = {}) {
      // **못 보는 것을 "없다"로 말하지 않는다.** 빈 목록은 "앱이 하나도 없다"는 뜻이 되고,
      // 모델은 그걸 사실로 받아 "설치된 앱이 없어요"라고 단정한다.
      if (os !== 'darwin') {
        return {
          blocked: true,
          userSafeSummary: '이 컴퓨터에서는 아직 설치된 앱 목록을 확인하지 못해요.',
          nextSafeAction: '쓰시는 앱 이름을 알려주시면 그걸 기준으로 이어갈게요.',
        };
      }

      const apps = new Map(); // 이름 → 정보(같은 앱이 두 자리에 있어도 한 번만)
      const missing = [];
      for (const dir of dirs) {
        let entries;
        try { entries = await readdir(dir); } catch { missing.push(dir); continue; }
        for (const name of entries) {
          if (!name.endsWith('.app')) continue;
          const label = name.slice(0, -4);
          if (apps.has(label)) continue;
          apps.set(label, { name: label, path: join(dir, name) });
        }
      }

      const q = String(args.query ?? args.name ?? '').trim().toLowerCase();
      let list = [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
      const total = list.length;
      if (q) list = list.filter((a) => a.name.toLowerCase().includes(q));
      const shown = list.slice(0, MAX_APPS);
      // 실행 가능 여부는 **보여줄 것만** 확인한다(전부 stat 하면 느리고 얻는 게 없다).
      for (const a of shown) a.launchable = await launchable(a.path);

      return {
        result: {
          apps: shown, total,
          ...(shown.length < list.length ? { moreApps: list.length - shown.length } : {}),
          ...(missing.length ? { notChecked: missing } : {}),
        },
        userSafeSummary: q
          ? (shown.length ? `${shown.map((a) => a.name).join(', ')} 이(가) 설치돼 있어요.` : `그 이름으로는 설치된 앱을 찾지 못했어요(전체 ${total}개 중).`)
          : `설치된 앱 ${total}개를 확인했어요.`,
        ...(q && !shown.length
          ? { nextSafeAction: '앱 이름이 조금 다를 수 있어요 — 전체 목록에서 찾아볼까요?' }
          : {}),
      };
    },
  };
}
