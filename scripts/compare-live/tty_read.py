#!/usr/bin/env python3
"""대화형 기록에서 응답 본문만 꺼낸다. 사람(개발선)이 4칸을 판정하기 위한 것이다.

TUI 는 매 프레임 화면을 다시 그리므로 원문에는 상태줄·박스선·중복 프레임이 섞인다.
그 장식을 걷어내되 **모델이 한 말은 자르지 않는다.**

    python3 tty_read.py 1          (회차 전체 한 줄 요약)
    python3 tty_read.py 1 8        (8번 턴 본문)
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)

# 걷어낼 장식: 박스선, 상태줄, 입력 프롬프트, 스피너, 팁.
CHROME = re.compile(
    r"^(?:[─━=]{3,}|─$|❯|⚕|\s*$)"
    r"|gpt-5\.\d+\s*│"
    r"|\[[█░]+\]"
    r"|^\s*\(tip\)"
    r"|^\s*(?:msg=|/queue|/bg|/steer)"
    r"|Initializing agent"
    r"|^\d+$"
    # TUI 프레임: 상자 테두리, 진행 애니메이션, 첫 화면 안내
    r"|[╭╮╰╯┌┐└┘├┤┬┴┼]"
    r"|^[│|]\s*$"
    r"|(?:reasoning|brainstorming|thinking|working|planning)\.\.\."
    r"|Welcome to Hermes Agent"
    r"|^\s*✦\s*Tip:"
    r"|^\s*Type your message"
)
# 상자 안쪽 줄(`│ 내용 │`)은 내용만 남긴다 — 모델이 한 말일 수 있다.
BOXED = re.compile(r"^[│|]\s?(.*?)\s?[│|]$")
SECRETISH = re.compile(r"sk-[A-Za-z0-9_-]{20,}")


def clean(transcript: str) -> list[str]:
    out: list[str] = []
    for raw in transcript.split("\n"):
        line = raw.strip()
        boxed = BOXED.match(line)
        if boxed:
            line = boxed.group(1).strip()
        if not line or CHROME.search(line):
            continue
        # TUI 재그리기로 같은 줄이 연속 반복되면 하나만 남긴다.
        if out and out[-1] == line:
            continue
        out.append(line)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    run = sys.argv[1]
    seq = sys.argv[2] if len(sys.argv) > 2 else None
    path = HERE / f"tty-run-{run}.jsonl"
    if not path.exists():
        print(f"없음: {path}", file=sys.stderr)
        return 1

    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]

    if seq:
        row = next((r for r in rows if str(r["seq"]) == str(seq)), None)
        if row is None:
            print(f"턴 {seq} 없음", file=sys.stderr)
            return 1
        print(f"── {row['seq']} {row['id']} ({row['state']}) session={row['session']} "
              f"{'새 대화' if row['newSession'] else '이어서'}")
        print(f"── 사용자: {row['prompt']}")
        print(f"── 재는 것: {row['measure'] or '-'}")
        print(f"── 첫표시 {row['firstOutputMs']}ms · 최장공백 {row['longestGapMs']}ms · "
              f"총 {row['totalMs']}ms{' · 시간초과' if row['timedOut'] else ''}")
        print()
        body = "\n".join(clean(row["transcript"]))
        # 시험용 가짜 키는 마스킹해서 보여준다. 기록 원본은 건드리지 않는다.
        print(SECRETISH.sub("sk-***(시험용 가짜)", body))
        return 0

    for row in rows:
        lines = clean(row["transcript"])
        # 사용자 입력 에코를 건너뛰고 첫 응답 줄부터 보여준다.
        body = [l for l in lines if row["prompt"][:12] not in l]
        head = SECRETISH.sub("sk-***", " ".join(body))[:150]
        print(f"{row['seq']:>2} {row['id']:<8} {'새' if row['newSession'] else '잇'} "
              f"{row['totalMs']:>6}ms | {head}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
