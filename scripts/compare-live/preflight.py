#!/usr/bin/env python3
"""무과금 전실행 — 유료 회차 전에 수명주기를 증명한다.

감사 P0-1·P2 재발 방지 원칙이 이 파일의 구조다:
  · 증거 칸은 **다르게 나올 수 있었던 관측**으로만 채운다. 상수를 적지 않는다.
  · 증명에는 반대 검증이 내장된다 — **실패해야 하는 것이 실패하지 않으면 전체 INVALID**다.
  · 계측이 불가능하면(ps -1) 안전한 0 이 아니라 검사 실패다.

실측 근거(2026-07-30 관측):
  · 프롬프트 0건 세션은 디스크에 저장되지 않는다 → 그 ID 로의 재개는 반드시 실패해야 한다.
  · 없는 ID 로 `--resume` 하면 제품이 `Session not found` 를 찍고 조용히 새 대화를 연다.
  · 가짜 키 프롬프트 1건은 토큰 미터 0 으로 실패하지만 세션은 저장된다 → 과금 0 으로
    **실제 재개 성공**(이전 원문 재생)을 증명할 수 있다.

과금 안전은 약속이 아니라 구조다: 실제 `secret-env.sh` 는 읽지도 주입하지도 않는다.
자식 환경은 `sanitized_env()` 로 명시 구성되어 오너의 셸 키·실제 HOME 이 새지 않는다.

    python3 preflight.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_lifecycle import (  # noqa: E402
    Session, SessionHost, count_product_processes, disk_session_ids,
)

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)
MODEL = os.environ.get("PREFLIGHT_MODEL", "gpt-5.1")
# 시험용 가짜 자격. verify_run.py 의 FAKE_KEY 와 같은 문자열이다 — 기록에 남아도 가짜다.
FAKE_KEY = "sk-test-FAKE-NOT-A-REAL-KEY-000000000000"

report: dict = {"model": MODEL, "checks": [], "measured": {
    "promptsSent": 0, "realSecretInjected": False, "envSanitized": True,
}}
fails: list[str] = []


def record(label: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"label": label, "ok": ok, "detail": detail})
    print(f"  {'PASS' if ok else 'FAIL'} · {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def must_fail(label: str, fn) -> None:
    """반대 검증: fn 이 예외로 끝나야 PASS. 조용한 성공은 검사 실패다."""
    try:
        fn()
        record(label, False, "실패해야 하는데 성공했다")
    except RuntimeError as e:
        record(label, True, str(e)[:90])


def ask_quiet(session, prompt: str, quiet_s: float = 5.0, timeout_s: float = 120.0) -> str:
    mark = len(session.buf)
    report["measured"]["promptsSent"] += 1
    session.write(prompt)
    t0 = time.monotonic()
    first = None
    last = t0
    while time.monotonic() - t0 < timeout_s:
        if session.drain():
            if first is None:
                first = time.monotonic()
            last = time.monotonic()
        if first is not None and time.monotonic() - last >= quiet_s:
            break
        if session.proc.poll() is not None:
            break
        time.sleep(0.2)
    return session.text(mark)


def main() -> int:
    root = HERE / "preflight"
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    fake_secret = root / "fake-secret.sh"
    fake_secret.write_text(f"export OPENAI_API_KEY={FAKE_KEY}\n", encoding="utf-8")

    print(f"[무과금 전실행] 모델 선택 {MODEL} · 실제 자격 주입 0건 · 가짜 키만 사용\n")

    # ── 0부: 음성 대조 — 자격 0 부팅은 설정 안내에서 멈춰야 한다 ────────────────
    # 실측(2026-07-30): 환경을 상속하면 제품이 오너 HOME 의 copilot 자격을 임시 홈으로
    # 자동 임포트해 "구성된 것처럼" 부팅했다. sanitized_env 아래에서 자격 0 부팅이
    # setup 안내에 머무는 것이 곧 "환경에서 새 들어오는 자격 0"의 증명이다.
    home0 = root / "pf-home-nocred"
    home0.mkdir(parents=True, exist_ok=True)
    s0 = Session(home0, MODEL, None)
    setup_seen = False
    t0 = time.monotonic()
    while time.monotonic() - t0 < 40:
        s0.drain()
        if "no API keys or providers found" in s0.text():
            setup_seen = True
            break
        if s0.proc.poll() is not None:
            break
        time.sleep(0.5)
    record("자격 0 부팅은 설정 안내에서 멈춘다(환경 자격 누수 0 증명)", setup_seen,
           "setup 안내 관측" if setup_seen else "안내 없음 — 어딘가에서 자격이 새 들어온다")
    rep0 = s0.close()
    record("음성 대조 세션 종료 확인", rep0.verified_dead, f"단계={rep0.stage}")

    # ── 1부: 가짜 자격 수명주기 + 반대 검증 ────────────────────────────────────
    home = root / "pf-home"
    home.mkdir(parents=True, exist_ok=True)

    n0 = count_product_processes(home)
    record("계측기가 작동한다(ps 실행 가능)", n0 >= 0, f"반환 {n0}")
    record("열기 전 이 홈의 제품 프로세스 0", n0 == 0, f"{n0}개")

    host = SessionHost(home, MODEL, fake_secret)
    try:
        s1 = host.open("s1")
        record("입력 가능 상태 도달(입력 프롬프트 표식 확인)", s1.ready)
    except RuntimeError as e:
        record("입력 가능 상태 도달", False, str(e))
        return finish(1)

    n = count_product_processes(home)
    record("열린 뒤 이 홈의 제품 프로세스 정확히 1", n == 1, f"{n}개")

    must_fail("같은 홈 두 번째 세션 차단", lambda: host.open("s2-must-fail"))
    n = count_product_processes(home)
    record("차단 시도 뒤에도 프로세스 1", n == 1, f"{n}개")

    try:
        rep = host.close("s1")
        record("종료 확인", rep.verified_dead, f"단계={rep.stage} 대기={rep.waited_s}s")
        shown_sid = rep.session_id
    except RuntimeError as e:
        record("종료 확인", False, str(e))
        return finish(1)

    n = count_product_processes(home)
    record("닫은 뒤 이 홈의 제품 프로세스 0", n == 0, f"{n}개")

    # 실측: 프롬프트 0건 세션은 저장되지 않는다. 화면의 표시 ID 는 디스크 사실이 아니다.
    on_disk = disk_session_ids(home)
    record("프롬프트 0건 세션은 디스크에 남지 않는다", not on_disk, f"디스크 {len(on_disk)}건")
    ghost = shown_sid or "20990101_000000_dead00"
    must_fail("저장 안 된 표시 ID 로의 재개 차단(지난 판의 거짓 PASS)",
              lambda: host.open("ghost-resume", resume=ghost))
    must_fail("존재하지 않는 ID 로의 재개 차단",
              lambda: host.open("bogus-resume", resume="definitely-not-a-real-session-id"))
    n = count_product_processes(home)
    record("반대 검증 뒤에도 잔여 프로세스 0", n == 0, f"{n}개")

    # ── 2부: 가짜 자격으로 실제 재개 성공 증명 (H05 의 전제, 과금 0) ─────────────
    home2 = root / "pf-home-resume"
    home2.mkdir(parents=True, exist_ok=True)

    host2 = SessionHost(home2, MODEL, fake_secret)
    try:
        sa = host2.open("resume-proof")
        seen = ask_quiet(sa, "안녕")
        record("가짜 키 프롬프트의 토큰 미터 0(과금 없음 관측)", "0/400K" in seen,
               "미터 표식 관측" if "0/400K" in seen else "미터 표식 없음")
        rep_a = host2.close("resume-proof")
        record("프롬프트 세션 종료 확인", rep_a.verified_dead, f"단계={rep_a.stage}")
    except RuntimeError as e:
        record("가짜 키 프롬프트 세션", False, str(e))
        return finish(1)

    persisted = disk_session_ids(home2)
    record("프롬프트 1건 세션이 디스크에 남는다", len(persisted) == 1, f"{persisted}")
    if not persisted:
        return finish(1)
    sid = persisted[0]

    try:
        sb = host2.open("resumed", resume=sid)
        text = sb.text()
        replayed = "안녕" in text
        no_fail_marker = "Session not found" not in text
        record("--resume 로 원 대화 재개(실패 마커 없음)", no_fail_marker)
        record("재개 화면에 이전 원문이 재생된다", replayed)
        n = count_product_processes(home2)
        record("재개 뒤 프로세스 정확히 1", n == 1, f"{n}개")
        rep_b = host2.close("resumed")
        record("재개 세션도 종료 확인", rep_b.verified_dead, f"단계={rep_b.stage}")
    except RuntimeError as e:
        record("--resume 로 원 대화 재개", False, str(e)[:120])
        return finish(1)

    for h in (home, home2):
        n = count_product_processes(h)
        record(f"{h.name} 잔여 프로세스 0", n == 0, f"{n}개")

    report["measured"]["diskSessions"] = {"pf-home": on_disk, "pf-home-resume": persisted}
    return finish(0 if not fails else 1)


def finish(code: int) -> int:
    report["verdict"] = "VALID" if not fails else f"INVALID ({len(fails)}건)"
    out = HERE / "preflight" / "preflight-report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n판정: {report['verdict']}")
    print(f"보고서: {out}")
    return code


if __name__ == "__main__":
    sys.exit(main())
