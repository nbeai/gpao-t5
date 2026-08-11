---
name: 네이버 검색
description: 네이버 검색 결과를 주소로 바로 읽는다. 호스트는 search.naver.com 이다
requires:
  bins: [curl]
---

# 네이버 검색

## 주소 (여기서 틀린다)

```
맞음  https://search.naver.com/search.naver?query=<검색어>
틀림  https://www.naver.com/search.naver?query=<검색어>     ← 404. www 에는 검색 경로가 없다
```

검색어는 URL 인코딩한다. 탭을 좁히려면 `&where=news` · `&where=blog` · `&where=web` 을 붙인다.

## 읽는 법

1. `web.collect` 에 위 주소를 **그대로** 준다. 브라우저를 안 열어도 결과가 온다. 이게 가장 싸다.
2. 막히면 터미널:

```bash
curl -sL -A 'Mozilla/5.0' --get --data-urlencode 'query=전세사기' \
  https://search.naver.com/search.naver | sed -e 's/<[^>]*>/ /g' | tr -s ' \n' ' \n' | head -60
```

3. 로그인이 있어야 보이는 자리면 그때만 화면 손으로 간다. 검색 결과는 로그인이 필요 없다.

## 확인

주소에 `search.naver.com` 이 있고 본문이 왔으면 된 것이다. 결과가 비면 주소가 아니라
검색어를 의심한다 — 주소를 바꿔 가며 여러 번 열지 않는다.
