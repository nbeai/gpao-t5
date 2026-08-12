#!/usr/bin/env python3
"""회차 하나의 **구조 유효성**을 기계로 검사한다.

왜: 지난 회차는 사람이 눈으로 훑어 통과시켰고, 대상·사전 상태·독립성이 틀린 걸 뒤늦게 감사가
잡았다. 그래서 감사 종료 조건을 코드로 옮긴다. 이 검사가 FAIL 이면 그 회차는 판정에 쓰지 않는다.

응답 내용의 좋고 나쁨은 판정하지 않는다. 판정 재료가 **성립하는지**만 본다.

    python3 verify_run.py v2-run-1
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)
sys.path.insert(0, str(HERE))
from compare_contract import load_contract  # noqa: E402

FAKE_KEY = "sk-test-FAKE-NOT-A-REAL-KEY-000000000000"
SECRETISH = re.compile(r"sk-[A-Za-z0-9_-]{20,}")

fails: list[str] = []
notes: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    (notes if ok else fails).append(f"{'PASS' if ok else 'FAIL'} · {label}{' — ' + detail if detail else ''}")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = HERE / sys.argv[1]
    _, spec = load_contract(HERE)
    turns_path = root / "turns.jsonl"

    if not turns_path.exists():
        print(f"FAIL · 턴 기록 없음: {turns_path}")
        return 1
    rows = [json.loads(l) for l in turns_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    # 1. 턴 수와 번호
    check(len(rows) == spec["turnsPerRun"], "턴 수",
          f"{len(rows)}/{spec['turnsPerRun']}")
    seqs = [r["seq"] for r in rows]
    check(len(set(seqs)) == len(seqs), "턴 번호 중복 없음")
    expected_rows = {
        turn["seq"]: (branch["id"], turn)
        for branch in spec["branches"]
        for turn in branch["turns"]
    }
    runtime_drift = []
    for row in rows:
        expected = expected_rows.get(row["seq"])
        if expected is None:
            runtime_drift.append((row["seq"], "unknown_seq"))
            continue
        branch_id, turn = expected
        fields = {
            "branch": branch_id,
            "id": turn["id"],
            "session": turn["session"],
            "prompt": turn["prompt"],
            "promptStatus": turn["promptStatus"],
            "promptSource": turn["promptSource"],
        }
        for field, value in fields.items():
            if row.get(field) != value:
                runtime_drift.append((row["seq"], field))
    check(not runtime_drift, "실행 영수증의 21턴 원문·출처·분기가 정본과 전부 일치한다",
          str(runtime_drift))

    # 2. 분기별 홈이 서로 다르고 실제로 생겼는가 (조건 1·2·3)
    homes = {r["branch"]: r["home"] for r in rows}
    check(len(set(homes.values())) == len(homes), "분기마다 홈이 다르다",
          f"{len(set(homes.values()))}개 홈 / {len(homes)}개 분기")
    for br, home in homes.items():
        d = root / home
        check(d.is_dir() and any(d.iterdir()), f"{br} 홈이 남아 있다", str(d))

    # 3. H04 의 취소 대상이 H01 인가 (조건 2)
    for r in rows:
        if r["id"] != "H04":
            continue
        same = [x for x in rows if x["branch"] == r["branch"] and x["session"] == r["session"]]
        same.sort(key=lambda x: x["seq"])
        idx = [x["seq"] for x in same].index(r["seq"])
        prev = same[idx - 1] if idx > 0 else None
        check(prev is not None and prev["id"] == "H01",
              "H04 의 직전 턴이 H01 이다",
              f"직전={prev['id'] if prev else '없음'}")
        # 같은 대화에 H03 이 섞이지 않았는가
        check(all(x["id"] != "H03" for x in same),
              "H04 대화에 H03 이 없다")

    # 4. H06 이 선호 저장 뒤에 왔는가 (조건 3)
    for r in rows:
        if r["id"] != "H06":
            continue
        same = [x for x in rows if x["branch"] == r["branch"] and x["session"] == r["session"]]
        earlier = [x for x in same if x["seq"] < r["seq"]]
        check(any(x["id"] == "H01" for x in earlier),
              "H06 앞에 H01 이 있다",
              f"앞선 턴={[x['id'] for x in earlier]}")

    # 5. H02 분기에 선호 저장 턴이 섞이지 않았는가 (조건 1: 기억 0 에서 시작)
    learn = [r for r in rows if r["branch"].startswith("B1")]
    check(learn and all(r["id"].startswith("H02") for r in learn),
          "H02 분기에 다른 시나리오가 없다",
          f"{[r['id'] for r in learn]}")

    # 6. H08→H09 같은 대화, H10 은 다른 분기 (조건 4)
    h8 = next((r for r in rows if r["id"] == "H08"), None)
    h9 = next((r for r in rows if r["id"] == "H09"), None)
    h10 = next((r for r in rows if r["id"] == "H10"), None)
    check(bool(h8 and h9) and (h8["branch"], h8["session"]) == (h9["branch"], h9["session"]),
          "H08 과 H09 가 같은 대화다")
    check(bool(h10 and h8) and h10["branch"] != h8["branch"],
          "H10 이 별도 분기다")

    # 6.5 실패·시간초과 턴이 섞인 회차는 판정 재료가 아니다 (감사 P1-1)
    bad = [(r["seq"], "timeout") for r in rows if r.get("timedOut") is True]
    bad += [(r["seq"], f"exit={r['exitCode']}") for r in rows
            if r.get("exitCode") not in (0, None)]
    bad += [(r["seq"], "제품 사망") for r in rows if r.get("alive") is False]
    check(not bad, "실패·시간초과·제품 사망 턴이 없다", str(bad))

    # 7. H05 재시작 승계가 실제로 재시작을 거쳤는가 (조건 5 · 감사 P1-3)
    #    실행표 불리언 복사가 아니라 실행 증거를 요구한다:
    #    PTY 회차는 resumedFrom(디스크에서 확인된 --resume 대상),
    #    CLI 회차는 제품이 보고한 session identity 의 전후 일치.
    rst = next((r for r in rows if r["id"] == "H05-restart"), None)
    check(bool(rst) and rst.get("restarted") is True,
          "H05 재시작 턴이 재시작을 기록했다")
    if rst:
        ev = rst.get("restartEvidence")
        if rst.get("resumedFrom"):
            notes.append(f"INFO · H05 재시작 증거: --resume {rst['resumedFrom']}")
        elif ev is not None:
            check(bool(ev.get("expectedSessionId")) and bool(ev.get("gotSessionId"))
                  and ev["expectedSessionId"] == ev["gotSessionId"],
                  "H05 재시작 전후의 제품 session identity 가 일치한다", str(ev))
        else:
            check(False, "H05 재시작 증거가 없다",
                  "resumedFrom 도 restartEvidence 도 없음 — 실행표 복사만으로는 인정하지 않는다")
    new = next((r for r in rows if r["id"] == "H05-new"), None)
    work = next((r for r in rows if r["id"] == "H05-work"), None)
    seeds = [r for r in rows if r["id"] == "H05-restart-seed"]
    check(bool(new and work) and new["branch"] == work["branch"]
          and new["session"] != work["session"],
          "H05 새 대화가 작업 대화와 다른 세션이다")
    check(len(seeds) == 3 and bool(rst)
          and all(seed["branch"] == rst["branch"]
                  and seed["session"] == rst["session"] for seed in seeds),
          "H05 재시작이 봉인 기준선의 숫자 정리 대화를 재개했다")

    # 8. 영수증: 세션 ID·fixture 정확 경로 (조건 7·8)
    rc_path = root / "receipt.json"
    check(rc_path.exists(), "영수증이 있다")
    if rc_path.exists():
        rc = json.loads(rc_path.read_text(encoding="utf-8"))
        check(bool(rc.get("branches")), "영수증에 분기별 세션 ID 가 있다")
        aborted = rc.get("abortedBranches") or []
        check(not aborted, "중단된 분기가 없다", str(aborted))
        man = rc.get("fixtureManifest") or []
        man_paths = [m.get("path") if isinstance(m, dict) else m for m in man]
        rem = rc.get("fixtureRemoved") or []
        preserved = rc.get("fixturePreserved") or []
        outcomes = rc.get("fixtureOutcomes") or []
        outcome_paths = [item.get("path") for item in outcomes]
        unsafe = [item for item in outcomes
                  if item.get("disposition") == "unsafe_cleanup_failure"]
        check(sorted(man_paths) == sorted(outcome_paths),
              "모든 fixture가 삭제 또는 제품 행동 증거로 정확히 한 번 정산된다",
              f"manifest {len(man_paths)} / outcomes {len(outcome_paths)}")
        check(not unsafe, "fixture 정리 자체의 실패가 없다", str(unsafe))
        changed = [item for item in outcomes if item.get("reason") != "fixture_unchanged"]
        if changed:
            notes.append("INFO · 제품의 fixture 변경·삭제·교체 행동: "
                         + json.dumps(changed, ensure_ascii=False))
        prod = rc.get("productCreated") or []
        if prod:
            notes.append(f"INFO · 제품이 만든 파일 {len(prod)}건 (지우지 않고 보고): " + ", ".join(prod))

    # 9. 시간 수치가 표면별로 표기됐는가 (조건 9)
    check(all("surfaceNote" in r for r in rows), "시간 수치에 표면 주석이 붙어 있다")
    check(all("firstOutputMs" not in r for r in rows),
          "T5 와 같은 이름의 시간 칸이 없다")
    pty_rows = [r for r in rows if "transcript" in r]
    check(all(r.get("completionEvidence") == "working_prompt_to_idle_prompt"
              for r in pty_rows),
          "Hermes 턴마다 제품 완료 신호가 있다")

    # 10. 비밀 유출: 기록의 sk- 문자열은 시험용 가짜뿐인가
    #     (PTY 회차는 transcript, CLI 회차는 stdout/stderr 에 대화가 있다 — 셋 다 본다)
    leaked = []
    for r in rows:
        for field in ("transcript", "stdout", "stderr"):
            for hit in SECRETISH.findall(r.get(field) or ""):
                if hit != FAKE_KEY:
                    leaked.append((r["seq"], field, hit[:6] + "…"))
    check(not leaked, "기록에 시험용 가짜 외의 키 문자열이 없다", str(leaked))

    # 11. 사람 판정 칸이 비어 있음을 숨기지 않는가
    unjudged = sum(1 for r in rows if r.get("goal") is None)
    notes.append(f"INFO · 사람 판정 대기 {unjudged}/{len(rows)}턴")

    print(f"== 구조 검증: {root.name} ==")
    for line in notes:
        print(" ", line)
    for line in fails:
        print(" ", line)
    print(f"\n판정: {'VALID' if not fails else f'INVALID ({len(fails)}건)'}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
