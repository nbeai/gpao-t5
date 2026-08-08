#!/bin/zsh
# 6단계 비교 — 오늘 밤 잔여 회차를 순서대로 돈다(첫 메시지 순서: ⑫ R2·R3 → ⑬ ×3 → ⑧ ×3 → ⑪ ×3).
# 회차는 서로 독립·순차다(같은 포트·같은 기계). 실패해도 다음 회차로 간다 — 무효는 기계 사실로 남는다.
# OpenClaw 는 ⑪ 만 측정한다(구성확정.md — ⑫⑬⑧ 은 격리 불성립·전제 불일치로 not_comparable).
set -u
cd "$(dirname "$0")/../.."
run() {
  echo "=== $(date +%H:%M:%S) item $1 round $2 products $3 ==="
  node scripts/compare-live/step6-round.mjs --item "$1" --round "$2" --products "$3"
  echo "--- exit $? ---"
}
run 12 3  t5,hermes
run 13 1  t5,hermes
run 13 2  t5,hermes
run 13 3  t5,hermes
run 8f 1  t5,hermes
run 8f 2  t5,hermes
run 8f 3  t5,hermes
run 11 1  t5,hermes,openclaw
run 11 2  t5,hermes,openclaw
run 11 3  t5,hermes,openclaw
echo "=== 배치 끝 $(date +%H:%M:%S) ==="
