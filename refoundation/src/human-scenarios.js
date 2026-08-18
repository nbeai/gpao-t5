import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const HUMAN_SCENARIOS = Object.freeze([
  {
    id: 'event-planning-long-dialogue', kind: 'conversation',
    title: '고객 행사 계획을 정정·보류·재개하는 긴 대화',
    turns: [
      { prompt: '다음 달에 작은 고객 행사를 해보려고 해. 기존 고객이 다시 찾아오게 하는 게 목표고, 예산은 180만원, 서른다섯 명 정도 생각 중이야. 내가 놓치기 쉬운 것부터 짚어줘.' },
      { prompt: '장소는 우리 사무실 라운지로 하고 음식은 밖에서 부르자.' },
      { prompt: '아, 인원은 서른다섯 말고 스물여덟 명으로 바꿀게.' },
      { prompt: '그럼 돈을 큰 항목 네 개로만 나눠봐.' },
      { prompt: '음식은 한 사람에 3만원 넘지 않게 잡아줘. 계산도 반영하고.' },
      { prompt: '내가 숫자에 약하니까 앞으로는 결론부터 쉽게 말해줘.' },
      { prompt: '잠깐 다른 얘기. 행사 이름은 너무 거창하지 않은 걸로 세 개만 생각해줘.' },
      { prompt: '두 번째가 괜찮네. 그런데 감사라는 말은 빼자.' },
      { prompt: '좋아, 이름은 일단 보류하고 누구를 부를지로 돌아가자.' },
      { prompt: '최근 6개월 안에 구매한 분들을 먼저 보되, 지금 불만 처리 중인 분들은 빼자.' },
      { prompt: '이번 답만 표로 보여줘.' },
      { prompt: '초대 문구도 써줘. 따뜻하지만 부담 없게 두 문장으로.' },
      { prompt: '조금 오글거려. 덜 친한 사이에도 어색하지 않게 고쳐줘.' },
      { prompt: '담당은 민지랑 현우야. 민지는 초대, 현우는 현장 운영을 맡을 거야.' },
      { prompt: '현우가 그날 조금 늦을 수도 있대. 그 일만 내가 먼저 맡을게.' },
      { prompt: '아니, 현장 운영 전체 말고 입장 확인만 내가 맡는다는 뜻이야.' },
      { prompt: '지금까지 정해진 것과 아직 안 정해진 걸 섞지 말고 나눠줘.' },
      { prompt: '나 지금 좀 급해. 오늘 안에 결정할 것만 세 줄로 말해줘.' },
    ],
  },
  {
    id: 'files-artifact-undo', kind: 'files',
    title: '실제 자료에서 최신 사실을 골라 결과물을 만들고 되돌리는 흐름',
    turns: [
      { prompt: '다운로드에 행사준비라는 폴더가 있을 거야. 뭐가 들어 있는지 한번 봐줄래?' },
      { prompt: '운영안이 여러 개인데 진짜 최신 걸 골라줘. 파일 이름만 믿지는 말고.' },
      { prompt: '거기서 예산, 인원, 장소랑 아직 결정 안 된 것만 짧게 알려줘.' },
      { prompt: '참석자 메모도 같이 보고 서로 안 맞는 게 있으면 말해줘.' },
      { prompt: '인원은 메모에 적힌 최신 숫자로 하고 장소는 운영안대로 가자.' },
      { prompt: '그 기준으로 할 일 목록 초안부터 여기 보여줘. 아직 파일은 만들지 말고.' },
      { prompt: '담당자 칸도 넣어줘. 모르는 건 미정이라고 써줘.' },
      { prompt: '좋아. 같은 폴더에 행사 체크리스트로 저장해줘.' },
      { prompt: '진짜 저장됐는지 다시 열어서 확인해줘.' },
      { prompt: '원래 있던 자료들은 그대로지?' },
      { prompt: '아, 방금 만든 체크리스트는 없던 걸로 해줘. 원본은 건드리지 말고.', approveIfRequested: true },
      { prompt: '이제 지금 폴더 상태만 짧게 정리해줘.' },
    ],
  },
  {
    id: 'personal-reminder-cross-session', kind: 'personal',
    title: '개인 취향과 알림을 만들고 취소한 뒤 새 대화에서 이어 묻는 흐름',
    turns: [
      { prompt: '나는 커피 마실 때 샷 추가하는 걸 좋아해. 다음에도 기억해줘.' },
      { prompt: '그리고 매일 오후 세 시쯤 스트레칭하라고 알려줄 수 있어?' },
      { prompt: '맥 알림으로 해줘. 시간은 네 시로 바꿀게.' },
      { prompt: '이거 진짜 만들어진 거야?' },
      { prompt: '어디에 뭘 만들었는지는 됐고, 내가 보기 쉽게 한 문장으로만 말해줘.' },
      { prompt: '그 알림 이제 취소해줘.', approveIfRequested: true },
      { prompt: '진짜 없어졌어?' },
      { prompt: '좋아. 그럼 여기까지 하자.' },
      { prompt: '내 커피 취향 기억해?', newSessionBefore: true },
      { prompt: '지난 대화에서 내가 만들었다가 취소한 알림은 뭐였지?' },
      { prompt: '그걸 다시 만들지는 말고, 지금 기억된 내 취향만 한 문장으로 말해줘.' },
    ],
  },
]);

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

