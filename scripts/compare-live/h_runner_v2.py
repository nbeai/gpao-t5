#!/usr/bin/env python3
"""비교군 H01~H10 라이브 계측기 v2 — 오염 판정 뒤 재설계판.

무엇이 달라졌나(감사 종료 조건 1~9):

1. 분기마다 **홈을 따로 둔다.** 앞 분기의 기억이 다음 분기의 사전 상태를 바꾸지 못한다.
2. `H01 → H03` 과 `H01 → H04` 를 **다른 홈·다른 대화**로 나눈다. H04 의 `방금 건`이 H01 을 가리킨다.
3. H06 은 **선호가 저장된 뒤** 묻는다.
4. H08→H09 는 같은 파일 대화, H10 은 별도 분기.
5. H05 는 작업 대화 → 새 대화 → **실제 제품 재시작** → 원 대화 재개.
6. 회차 **lock**: 한 시점에 한 회차, 한 홈에 한 writer.
7. 산출물은 **홈 삭제 전에** 스냅샷한다. 회차 홈은 지우지 않고 남긴다.
8. 정리는 **manifest 의 정확한 경로**만 지운다. glob 으로 넓히지 않는다.
9. 표면 시간은 `surface*` 로 따로 적는다. T5 UI 수치와 나란히 놓지 않는다.

사용:
    python3 h_runner_v2.py --run 1 --dry-run
    python3 h_runner_v2.py --run 1 --model gpt-5.1
"""
from __future__ import annotations

import argparse
import json
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)
CWD = "/Users/jyp/Developer/lab_un/hermes-agent"
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

QUIET_S = 4.0
TURN_TIMEOUT_S = 240.0
READY_TIMEOUT_S = 60.0

_ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]")
_SESSION_ID = re.compile(r"Session:\s*(\S+)")


def strip_ansi(raw: bytes) -> str:
    text = _ANSI.sub(b"", raw).decode("utf-8", "replace").replace("\r", "\n")
    return "\n".join(ln.rstrip() for ln in text.split("\n") if ln.strip())


# ── fixture: 정확한 경로만 만들고, 정확한 경로만 지운다 ────────────────────────
def fixture_make() -> list[str]:
    made = []
    for name, body in FIXTURES.items():
        p = DOWNLOADS / name
        p.write_text(body, encoding="utf-8")
        made.append(str(p))
    return made


def fixture_lock() -> None:
    (DOWNLOADS / LOCKED).chmod(0o000)


def fixture_unlock() -> None:
    p = DOWNLOADS / LOCKED
    if p.exists():
        p.chmod(0o644)


def fixture_clean(manifest: list[str]) -> tuple[list[str], list[str]]:
    """manifest 의 정확한 경로만 지운다. 그 밖에 새로 생긴 파일은 지우지 않고 보고한다."""
    fixture_unlock()
    removed, kept = [], []
    for path in manifest:
        p = Path(path)
        if p.exists():
            p.unlink()
            removed.append(path)
    return removed, kept


def downloads_listing() -> set[str]:
    try:
        return {p.name for p in DOWNLOADS.iterdir()}
    except OSError:
        return set()


