#!/usr/bin/env python3
"""비교 실행표의 단일 정본 로더와 무과금 정합성 검사."""
from __future__ import annotations

import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path

SEALED_PROMPT_MAP_SHA256 = "75f5d6ee3bf2bfc4cf51234523dfb2ce5da0e47c41a01ca7c17b49240959d289"
ALLOWED_PROVENANCE_STATUS = {"sealed", "extension"}


def prompt_map_digest(prompts: dict) -> str:
    raw = json.dumps(
        prompts, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_contract(here: Path) -> tuple[dict, dict]:
    scenarios = json.loads((here / "h-scenarios.json").read_text(encoding="utf-8"))
    schedule = json.loads((here / "h-branches.json").read_text(encoding="utf-8"))
    prompts = scenarios.get("prompts")
    if not isinstance(prompts, dict) or not prompts:
        raise ValueError("h-scenarios.json prompts가 비었다")
    provenance = scenarios.get("provenance")
    if not isinstance(provenance, dict) or set(provenance) != set(prompts):
        raise ValueError("모든 원문에 정확히 하나의 provenance가 있어야 한다")
    for ref, item in provenance.items():
        if not isinstance(item, dict) or item.get("status") not in ALLOWED_PROVENANCE_STATUS:
            raise ValueError(f"{ref}: provenance status가 없거나 잘못됐다")
        if not isinstance(item.get("source"), str) or not item["source"].strip():
            raise ValueError(f"{ref}: provenance source가 비었다")
    actual_digest = prompt_map_digest(prompts)
    if actual_digest != SEALED_PROMPT_MAP_SHA256:
        raise ValueError(
            "H01~H10 전체 원문 정본 해시 불일치: "
            f"{actual_digest} != {SEALED_PROMPT_MAP_SHA256}"
        )

    resolved = deepcopy(schedule)
    seen_seq: set[int] = set()
    used_refs: list[str] = []
    for branch in resolved.get("branches", []):
        for turn in branch.get("turns", []):
            if "prompt" in turn:
                raise ValueError(f"{turn.get('id')}: 실행표에 원문을 다시 쓰지 않는다")
            ref = turn.get("promptRef")
            if not isinstance(ref, str) or ref not in prompts:
                raise ValueError(f"{turn.get('id')}: 알 수 없는 promptRef {ref!r}")
            used_refs.append(ref)
            seq = turn.get("seq")
            if not isinstance(seq, int) or seq in seen_seq:
                raise ValueError(f"턴 번호가 없거나 중복이다: {seq!r}")
            seen_seq.add(seq)
            turn["prompt"] = prompts[ref]
            turn["promptStatus"] = provenance[ref]["status"]
            turn["promptSource"] = provenance[ref]["source"]

    total = sum(len(b.get("turns", [])) for b in resolved.get("branches", []))
    if total != resolved.get("turnsPerRun"):
        raise ValueError(f"분기표 턴 합계 {total} != 선언 {resolved.get('turnsPerRun')}")
    if seen_seq != set(range(1, total + 1)):
        raise ValueError(f"턴 번호가 연속이 아니다: {sorted(seen_seq)}")
    unused = sorted(set(prompts) - set(used_refs))
    if unused:
        raise ValueError(f"실행표가 소비하지 않는 정본 원문: {unused}")
    return scenarios, resolved


def active_doc_errors(repo: Path) -> list[str]:
    checks = {
        repo / "docs/03-verification/T5-TCELL-PRESTART-BRIEFING-2026-07-30-ko.md":
            ("회차당 14턴", "회차당 18턴", "h-turns.json"),
        repo / "docs/03-verification/T5-TCELL-CURRENT-CORE-HUMAN-BASELINE-2026-07-30-ko.md":
            ("회차당 14턴", "회차당 18턴", "h-turns.json"),
    }
    errors: list[str] = []
    for path, forbidden in checks.items():
        text = path.read_text(encoding="utf-8")
        for needle in forbidden:
            if needle in text:
                errors.append(f"{path.name}: 폐기된 현재 사실 {needle!r}")
        if "회차당 21턴" not in text:
            errors.append(f"{path.name}: 현재 정본 '회차당 21턴'이 없다")
    return errors


def verify_contract(here: Path, repo: Path) -> list[str]:
    errors: list[str] = []
    try:
        scenarios, schedule = load_contract(here)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return [str(exc)]

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