async function materializeFiles(home) {
  const folder = join(home, 'Downloads', '행사준비');
  await mkdir(folder, { recursive: true });
  const files = {
    '운영안-초안.md': '# 운영안\n예산: 160만원\n인원: 35명\n장소: 외부 회의실\n미정: 케이터링\n',
    '운영안-최종.md': '# 운영안\n예산: 170만원\n인원: 30명\n장소: 호텔 연회장\n미정: 기념품\n',
    '운영안-수정본.md': '# 운영안\n예산: 180만원\n인원: 32명\n장소: 사무실 라운지\n미정: 기념품 담당자\n',
    '참석자메모.md': '# 참석자 메모\n8월 1일 예상: 31명\n8월 3일 최종 확인: 28명\n식이 제한 확인 필요\n',
  };
  for (const [name, content] of Object.entries(files)) await write(join(folder, name), content);
  const stamps = {
    '운영안-초안.md': new Date('2026-08-02T10:00:00Z'),
    '운영안-최종.md': new Date('2026-08-01T10:00:00Z'),
    '운영안-수정본.md': new Date('2026-08-03T10:00:00Z'),
    '참석자메모.md': new Date('2026-08-04T10:00:00Z'),
  };
  for (const [name, stamp] of Object.entries(stamps)) await utimes(join(folder, name), stamp, stamp);
  return { folder, originals: Object.keys(files) };
}

