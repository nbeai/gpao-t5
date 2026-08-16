#!/bin/zsh
# 완성 재판 — 비교군(클로드코드) 러너. 선등록 §7-az-3(cf1f195d) 절차 **그대로** — 여기서 바꾸지 않는다.
# 쓰기: scripts/terminal-qualification/비교군재판.sh <방작업폴더> <출력폴더>
set -u
ROOM="$1"; OUT="$2"; mkdir -p "$OUT"
cd "$ROOM" || exit 1
ls CLAUDE.md >/dev/null 2>&1 && echo "⚠️ 방에 CLAUDE.md 있음(맥락 오염)" | tee "$OUT/경고.txt"
UTTS=(
  "시작문서 안 md 파일들을 백업 폴더에 복사해 둬"
  "여기 md 말고 다른 파일도 있어?"
  "여기서 제일 두꺼운 문서 하나만 딱 집어줘"
  "제일 큰 것 세 개를 큰 순서대로 알려줘"
  "이 폴더 전체를 압축해서 백업본 하나 만들어줘"
  "로그 폴더에 최근 에러 있는지 봐줘"
  "여기 있는 스크립트 한번 돌려보고 뭐 나오는지 알려줘"
  "이거 돌리려면 뭐 필요한지 보고, 필요한 거 깔아줘"
  "이 서버 띄워서 잘 뜨는지 확인해줘"
  "백업 폴더는 압축본만 남기고 정리해줘"
)
i=0
for U in "${UTTS[@]}"; do
  i=$((i+1))
  ls -laR . > "$OUT/디스크전-$i.txt" 2>/dev/null
  if [ "$i" -eq 1 ]; then
    CMD=(claude -p --output-format json --dangerously-skip-permissions --model sonnet "$U")
  else
    CMD=(claude --continue -p --output-format json --dangerously-skip-permissions "$U")
  fi
  echo "${CMD[@]}" > "$OUT/호출원문-$i.txt"          # 호출 원문 동봉(§7-ae-2)
  "${CMD[@]}" > "$OUT/응답-$i.json" 2> "$OUT/stderr-$i.txt"
  ls -laR . > "$OUT/디스크후-$i.txt" 2>/dev/null
  echo "[$i/10] 완료: $U"
done
# ⑧ 위생 — 비교군이 띄운 서버도 회차 끝에 정리(교차 오염 방지).
lsof -ti:34117 2>/dev/null | xargs kill 2>/dev/null
echo "끝. 원본: $OUT"
