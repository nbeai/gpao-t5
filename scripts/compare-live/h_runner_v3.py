#!/usr/bin/env python3
"""비교군 H01~H10 라이브 계측기 v3 — Hermes 전용, `SessionHost` 위에서 돈다.

v2 가 차단된 이유(다중 writer): 세션을 분기 끝에서야 닫아 같은 홈에 s1·s2 가 동시에 살았다.
v3 는 닫는 것을 잊을 수 없다 — `SessionHost` 가 홈당 살아있는 세션을 하나로 강제하고,
다음 세션을 열려면 이전 세션의 **종료 증명**이 먼저다. 규칙이 아니라 자료구조다.

v2 대비 달라진 것:

1. 세션 전환(같은 분기의 s1→s2, 재시작)은 `host.close()` 성공 뒤에만 `host.open()` 한다.
   close 는 정상 종료 → SIGTERM → SIGKILL 을 거치고 잔여 프로세스 0 을 확인하지 못하면 예외다.
2. 재시작 승계(H05-restart)는 **세션 ID 가 없으면 잴 수 없다** — 새 대화를 열어 재시작으로
   기록하는 대신 그 분기를 중단하고 기록한다. (감사가 잡은 v2 결함)
3. 턴 시간 초과는 판정 재료의 턴 경계를 깨뜨리므로 그 분기를 중단한다. 홈이 분리돼 있어
   다른 분기의 유효성은 유지된다.
4. 턴 전마다 이 홈의 제품 프로세스가 정확히 1개인지 OS 에게 직접 묻는다.

실행 순서: `preflight.py` 증명이 감사를 통과한 뒤에만 유료 회차를 실행한다.

사용:
    python3 h_runner_v3.py --run 1 --dry-run
    python3 h_runner_v3.py --run 1 --model gpt-5.1
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compare_contract import load_contract  # noqa: E402
from fixture_ownership import chmod_owned, cleanup_owned, create_owned  # noqa: E402
from session_lifecycle import (  # noqa: E402
    USER_HOME, SessionHost, count_product_processes, disk_session_ids,
)

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)
SECRET = HERE / "secret-env.sh"
LOCK = HERE / "run.lock"
DOWNLOADS = Path.home() / "Downloads"

# fixture 는 이 정확한 세 경로뿐이다. 정리도 이 목록과 영수증의 정확한 경로만 지운다.
FIXTURES = {
    "견적서_A사_v1.csv": "품목,수량,단가\n모니터,2,320000\n키보드,3,45000\n",
    "견적서_A사_최종.csv": "품목,수량,단가\n모니터,2,310000\n키보드,3,42000\n마우스,3,28000\n",
    "견적서_B사_v1.csv": "품목,수량,단가\n모니터,1,350000\n",
}
LOCKED = "견적서_A사_최종.csv"

COMPLETION_STABLE_S = 4.0
TURN_TIMEOUT_S = 240.0


class BranchAbort(RuntimeError):
    """이 분기의 판정 재료가 더는 성립하지 않는다. 홈이 분리돼 있어 다음 분기는 유효하다."""


# ── fixture: 정확한 경로만 만들고, 정확한 경로만 지운다 ────────────────────────
# 감사 P0-2: 정확한 경로 규율은 glob 오삭제만 막는다. 같은 이름의 **기존 사용자 파일**은
# 생성 전 존재 검사(배타 생성)로 지키고, 삭제 전에는 스냅샷을 남긴다.
def fixture_collision() -> list[str]:
    """이미 존재하는 fixture 경로. 하나라도 있으면 회차를 시작하지 않는다."""
    return [str(DOWNLOADS / name) for name in FIXTURES if (DOWNLOADS / name).exists()]


def fixture_record(records: list[dict], name: str) -> dict:
    path = str(DOWNLOADS / name)
    found = next((r for r in records if r["path"] == path), None)
    if found is None:
        raise RuntimeError(f"소유권 기록이 없는 fixture: {path}")
    return found


def downloads_listing() -> set[str]:
    try:
        return {p.name for p in DOWNLOADS.iterdir()}
    except OSError:
        return set()


# ── 한 턴: 제품이 작업 상태에서 입력 가능 상태로 돌아올 때까지 걷는다 ─────────
def ask(session, prompt: str, timeout_s: float = TURN_TIMEOUT_S) -> dict:
    mark = len(session.buf)
    t0 = time.monotonic()
    session.write(prompt)
    first_out = None
    longest_gap = 0.0
    last_at = t0
    timed_out = False
    completion_seen = False
    while True:
        got = session.drain()
        now = time.monotonic()
        if got:
            if first_out is None:
                first_out = now
            longest_gap = max(longest_gap, now - last_at)
            last_at = now
        if session.proc.poll() is not None:
            break
        completion_seen = completion_seen or session.turn_completion_observed(mark)
        if completion_seen and now - last_at >= COMPLETION_STABLE_S:
            session.ready = True
            break
        if now - t0 > timeout_s:
            timed_out = True
            break
        time.sleep(0.1)
    t1 = time.monotonic()
    return {
        # 표면별 의미가 다르다. T5 UI 수치와 나란히 놓지 않는다.
        "surfaceFirstPaintMs": None if first_out is None else round((first_out - t0) * 1000),
        "surfaceQuietGapMs": round(longest_gap * 1000),
        "surfaceNote": "PTY: 입력 에코가 즉시 보이고 스피너가 공백을 메운다",
        "totalMs": round((t1 - t0) * 1000),
        "transcript": session.text(mark),
        "timedOut": timed_out,
        "alive": session.proc.poll() is None,
        "completionEvidence": (
            "working_prompt_to_idle_prompt"
            if completion_seen else "not_observed"
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=int, default=1)
    ap.add_argument("--model", default="gpt-5.1")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _, spec = load_contract(HERE)
    branches = spec["branches"]
    total = sum(len(b["turns"]) for b in branches)
    if total != spec["turnsPerRun"]:
        print(f"분기표 불일치: {total}턴 vs {spec['turnsPerRun']} 선언", file=sys.stderr)
        return 2
    if not args.dry_run:
        clash = fixture_collision()
        if clash:
            print("Downloads 에 같은 이름의 기존 파일이 있다 — 덮어쓰지 않는다:\n  "
                  + "\n  ".join(clash), file=sys.stderr)
            return 3
    if not args.dry_run and not SECRET.exists():
        print("자격 파일이 없다. 키 입력 창을 먼저 실행하라.", file=sys.stderr)
        return 2

    print(f"[Hermes 대화형 v3·SessionHost] 회차 {args.run} · {total}턴 · {args.model}"
          + (" · DRY RUN" if args.dry_run else ""))

    if args.dry_run:
        # 부작용 0: 파일도 프로세스도 만들지 않는다. 일정만 보여준다.
        for br in branches:
            print(f"\n── {br['id']}  home={br['home']}  ({br['purpose']})")
            for step in br.get("fixture", []):
                print(f"     fixture:{step}")
            live: str | None = None
            for t in br["turns"]:
                for step in t.get("setup", []):
                    print(f"     {step}")
                key = t["session"]
                if t.get("restartBefore"):
                    tag = f"{live} 종료증명 → 재시작 --resume"
                elif key != live:
                    tag = (f"{live} 종료증명 → 새 대화" if live else "새 대화")
                else:
                    tag = "이어서"
                live = key
                print(f"  {t['seq']:>2} {t['id']:<13} {key} {tag:<24} "
                      f"{(t.get('role') or t.get('measure') or '')[:40]}")
        print("\nDRY RUN 종료 — 만든 파일 0, 띄운 프로세스 0")
        return 0

    # 회차 lock: 한 시점에 한 회차.
    try:
        fd = os.open(str(LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, f"run={args.run} pid={os.getpid()} runner=v3\n".encode())
        os.close(fd)
    except FileExistsError:
        print(f"다른 회차가 실행 중이다: {LOCK.read_text().strip()}", file=sys.stderr)
        return 3

    runroot = HERE / f"hm-run-{args.run}"
    out = runroot / "turns.jsonl"
    receipt: dict = {"product": "Hermes(대화형 PTY)", "run": args.run,
                     "model": args.model, "userHome": str(USER_HOME),
                     "workingDirectory": str(USER_HOME),
                     "branches": [], "abortedBranches": []}
    manifest: list[dict] = []
    before = downloads_listing()
    runroot_created = False

    try:
        if runroot.exists():
            print(f"기존 산출물이 있다 — 덮어쓰지 않는다: {runroot}", file=sys.stderr)
            return 3
        runroot.mkdir(parents=True)
        runroot_created = True
        out.write_text("", encoding="utf-8")

        for br in branches:
            home = runroot / br["home"]
            home.mkdir(parents=True, exist_ok=True)
            host = SessionHost(home, args.model, SECRET if SECRET.exists() else None)
            print(f"\n── {br['id']}  home={br['home']}  ({br['purpose']})")

            for step in br.get("fixture", []):
                if step == "make":
                    manifest.extend(create_owned(
                        DOWNLOADS, FIXTURES, runroot / "fixture-anchors"))
                    print(f"     fixture make → {len(FIXTURES)}개")
                elif step == "unlock":
                    if not chmod_owned(fixture_record(manifest, LOCKED), 0o644):
                        raise RuntimeError("잠금 해제 대상의 fixture 신분이 바뀌었다")

            ids: dict[str, str | None] = {}
            live: str | None = None

            def close_and_record(label: str) -> None:
                # 종료하면 반드시 디스크 ID 를 기록한다 — 경로별로 기억하는 규칙이 아니라
                # 종료 지점 하나에 붙은 구조다. (회차 1 실측: 같은 세션 재시작(B8)이
                # 전환 경로에만 있던 캡처를 비켜가 분기가 중단됐다.)
                host.close(label)
                ids[label] = ids.get(label) or next(iter(disk_session_ids(home)), None)

            try:
                for t in br["turns"]:
                    for step in t.get("setup", []):
                        if step == "fixture:lock":
                            if not chmod_owned(fixture_record(manifest, LOCKED), 0o000):
                                raise BranchAbort("잠금 대상의 fixture 신분이 바뀌었다")

                    key = t["session"]
                    restarted = False
                    resumed_from = None
                    if t.get("restartBefore"):
                        # 재시작 승계: 이전 세션들을 종료 증명하고, 원 대화의 ID 로만 재개한다.
                        # ID 는 화면 스크래핑이 아니라 디스크 진실이다(TUI 박스는 옆 칸을 잡는다).
                        if live is not None:
                            close_and_record(live)
                            live = None
                        sid = ids.get(key)
                        if not sid:
                            raise BranchAbort(
                                f"{t['id']}: 원 대화 세션 ID 가 디스크에 없다 — 재시작 승계를 잴 수 없다")
                        host.open(f"{key}-resumed", resume=sid)
                        live = key
                        restarted = True
                        resumed_from = sid
                        print(f"     제품 재시작 → --resume {sid}")
                    elif key != live:
                        if live is not None:
                            close_and_record(live)
                        host.open(key)
                        live = key

                    # 턴 전: 이 홈의 제품 프로세스는 정확히 1개여야 한다.
                    n = count_product_processes(home)
                    if n != 1:
                        raise BranchAbort(f"{t['id']}: 턴 전 프로세스 {n}개 (정확히 1이어야 한다)")

                    m = ask(host.live, t["prompt"],
                            timeout_s=float(t.get("timeoutS", TURN_TIMEOUT_S)))
                    rec = {
                        "run": args.run, "branch": br["id"], "home": br["home"],
                        "seq": t["seq"], "id": t["id"], "session": key,
                        "restarted": restarted,
                        # 재시작 증거: 실행표 복사가 아니라 실제 --resume 대상(디스크 ID)
                        "resumedFrom": resumed_from,
                        "role": t.get("role"), "prompt": t["prompt"],
                        "promptStatus": t["promptStatus"],
                        "promptSource": t["promptSource"],
                        "measure": t.get("measure"),
                        **m,
                        # 사람이 채운다. 자동 판정하지 않는다.
                        "goal": None, "unnecessaryQuestions": None,
                        "approvals": None, "agentDelegation": None,
                    }
                    with out.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    print(f"  {rec['seq']:>2} {rec['id']:<13} {key} "
                          f"{'재시작' if restarted else '     '} 총={rec['totalMs']}ms"
                          + (" [시간초과]" if rec["timedOut"] else ""))

                    if m["timedOut"]:
                        raise BranchAbort(f"{t['id']}: 턴 시간 초과 — 턴 경계가 깨졌다")
                    if not m["alive"]:
                        raise BranchAbort(f"{t['id']}: 턴 중 제품이 죽었다")
            except BranchAbort as e:
                print(f"     ! 분기 중단: {e}")
                receipt["abortedBranches"].append({"id": br["id"], "reason": str(e)})
            finally:
                if live is not None:
                    close_and_record(live)
                    live = None
                left = count_product_processes(home)
                if left != 0:
                    # 다중 writer 를 다음 분기로 넘기지 않는다.
                    raise RuntimeError(f"{br['id']}: 분기 종료 뒤 프로세스 {left}개 잔존")

            receipt["branches"].append(
                {"id": br["id"], "home": br["home"], "sessionIds": ids,
                 "lifecycle": host.history})
    finally:
        if runroot_created:
            if manifest:
                locked = fixture_record(manifest, LOCKED)
                chmod_owned(locked, 0o644)
            removed, preserved, outcomes = cleanup_owned(
                manifest, runroot / "fixtures-final")
            after = downloads_listing()
            new_files = sorted(after - before)
            receipt["fixtureManifest"] = manifest
            receipt["fixtureRemoved"] = removed
            receipt["fixturePreserved"] = preserved
            receipt["fixtureOutcomes"] = outcomes
            # 제품이 만든 파일은 지우지 않고 정확한 경로로 보고한다.
            receipt["productCreated"] = [str(DOWNLOADS / n) for n in new_files]
            (runroot / "receipt.json").write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"\nfixture 삭제 {len(removed)}건")
            if new_files:
                print("제품이 만든 파일 (지우지 않았다. 정확한 경로로 보고한다):")
                for n in new_files:
                    print(f"  {DOWNLOADS / n}")
            print(f"기록: {out}\n영수증: {runroot / 'receipt.json'}")
        LOCK.unlink(missing_ok=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
