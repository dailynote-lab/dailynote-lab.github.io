# 데일리툴 — 생활 계산기 & 오늘의 운세

회원가입 없이 모바일에서 바로 쓰는 무료 웹 도구 모음입니다.
빌드 도구·외부 CDN·프레임워크 없이 정적 파일만으로 동작합니다.

## 무엇이 들어 있나

| 도구 | 설명 |
| --- | --- |
| 연봉 실수령액 계산기 | 2026년 4대보험 요율(국민연금 4.75% · 건강보험 3.595% · 장기요양 건보료의 13.14% · 고용보험 0.9%)과 근로소득세·지방소득세를 반영한 예상 금액 |
| 전세·대출 이자 계산기 | 만기일시상환 · 원리금균등상환 · 원금균등상환 세 가지 방식의 월 납입액과 총 이자 비교 |
| 퍼센트·할인율 계산기 | 값의 %, 비율, 증감률, 할인가/할인율 역산 |
| 오늘의 운세 | 생년월일(양력)로 띠·별자리를 구해 총운·금전운·애정운·건강운·일운과 띠별 순위 제공 |
| 심리테스트 | 소비 성향 테스트(10문항), 스트레스 대처 유형 테스트(8문항) |

## 화면 구성

- **상단 도구 목록**: 5개 도구를 두 그룹(**생활·재테크 계산기** 3개 / **오늘의 운세·심리테스트** 2개)으로 나눠 색으로 구분한 카드로 보여 줍니다. 각 카드는 아이콘·이름·한 줄 설명을 달고, 고른 카드는 `aria-pressed` + 좌측 색 띠 + “사용 중” 표시로 강조되며 해당 도구 영역으로 부드럽게 스크롤하고 초점을 옮깁니다.
- **도구 영역(workspace)**: 제목과 그룹 표기를 함께 보여 주는 머리말 + 옅은 배경 판으로 목록·참고자료와 분리했습니다.
- **참고 자료/FAQ**: 위쪽 구분선과 “참고 자료” 표시로 도구 영역과 구분합니다.
- **개인정보처리방침**: 푸터 버튼으로 여는 모달(`#privacy-dialog`). 계산 입력값이 브라우저 안에서만 처리되고 저장·전송되지 않는다는 점, 현재 쿠키·분석·광고 스크립트가 없다는 점, GA4·AdSense 도입 시 방침을 먼저 갱신한다는 점을 적었습니다.

## 파일 구성

```
index.html    페이지 마크업 + SEO 메타 + JSON-LD(WebSite/WebApplication/FAQPage)
styles.css    모바일 우선 스타일, 다크 모드 대응
app.js        계산 로직·운세 생성·테스트 진행 (모두 브라우저 안에서 실행)
favicon.svg   아이콘
robots.txt    크롤링 허용 + 사이트맵 위치
sitemap.xml   사이트맵
.nojekyll     GitHub Pages 의 Jekyll 처리 비활성화
```

## 로컬에서 보기

```bash
cd projects/daily-utility-hub
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

## 사이트 주소

`https://dailynote-lab.github.io/` — `index.html` 의 canonical·og:url·JSON-LD, `sitemap.xml`, `robots.txt` 에 모두 이 주소가 들어 있습니다.
GitHub 사용자명이 다시 바뀌면 아래처럼 한 번에 치환하세요.

```bash
cd projects/daily-utility-hub
NEWNAME="새-깃허브-아이디"
sed -i "s|https://dailynote-lab.github.io|https://${NEWNAME}.github.io|g" index.html sitemap.xml robots.txt
```

## 배포 (GitHub Pages 사용자 사이트)

저장소: https://github.com/dailynote-lab/dailynote-lab.github.io

```bash
cd projects/daily-utility-hub
git init -b main
git add -A
git commit -m "데일리툴: 생활 계산기·오늘의 운세 정적 사이트"
git remote add origin https://github.com/dailynote-lab/dailynote-lab.github.io.git
git push -u origin main

gh api -X POST repos/dailynote-lab/dailynote-lab.github.io/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

배포 확인:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://dailynote-lab.github.io/
```

## 계산 기준과 한계

- 4대보험: 2026년 요율. 국민연금 기준소득월액 상한 659만원·하한 41만원, 건강보험 본인부담 상한 월 4,591,740원·하한 10,080원 적용, 10원 미만 버림.
- 소득세: 근로소득공제 → 기본공제(1인 150만원) · 연금보험료공제 · 건강보험료공제 · 표준세액공제(13만원) → 기본세율 → 근로소득세액공제(한도 적용) → 지방소득세 10%.
- 반영하지 않은 것: 자녀세액공제, 연금계좌·보험료 세액공제, 의료비·교육비·월세 공제, 상여 지급 시기, 회사별 비과세 항목, 국민연금 고지 시점 차이.
- 대출: 원 단위 반올림. 실제 은행은 일수 계산(365일 기준)과 인지세·근저당 설정 비용이 더해져 조금 달라집니다.
- 운세·심리테스트는 재미를 위한 콘텐츠이며 의학적·심리학적 진단이 아닙니다.

## 개인정보

입력한 값은 브라우저 메모리에서만 계산되고 서버로 전송되거나 저장되지 않습니다.
외부 스크립트·폰트·분석 도구를 쓰지 않습니다.

## 검증 스크립트

프로젝트 폴더 밖 `projects/` 에 있습니다.

```bash
python3 projects/_check_daily_utility_hub.py   # 구조·참조·클래스·XML 정적 검증(+도구 목록·개인정보처리방침)
python3 projects/_test_daily_utility_hub.py    # 계산 함수를 V8 로 실제 실행해 대조
python3 projects/_smoke_daily_utility_hub.py   # 스텁 DOM 위에서 app.js 초기화·탭 전환·렌더링 확인
```
