---
name: 엑셀 파일 만들기
description: 라이브러리 없이 zip + XML 다섯 장으로 진짜 .xlsx 를 만든다
requires:
  bins: [zip, file]
---

# .xlsx 만들기 (macOS 기본 도구만)

엑셀 파일은 **XML 다섯 장을 zip 으로 묶은 것**이다. 파이썬 패키지도 라이브러리도 필요 없다.

## 먼저 (실측으로 두 번 밟은 자리)

- `local.file write` 로는 못 만든다 — zip 이라 텍스트가 아니다. **이름만 맞는 빈 파일을 먼저
  만들지 않는다.** 아래 셸로 한 번에 만든다.
- 표 내용을 안 받았으면 **묻지 말고** 머리행과 행 몇 개로 뼈대를 만들어 채운 뒤,
  무엇을 가정했는지 한 줄로 말한다. 사용자는 보고 고친다.

## 저장 자리

`printenv GPAO_T5_FILE_ROOTS` 가 작업 폴더다(비어 있으면 `$HOME`). 사용자가 "이 폴더"라고
하면 거기다. 터미널의 기본 자리는 홈이므로 **출력 경로는 절대 경로로 쓴다.**

## 만들기

```bash
OUT="$HOME/8월_정산.xlsx"        # 실제 목적지로 바꾼다
W=$(mktemp -d); mkdir -p "$W/_rels" "$W/xl/_rels" "$W/xl/worksheets"

cat > "$W/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>
EOF

cat > "$W/_rels/.rels" <<'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
EOF

cat > "$W/xl/workbook.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>
EOF

cat > "$W/xl/_rels/workbook.xml.rels" <<'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>
EOF

# 표 내용은 여기만 바꾼다. 문자열은 t="inlineStr", 숫자는 t 없이 <v>.
cat > "$W/xl/worksheets/sheet1.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>항목</t></is></c><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>매출</t></is></c><c r="B2"><v>1200000</v></c></row></sheetData></worksheet>
EOF

rm -f "$OUT"
( cd "$W" && zip -q -r -X "$OUT" '[Content_Types].xml' _rels xl )
file "$OUT"
```

## 확인 (이걸 봐야 됐다고 말한다)

```
file "$OUT"  →  Microsoft Excel 2007+
```

## 규칙 셋

- 셀 좌표 `r="A1"` 은 행 번호 `<row r="1">` 과 맞아야 한다. 어긋나면 엑셀이 복구를 묻는다.
- 문자열은 `t="inlineStr"` 로 넣는다 — sharedStrings.xml 을 안 만들어도 되는 이유가 이것이다.
- `& < >` 는 `&amp; &lt; &gt;` 로 바꿔 넣는다.