# ── 대화 하나 = PTY 하나 = 프로세스 하나 ───────────────────────────────────────
class Session:
    def __init__(self, home: Path, model: str, resume: str | None = None) -> None:
        cmd = f"exec ./.venv/bin/hermes --cli -m {model} --provider openai-api"
        if resume:
            cmd = (f"exec ./.venv/bin/hermes --cli -m {model} --provider openai-api "
                   f"--resume {resume} --no-restore-cwd")
        inner = ("set -a; "
                 + (f". '{SECRET}'; " if SECRET.exists() else "")
                 + f"export HERMES_HOME='{home}'; " + cmd)
        self.master, slave = pty.openpty()
        os.set_blocking(self.master, False)
        self.proc = subprocess.Popen(
            ["bash", "-c", inner], cwd=CWD,
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
        )
        os.close(slave)
        self.buf = bytearray()
        self.session_id: str | None = resume

    def _drain(self) -> int:
        got = 0
        while True:
            r, _, _ = select.select([self.master], [], [], 0)
            if not r:
                return got
            try:
                chunk = os.read(self.master, 65536)
            except (BlockingIOError, OSError):
                return got
            if not chunk:
                return got
            self.buf.extend(chunk)
            got += len(chunk)

    def wait_ready(self) -> None:
        t0 = time.monotonic()
        while time.monotonic() - t0 < READY_TIMEOUT_S:
            if self._drain():
                time.sleep(1.5)
                self._drain()
                return
            time.sleep(0.1)

    def ask(self, prompt: str) -> dict:
        mark = len(self.buf)
        t0 = time.monotonic()
        os.write(self.master, (prompt + "\n").encode())
        first_out = None
        longest_gap = 0.0
        last_at = t0
        while True:
            got = self._drain()
            now = time.monotonic()
            if got:
                if first_out is None:
                    first_out = now
                longest_gap = max(longest_gap, now - last_at)
                last_at = now
            if self.proc.poll() is not None:
                break
            if first_out is not None and now - last_at >= QUIET_S:
                break
            if now - t0 > TURN_TIMEOUT_S:
                break
            time.sleep(0.1)
        t1 = time.monotonic()
        return {
            # 표면별 의미가 다르다. T5 UI 수치와 나란히 놓지 않는다.
            "surfaceFirstPaintMs": None if first_out is None else round((first_out - t0) * 1000),
            "surfaceQuietGapMs": round(longest_gap * 1000),
            "surfaceNote": "PTY: 입력 에코가 즉시 보이고 스피너가 공백을 메운다",
            "totalMs": round((t1 - t0) * 1000),
            "transcript": strip_ansi(bytes(self.buf[mark:])),
            "timedOut": (t1 - t0) > TURN_TIMEOUT_S,
            "alive": self.proc.poll() is None,
        }

    def close(self) -> str | None:
        """정상 종료시키고, 제품이 알려주는 세션 ID 를 돌려준다."""
        mark = len(self.buf)
        if self.proc.poll() is None:
            try:
                os.write(self.master, b"/exit\n")
            except OSError:
                pass
            for _ in range(60):
                self._drain()
                if self.proc.poll() is not None:
                    break
                time.sleep(0.25)
        if self.proc.poll() is None:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
        self._drain()
        tail = strip_ansi(bytes(self.buf[mark:]))
        m = _SESSION_ID.search(tail)
        if m:
            self.session_id = m.group(1)
        try:
            os.close(self.master)
        except OSError:
            pass
        return self.session_id


# ── 실행 차단 ────────────────────────────────────────────────────────────────
# 이 판은 **다중 writer 결함이 있다.** 세션을 분기 끝에서야 닫아(아래 `finally` 의 close 묶음)
# B1·B7 에서 같은 홈에 s1·s2 가 동시에 살아 있었고, 감사가 회차를 무효 판정했다.
# 홈만 나누고 writer 수를 안 나눈 반쪽 수정이었다.
#
# 판정 재료·감사 대조용으로만 남긴다. SessionHost 이관본은 `h_runner_v3.py`다.
# 이 판의 차단은 풀지 않는다 — 실행은 v3 로만 한다.
BLOCKED = (
    "h_runner_v2.py 는 다중 writer 결함으로 실행이 차단됐다. "
    "SessionHost 이관본 h_runner_v3.py 를 사용하라. 이 판은 감사 대조용으로만 남는다."
)


