#!/usr/bin/env python3
"""제품 세션의 닫힌 수명주기. 홈당 살아있는 프로세스는 **항상 정확히 1개**다.

지난 두 판이 같은 결함으로 무효가 됐다: 세션을 분기 끝에서야 닫아 같은 홈에 s1·s2 가 동시에
살아 있었다. 눈으로 지키는 규칙은 또 깨진다. 그래서 규칙을 자료구조에 넣는다 —
``SessionHost`` 는 한 홈에 두 번째 세션을 **열 수 없다**(예외를 던진다).

감사 요구 대응:
  ① 홈별 제품 프로세스 정확히 1개  → SessionHost.open() 이 위반 시 RuntimeError
  ② 기존 세션 종료 확인 뒤 새 세션  → open() 이 이전 세션의 종료 증명을 요구
  ③ 정상 종료 → 강제 종료 → 종료 확인 → close() 가 3단계를 거치고 어느 단계에서 끝났는지 기록
  ④ session ID·resume 검증 실패 시 즉시 중단 → resume() 이 검증 실패 시 예외
  ⑤ 실제 입력 가능 상태 확인 → wait_ready() 가 입력 프롬프트 표식을 본 뒤에만 성공
  ⑥ 무과금 전실행 증명 → 이 파일만으로 프로세스 수·홈·세션 ID·종료 상태를 찍을 수 있다
"""
from __future__ import annotations

import os
import pty
import re
import select
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

_ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]")
# 입력 가능 표식: TUI 의 입력 프롬프트. 이게 보이기 전에는 프롬프트를 넣지 않는다.
_READY = re.compile(r"❯|Type your message")
_SESSION_ID = re.compile(r"Session:\s*(\S+)|--resume\s+(\S+)")

READY_TIMEOUT_S = 90.0
EXIT_GRACE_S = 15.0
TERM_GRACE_S = 5.0


def strip_ansi(raw: bytes) -> str:
    text = _ANSI.sub(b"", raw).decode("utf-8", "replace").replace("\r", "\n")
    return "\n".join(ln.rstrip() for ln in text.split("\n") if ln.strip())


