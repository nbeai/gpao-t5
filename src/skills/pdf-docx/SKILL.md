---
name: PDF·워드 문서 만들기
description: textutil 로 .docx, cupsfilter 로 .pdf 를 만든다. 설치할 것이 없다
requires:
  bins: [textutil, cupsfilter]
---

# .docx · .pdf 만들기 (macOS 기본 도구만)

## 워드 (.docx)

```bash
textutil -convert docx -output "$HOME/보고서.docx" "$HOME/원고.txt"
file "$HOME/보고서.docx"    #  Microsoft Word 2007+
```

입력은 `.txt` · `.html` · `.rtf` 다 된다. HTML 로 쓰면 굵게·표·목록이 그대로 살아
`.docx` 에 들어간다 — 서식이 필요하면 HTML 을 먼저 만든다.

## PDF

```bash
cupsfilter "$HOME/원고.txt" > "$HOME/보고서.pdf" 2>/dev/null
file "$HOME/보고서.pdf"     #  PDF document, version 1.3
```

**실측한 제약**: `cupsfilter` 는 `.html` · `.rtf` 를 못 받는다("변환할 필터가 없습니다").
받는 것은 **텍스트**다. 그러니 다른 형식에서 갈 때는 먼저 텍스트로 내린다.

```bash
textutil -convert txt -output /tmp/t.txt "$HOME/원고.docx"
cupsfilter /tmp/t.txt > "$HOME/보고서.pdf" 2>/dev/null
```

`cupsfilter` 는 정상일 때도 `DEBUG:` 를 표준오류로 쏟는다 — `2>/dev/null` 로 버린다.
성공 판정은 종료 코드와 `file` 출력으로 한다.

## 저장 자리

`printenv GPAO_T5_FILE_ROOTS` 가 작업 폴더다(비어 있으면 `$HOME`).
터미널의 기본 자리는 홈이므로 **출력 경로는 절대 경로로 쓴다.**