def main() -> int:
    if "--i-know-it-is-blocked" not in sys.argv:
        print(BLOCKED, file=sys.stderr)
        return 4
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=int, default=1)
    ap.add_argument("--model", default="gpt-5.1")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    spec = json.loads((HERE / "h-branches.json").read_text(encoding="utf-8"))
    branches = spec["branches"]
    total = sum(len(b["turns"]) for b in branches)
    if total != spec["turnsPerRun"]:
        print(f"분기표 불일치: {total}턴 vs {spec['turnsPerRun']} 선언", file=sys.stderr)
        return 2
    if not args.dry_run and not SECRET.exists():
        print("자격 파일이 없다. 키 입력 창을 먼저 실행하라.", file=sys.stderr)
        return 2

    # 조건 6: 회차 lock. 한 시점에 하나만.
    if not args.dry_run:
        try:
            fd = os.open(str(LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"run={args.run} pid={os.getpid()}\n".encode())
            os.close(fd)
        except FileExistsError:
            print(f"다른 회차가 실행 중이다: {LOCK.read_text().strip()}", file=sys.stderr)
            return 3

    runroot = HERE / f"v2-run-{args.run}"
    out = runroot / "turns.jsonl"
    receipt: dict = {"run": args.run, "model": args.model, "branches": []}
    manifest: list[str] = []
    before = downloads_listing()

    print(f"[Hermes 대화형 v2] 회차 {args.run} · {total}턴 · {args.model}"
          + (" · DRY RUN" if args.dry_run else ""))

    try:
        if not args.dry_run:
            shutil.rmtree(runroot, ignore_errors=True)
            runroot.mkdir(parents=True, exist_ok=True)
            out.write_text("", encoding="utf-8")

        for br in branches:
            home = runroot / br["home"]
            print(f"\n── {br['id']}  home={br['home']}  ({br['purpose']})")
            if not args.dry_run:
                home.mkdir(parents=True, exist_ok=True)

            for step in br.get("fixture", []):
                if args.dry_run:
                    print(f"     fixture:{step}")
                elif step == "make":
                    manifest.extend(fixture_make())
                    print(f"     fixture make → {len(FIXTURES)}개")
                elif step == "unlock":
                    fixture_unlock()

            sessions: dict[str, Session] = {}
            for t in br["turns"]:
                for step in t.get("setup", []):
                    if step == "fixture:lock":
                        if args.dry_run:
                            print("     fixture:lock")
                        else:
                            fixture_lock()

                key = t["session"]
                if args.dry_run:
                    tag = "재시작 후 재개" if t.get("restartBefore") else (
                        "새 대화" if key not in sessions else "이어서")
                    print(f"  {t['seq']:>2} {t['id']:<13} {key} {tag:<12} "
                          f"{t.get('role') or t.get('measure', '')[:40]}")
                    sessions.setdefault(key, None)  # type: ignore[arg-type]
                    continue

                restarted = False
                if t.get("restartBefore"):
                    # 조건 5: 실제 제품 재시작 뒤 원 대화 재개.
                    old = sessions.get(key)
                    sid = old.close() if old else None
                    if not sid:
                        print("     ! 세션 ID 를 얻지 못했다 — 재개 승계를 잴 수 없다")
                    sessions[key] = Session(home, args.model, resume=sid)
                    sessions[key].wait_ready()
                    restarted = True
                    print(f"     제품 재시작 → --resume {sid}")
                elif key not in sessions:
                    sessions[key] = Session(home, args.model)
                    sessions[key].wait_ready()

                m = sessions[key].ask(t["prompt"])
                rec = {
                    "run": args.run, "branch": br["id"], "home": br["home"],
                    "seq": t["seq"], "id": t["id"], "session": key,
                    "restarted": restarted,
                    "role": t.get("role"), "prompt": t["prompt"],
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

            if not args.dry_run:
                ids = {k: s.close() for k, s in sessions.items() if isinstance(s, Session)}
                receipt["branches"].append({"id": br["id"], "home": br["home"], "sessionIds": ids})
    finally:
        if not args.dry_run:
            # 조건 7: 홈은 지우지 않는다. 산출물이 그대로 증거다.
            removed, kept = fixture_clean(manifest)
            after = downloads_listing()
            new_files = sorted(after - before)
            receipt["fixtureManifest"] = manifest
            receipt["fixtureRemoved"] = removed
            # 제품이 만든 파일은 지우지 않고 정확한 경로로 보고한다.
            receipt["productCreated"] = [str(DOWNLOADS / n) for n in new_files]
            (runroot / "receipt.json").write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
            LOCK.unlink(missing_ok=True)
            print(f"\nfixture 삭제 {len(removed)}건")
            if new_files:
                print("제품이 만든 파일 (지우지 않았다. 정확한 경로로 보고한다):")
                for n in new_files:
                    print(f"  {DOWNLOADS / n}")
            print(f"기록: {out}\n영수증: {runroot / 'receipt.json'}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
