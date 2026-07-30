#!/usr/bin/env python3
"""비교 실행표의 단일 정본 로더와 무과금 정합성 검사."""
from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path


def load_contract(here: Path) -> tuple[dict, dict]:
    scenarios = json.loads((here / "h-scenarios.json").read_text(encoding="utf-8"))
    schedule = json.loads((here / "h-branches.json").read_text(encoding="utf-8"))
    prompts = scenarios.get("prompts")
    if not isinstance(prompts, dict) or not prompts:
        raise ValueError("h-scenarios.json prompts가 비었다")

    resolved = deepcopy(schedule)
    seen_seq: set[int] = set()
    for branch in resolved.get("branches", []):
        for turn in branch.get("turns", []):
            if "prompt" in turn:
                raise ValueError(f"{turn.get('id')}: 실행표에 원문을 다시 쓰지 않는다")
            ref = turn.get("promptRef")
            if not isinstance(ref, str) or ref not in prompts:
                raise ValueError(f"{turn.get('id')}: 알 수 없는 promptRef {ref!r}")
            seq = turn.get("seq")
            if not isinstance(seq, int) or seq in seen_seq:
                raise ValueError(f"턴 번호가 없거나 중복이다: {seq!r}")
            seen_seq.add(seq)
            turn["prompt"] = prompts[ref]

    total = sum(len(b.get("turns", [])) for b in resolved.get("branches", []))
    if total != resolved.get("turnsPerRun"):
        raise ValueError(f"분기표 턴 합계 {total} != 선언 {resolved.get('turnsPerRun')}")
    if seen_seq != set(range(1, total + 1)):
        raise ValueError(f"턴 번호가 연속이 아니다: {sorted(seen_seq)}")
    return scenarios, resolved


def active_doc_errors(repo: Path) -> list[str]:
    checks = {
        repo / "docs/03-verification/T5-TCELL-PRESTART-BRIEFING-2026-07-30-ko.md":
            ("회차당 14턴", "h-turns.json"),
        repo / "docs/03-verification/T5-TCELL-CURRENT-CORE-HUMAN-BASELINE-2026-07-30-ko.md":
            ("회차당 14턴", "h-turns.json"),
    }
    errors: list[str] = []
    for path, forbidden in checks.items():
        text = path.read_text(encoding="utf-8")
        for needle in forbidden:
            if needle in text:
                errors.append(f"{path.name}: 폐기된 현재 사실 {needle!r}")
    return errors


def verify_contract(here: Path, repo: Path) -> list[str]:
    errors: list[str] = []
    try:
        scenarios, schedule = load_contract(here)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return [str(exc)]

    prompts = scenarios["prompts"]
    expected = {
        "H02.month7": "7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.",
        "H02.month10.newChat": "10월 것도. 1600 / 1000 / 신규 12 / 이탈 4",
        "H10.delegate": (
            "Developer 폴더의 프로젝트들을 폴더별로 나눠서 조사하고, 각각 뭐 하는 건지 알아낸 다음 "
            "하나의 비교 보고서로 합쳐줘. 여러 갈래로 나눠서 해도 돼."
        ),
    }
    for ref, value in expected.items():
        if prompts.get(ref) != value:
            errors.append(f"{ref}: 봉인 기준선 원문과 다르다")

    refs = [
        turn["promptRef"]
        for branch in schedule["branches"]
        for turn in branch["turns"]
    ]
    for ref in expected:
        if ref not in refs:
            errors.append(f"{ref}: 실행표가 정본 원문을 소비하지 않는다")

    errors.extend(active_doc_errors(repo))
    return errors


def main() -> int:
    here = Path(__file__).resolve().parent
    repo = here.parent.parent
    errors = verify_contract(here, repo)
    if errors:
        for error in errors:
            print(f"FAIL · {error}")
        return 1
    _, schedule = load_contract(here)
    print(
        "COMPARE LIVE CONTRACT: PASS "
        f"({len(schedule['branches'])} branches, {schedule['turnsPerRun']} turns)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
