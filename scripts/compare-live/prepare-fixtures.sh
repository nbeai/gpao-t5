#!/bin/bash
# H08·H09 fixture — T5 3회 측정과 동일. 만들고, 쓰고, 지운다.
set -e
case "$1" in
  make)
    cd ~/Downloads
    printf '품목,수량,단가\n모니터,2,320000\n키보드,3,45000\n' > "견적서_A사_v1.csv"
    printf '품목,수량,단가\n모니터,2,310000\n키보드,3,42000\n마우스,3,28000\n' > "견적서_A사_최종.csv"
    printf '품목,수량,단가\n모니터,1,350000\n' > "견적서_B사_v1.csv"
    echo "fixture 3개 생성"
    ;;
  lock)   chmod 000 ~/Downloads/견적서_A사_최종.csv; echo "H09용 접근 불가 설정" ;;
  unlock) chmod 644 ~/Downloads/견적서_A사_최종.csv 2>/dev/null || true; echo "권한 복구" ;;
  clean)
    chmod 644 ~/Downloads/견적서_A사_최종.csv 2>/dev/null || true
    rm -f ~/Downloads/견적서_A사_v1.csv ~/Downloads/견적서_A사_최종.csv ~/Downloads/견적서_B사_v1.csv
    echo "fixture 삭제"
    ;;
  *) echo "usage: $0 {make|lock|unlock|clean}"; exit 1 ;;
esac