async function materializePersonal(home, room) {
  const bin = join(room, 'fake-bin');
  const state = join(home, '.fake-notification-state');
  await mkdir(bin, { recursive: true });
  const launchctl = join(bin, 'launchctl');
  await writeFile(launchctl, [
    '#!/bin/sh',
    'case "$1" in',
    `  bootstrap) printf 'loaded\\n' > '${state}'; exit 0 ;;`,
    `  bootout) rm -f '${state}'; exit 0 ;;`,
    '  enable) exit 0 ;;',
    `  print) if [ -e '${state}' ]; then printf 'state = waiting\\n'; exit 0; else printf 'service not found\\n' >&2; exit 3; fi ;;`,
    '  *) exit 0 ;;',
    'esac',
  ].join('\n'), 'utf8');
  await chmod(launchctl, 0o755);
  const osascript = join(bin, 'osascript');
  await writeFile(osascript, '#!/bin/sh\nprintf "notification simulated\\n"\n', 'utf8');
  await chmod(osascript, 0o755);
  const crontab = join(bin, 'crontab');
  await writeFile(crontab, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(crontab, 0o755);
  const wrapper = join(room, 'safe-shell');
  const js = [
    '#!/usr/bin/env node',
    "const {spawnSync}=require('node:child_process');",
    `const bin=${JSON.stringify(bin)};`,
    "const args=process.argv.slice(2); let command=String(args.at(-1)||''); args[0]='-c';",
    "for (const name of ['launchctl','osascript','crontab']) {",
    "  for (const prefix of ['/bin/','/usr/bin/','/usr/sbin/']) command=command.replaceAll(prefix+name, bin+'/'+name);",
    "  command=command.replace(new RegExp('(?<![\\\\w/.-])'+name+'(?=\\\\s|$)','g'), bin+'/'+name);",
    "}",
    "args[args.length-1]=command; const out=spawnSync('/bin/zsh',args,{stdio:'inherit',env:{...process.env,PATH:bin+':'+process.env.PATH}}); process.exit(out.status??1);",
  ].join('\n');
  await writeFile(wrapper, js, 'utf8');
  await chmod(wrapper, 0o755);
  return { bin, state, shellProgram: wrapper };
}

export async function materializeHumanScenario(definition, home, room) {
  if (definition.kind === 'files') return materializeFiles(home);
  if (definition.kind === 'personal') return materializePersonal(home, room);
  return {};
}

async function walk(root, current = root) {
  const out = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export async function snapshotHumanFiles(root) {
  const snapshot = {};
  for (const path of (await walk(root)).sort()) {
    const info = await stat(path);
    snapshot[relative(root, path)] = {
      sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
      size: info.size,
    };
  }
  return snapshot;
}

const INTERNAL_TERMS = /pendingId|toolCallId|local_change|session_search|process_control|ToolReceipt|runId|approvalToken/u;

export function commonHumanChecks(turns) {
  const answers = turns.map((turn) => String(turn.answer ?? ''));
  return {
    allTurnsAnswered: answers.every((answer) => answer.trim()),
    noInternalTerms: answers.every((answer) => !INTERNAL_TERMS.test(answer)),
    noFalseHttpFailure: turns.every((turn) => turn.httpStatus === 200 && turn.runStatus === 'completed'),
  };
}

export function assessHumanScenario({ definition, turns, fixture, observations }) {
  const common = commonHumanChecks(turns);
  let checks;
  if (definition.kind === 'conversation') {
    const answer = (index) => String(turns[index - 1]?.answer ?? '');
    const final = answer(18);
    checks = {
      ...common,
      initialAnswerDensity: answer(1).length <= 2_500 && answer(2).length <= 2_500,
      correctedAttendees: /28|스물여덟/u.test(answer(3)) && !/35명으로/u.test(final),
      cateringMath: /84\s*만|840[,.]?000/u.test(answer(5)),
      temporaryTable: /\|/u.test(answer(11)) && !/^\s*\|/u.test(answer(12)),
      correctedResponsibility: /입장/u.test(answer(16)) && !/전체 현장 운영을 맡/u.test(answer(16)),
      separatedState: /정해|확정/u.test(answer(17)) && /미정|안 정/u.test(answer(17)),
      urgentThreeLines: final.split('\n').filter((line) => line.trim()).length <= 4,
      noComputerTools: turns.every((turn) => turn.computerToolCalls === 0),
    };
  } else if (definition.kind === 'files') {
    const answer = (index) => String(turns[index - 1]?.answer ?? '');
    const originals = fixture.originals.map((name) => `Downloads/행사준비/${name}`);
    const initial = observations[0].files;
    const afterDraft = observations[6].files;
    const afterDecision = observations[5].files;
    const afterSave = observations[8].files;
    const afterUndo = observations[11].files;
    const newAfterSave = Object.keys(afterSave).filter((path) => path.startsWith('Downloads/행사준비/') && !originals.includes(path));
    checks = {
      ...common,
      choseActualLatest: /운영안-수정본/u.test(answer(2)),
      foundConflict: /32/u.test(answer(4)) && /28/u.test(answer(4)),
      decisionDidNotEditOriginal: originals.every((path) => initial[path]?.sha256 === afterDecision[path]?.sha256),
      draftDidNotWrite: Object.keys(afterDraft).filter((path) => path.startsWith('Downloads/행사준비/')).length === originals.length,
      artifactCreated: newAfterSave.length >= 1,
      artifactVerified: /확인|열어|저장/u.test(answer(9)),
      originalsPreserved: originals.every((path) => initial[path]?.sha256 === afterUndo[path]?.sha256),
      undoRemovedArtifact: newAfterSave.every((path) => !afterUndo[path]),
      undoWithoutApproval: turns.reduce((sum, turn) => sum + turn.approvals, 0) === 0,
    };
  } else {
    const answer = (index) => String(turns[index - 1]?.answer ?? '');
    const finalMemory = observations.at(-1).memoryItems;
    checks = {
      ...common,
      resolvedReminderSurface: /\?|어떤.*(?:방식|알림)|어디로|어느.*(?:방식|알림)/u.test(answer(2))
        || observations[2].notificationConfigured,
      rememberedPreference: /샷/u.test(answer(9)),
      reminderCreated: observations[3].notificationConfigured,
      conciseWhenAsked: answer(5).split(/(?<=[.!?])\s+/u).filter(Boolean).length <= 2,
      reminderCancelled: !observations[7].notificationConfigured,
      recalledCancelledWork: /알림|스트레칭/u.test(answer(10)) && /취소|없/u.test(answer(10)),
      didNotRecreate: !observations.at(-1).notificationConfigured,
      keptOnlyUsefulMemory: finalMemory.some((item) => /커피|샷/u.test(item.content))
        && !finalMemory.some((item) => /알림|LaunchAgent|스트레칭/u.test(item.content)),
      finalPreferenceOnly: /샷/u.test(answer(11)) && !/LaunchAgent|plist|session_search/u.test(answer(11)),
    };
  }
  return { checks, passed: Object.values(checks).every(Boolean) };
}