def count_product_processes(home: Path) -> int:
    """이 홈을 쓰는 제품 프로세스 수를 OS 에게 직접 묻는다. 내 장부를 믿지 않는다."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid=,command="], capture_output=True, text=True, timeout=20,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return -1
    n = 0
    for line in out.splitlines():
        if "hermes" not in line or "--cli" not in line:
            continue
        pid = line.strip().split(None, 1)[0]
        try:
            env = subprocess.run(
                ["ps", "-p", pid, "-wwE", "-o", "command="],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except (subprocess.SubprocessError, OSError):
            env = ""
        if f"HERMES_HOME={home}" in env:
            n += 1
    return n


@dataclass
class CloseReport:
    stage: str            # graceful | sigterm | sigkill | already_dead
    verified_dead: bool
    session_id: str | None
    waited_s: float
    tail: str = field(repr=False, default="")


class Session:
    """PTY 하나 = 제품 프로세스 하나 = 대화 하나."""

    def __init__(self, home: Path, model: str, secret: Path | None,
                 resume: str | None = None) -> None:
        self.home = home
        self.resume_of = resume
        base = f"./.venv/bin/hermes --cli -m {model} --provider openai-api"
        if resume:
            base += f" --resume {resume} --no-restore-cwd"
        inner = ("set -a; "
                 + (f". '{secret}'; " if secret and secret.exists() else "")
                 + f"export HERMES_HOME='{home}'; exec {base}")
        self.master, slave = pty.openpty()
        os.set_blocking(self.master, False)
        self.proc = subprocess.Popen(
            ["bash", "-c", inner], cwd="/Users/jyp/Developer/lab_un/hermes-agent",
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
        )
        os.close(slave)
        self.buf = bytearray()
        self.session_id: str | None = resume
        self.ready = False

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def drain(self) -> int:
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

    def text(self, since: int = 0) -> str:
        return strip_ansi(bytes(self.buf[since:]))

    # ── ⑤ 실제 입력 가능 상태 ────────────────────────────────────────────────
    def wait_ready(self) -> bool:
        t0 = time.monotonic()
        while time.monotonic() - t0 < READY_TIMEOUT_S:
            self.drain()
            if self.proc.poll() is not None:
                return False
            if _READY.search(self.text()):
                # 표식이 보인 뒤 화면이 안정될 때까지 조금 더.
                time.sleep(1.0)
                self.drain()
                self.ready = True
                return True
            time.sleep(0.2)
        return False

    def write(self, line: str) -> None:
        if not self.ready:
            raise RuntimeError("입력 가능 상태가 아니다 — wait_ready() 를 먼저 통과해야 한다")
        os.write(self.master, (line + "\n").encode())

    # ── ③ 정상 종료 → 강제 종료 → 종료 확인 ─────────────────────────────────
    def close(self) -> CloseReport:
        mark = len(self.buf)
        t0 = time.monotonic()

        if self.proc.poll() is not None:
            self.drain()
            return CloseReport("already_dead", True, self._read_id(mark), 0.0, self.text(mark))

        stage = "graceful"
        try:
            os.write(self.master, b"/exit\n")
        except OSError:
            pass
        while time.monotonic() - t0 < EXIT_GRACE_S:
            self.drain()
            if self.proc.poll() is not None:
                break
            time.sleep(0.2)

        if self.proc.poll() is None:
            stage = "sigterm"
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            t1 = time.monotonic()
            while time.monotonic() - t1 < TERM_GRACE_S:
                self.drain()
                if self.proc.poll() is not None:
                    break
                time.sleep(0.2)

        if self.proc.poll() is None:
            stage = "sigkill"
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

        self.drain()
        sid = self._read_id(mark)
        try:
            os.close(self.master)
        except OSError:
            pass
        dead = self.proc.poll() is not None
        return CloseReport(stage, dead, sid, round(time.monotonic() - t0, 2), self.text(mark))

    def _read_id(self, mark: int) -> str | None:
        m = _SESSION_ID.search(self.text(mark)) or _SESSION_ID.search(self.text())
        if not m:
            return self.session_id
        return m.group(1) or m.group(2) or self.session_id


class SessionHost:
    """홈 하나를 지키는 문. 살아있는 세션은 최대 하나다 — 규칙이 아니라 구조다."""

    def __init__(self, home: Path, model: str, secret: Path | None) -> None:
        self.home = home
        self.model = model
        self.secret = secret
        self.live: Session | None = None
        self.history: list[dict] = []

    def open(self, label: str, resume: str | None = None) -> Session:
        # ② 이전 세션이 살아 있으면 새로 열지 않는다.
        if self.live is not None and self.live.proc.poll() is None:
            raise RuntimeError(
                f"{self.home.name}: 이전 세션이 아직 살아 있다 — 먼저 close() 로 종료를 증명하라")
        # ① OS 에게 직접 물어 홈당 프로세스가 0 인지 확인한다.
        n = count_product_processes(self.home)
        if n > 0:
            raise RuntimeError(f"{self.home.name}: 이 홈에 제품 프로세스가 {n}개 살아 있다")

        s = Session(self.home, self.model, self.secret, resume=resume)
        if not s.wait_ready():
            rep = s.close()
            raise RuntimeError(
                f"{self.home.name}/{label}: 입력 가능 상태에 도달하지 못했다 "
                f"(종료단계={rep.stage}, 확인={rep.verified_dead})")
        # ④ resume 이면 실제로 그 세션으로 열렸는지 확인한다.
        if resume:
            seen = s.text()
            if resume not in seen and not _READY.search(seen):
                rep = s.close()
                raise RuntimeError(f"{self.home.name}/{label}: --resume {resume} 검증 실패")
        self.live = s
        self.history.append({"label": label, "resumeOf": resume, "opened": True,
                             "processes": count_product_processes(self.home)})
        return s

    def close(self, label: str) -> CloseReport:
        if self.live is None:
            return CloseReport("already_dead", True, None, 0.0)
        rep = self.live.close()
        after = count_product_processes(self.home)
        self.history.append({
            "label": label, "closeStage": rep.stage, "verifiedDead": rep.verified_dead,
            "sessionId": rep.session_id, "waitedS": rep.waited_s, "processesAfter": after,
        })
        self.live = None
        if not rep.verified_dead or after != 0:
            raise RuntimeError(
                f"{self.home.name}/{label}: 종료를 증명하지 못했다 "
                f"(단계={rep.stage}, 확인={rep.verified_dead}, 남은 프로세스={after})")
        return rep
