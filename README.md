# 데일리툴 — 생활 계산기 & 오늘의 운세

회원가입 없이 모바일에서 바로 쓰는 무료 웹 도구 모음입니다.
빌드 도구·외부 CDN·프레임워크 없이 정적 파일만으로 동작합니다.

## 무엇이 들어 있나 (도구 7개)

| 도구 | 설명 |
| --- | --- |
| 연봉 실수령액 계산기 | 2026년 4대보험 요율(국민연금 4.75% · 건강보험 3.595% · 장기요양 건보료의 13.14% · 고용보험 0.9%)과 근로소득세·지방소득세를 반영한 예상 금액 |
| 퇴직금 계산기 | 1일 평균임금 × 30일 × 재직일수 ÷ 365. 입사일·퇴사일, 최근 3개월 급여·상여금·연차수당으로 세전 예상 퇴직금 계산 |
| 주휴수당 계산기 | 시급 × 주휴 인정시간(주 40시간 이상 8시간 / 미만은 주 소정근로시간 ÷ 5). 15시간 미만은 대상 아님, 주급·월급(4.345주) 함께 표시 |
| 전세·대출 이자 계산기 | 만기일시상환 · 원리금균등상환 · 원금균등상환 세 가지 방식의 월 납입액과 총 이자 비교 |
| 퍼센트·할인율 계산기 | 값의 %, 비율, 증감률, 할인가/할인율 역산 |
| 오늘의 운세 | 생년월일(양력)로 띠·별자리를 구해 총운·금전운·애정운·건강운·일운과 띠별 순위 제공 |
| 심리테스트 | 소비 성향 테스트(10문항), 스트레스 대처 유형 테스트(8문항) |

## 화면 구성

- **상단 도구 목록**: 7개 도구를 두 그룹(**생활·재테크 계산기** 5개 / **오늘의 운세·심리테스트** 2개)으로 나눠 색으로 구분한 카드로 보여 줍니다. 각 카드는 아이콘·이름·한 줄 설명을 달고, 고른 카드는 `aria-pressed` + 좌측 색 띠 + “사용 중” 표시로 강조되며 해당 도구 영역으로 부드럽게 스크롤하고 초점을 옮깁니다.
- **도구 영역(workspace)**: 제목과 그룹 표기를 함께 보여 주는 머리말 + 옅은 배경 판으로 목록·참고자료와 분리했습니다.
- **결과 복사**: 계산기 5개, 오늘의 운세, 심리테스트 결과에 **결과 복사하기** 버튼. 결과 요약과 사이트 주소가 함께 복사되어 바로 공유할 수 있습니다(클립보드 API 미지원·차단 환경은 `execCommand` 폴백).
- **최근 계산 기록**: 계산할 때마다 **결과 요약 + 시각 + 도구 이름**만 브라우저 `localStorage`(`daily-tool:history:v1`)에 최대 8개 저장하고, 도구 영역 아래에 보여 줍니다. 항목을 누르면 그 도구로 이동하고, **내 기록 지우기** 버튼으로 즉시 삭제합니다. 입력값(연봉·생년월일 등)은 저장하지 않습니다.
- **소식 받아보기(옵트인 구독)**: 이메일 + 명시적 동의 체크박스. 백엔드 주소(`NEWSLETTER.endpoint`)가 비어 있으면 **아무 것도 전송·저장하지 않고** “베타 준비 중” 안내만 보여 줍니다(성공한 척하지 않음).
- **참고 자료/FAQ**: 위쪽 구분선과 “참고 자료” 표시로 도구 영역과 구분합니다.
- **개인정보처리방침**: 푸터 버튼으로 여는 모달(`#privacy-dialog`). 입력값이 서버로 전송되지 않는다는 점, 최근 계산 기록이 **로컬스토리지에만** 저장되고 언제든 지울 수 있다는 점, 쿠키·분석·광고 스크립트가 없다는 점, 이메일은 동의한 구독 신청에서만 다룬다는 점, GA4·AdSense 도입 시 방침을 먼저 갱신한다는 점을 적었습니다.

## 파일 구성

```
index.html    페이지 마크업 + SEO 메타 + JSON-LD(WebSite/WebApplication/FAQPage)
styles.css    모바일 우선 스타일, 다크 모드 대응
app.js        계산 로직·운세 생성·테스트 진행·복사·기록·구독 (모두 브라우저 안에서 실행)
favicon.svg   아이콘
robots.txt    크롤링 허용 + 사이트맵 위치
sitemap.xml   사이트맵
.nojekyll     GitHub Pages 의 Jekyll 처리 비활성화
```

## 구독(뉴스레터) 백엔드 연결하기

`app.js` 의 아래 한 곳만 채우면 신청이 실제로 전송됩니다.

```js
var NEWSLETTER = {
  endpoint: '',                      // ← 여기에 주소를 넣는다
  formName: 'dailytool-newsletter'
};
```

- **Google Forms / Apps Script**: Apps Script 웹앱(`…/exec`)을 만들고 `doPost(e)` 에서 `JSON.parse(e.postData.contents)` 의 `email` 을 시트에 한 줄 추가한 뒤 배포합니다. CORS 프리플라이트를 피하려면 `mode: 'no-cors'` 가 필요할 수 있습니다.
- **Supabase**: `newsletter(email text primary key, consent boolean, source text, created_at timestamptz default now())` 테이블을 만들고 Edge Function 또는 REST(`/rest/v1/newsletter`, `apikey` 헤더)로 받습니다.
- endpoint 가 비어 있는 동안에는 어떤 요청도 나가지 않으며, 화면에는 “현재 베타 준비 중이에요” 안내만 표시됩니다. 연결 후에는 개인정보처리방침 6항(수집 항목·목적·보유 기간·철회 방법)을 실제 동작에 맞춰 갱신하세요.

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
- 퇴직금: 퇴직일 이전 3개월 임금 총액 ÷ 그 기간의 총 일수(약 92일) = 1일 평균임금, 퇴직금 = 1일 평균임금 × 30 × 재직일수 ÷ 365. 재직일수는 입사일·퇴사일 포함. **통상임금과의 비교(평균임금이 더 낮을 때 통상임금 적용)와 퇴직소득세는 반영하지 않은 세전 예상치**입니다.
- 주휴수당: 주 40시간 이상 8시간, 미만은 주 소정근로시간 ÷ 5. 15시간 미만은 0원. 월 환산은 4.345주(365÷12÷7) 기준이라 정부 최저임금 월 환산액(209시간 기준)과 40시간 근로에서 0.2% 안팎 차이가 날 수 있습니다. 연장·야간·휴일수당, 주휴수당의 최저임금 산입 방식은 반영하지 않습니다.
- 2026년 최저임금: 시급 10,320원 (고용노동부 고시 제2025-47호, 월 209시간 기준 2,156,880원).
- 반영하지 않은 것: 자녀세액공제, 연금계좌·보험료 세액공제, 의료비·교육비·월세 공제, 상여 지급 시기, 회사별 비과세 항목, 국민연금 고지 시점 차이.
- 대출: 원 단위 반올림. 실제 은행은 일수 계산(365일 기준)과 인지세·근저당 설정 비용이 더해져 조금 달라집니다.
- 운세·심리테스트는 재미를 위한 콘텐츠이며 의학적·심리학적 진단이 아닙니다.

## 개인정보

입력한 값은 브라우저 안에서만 계산되고 서버로 전송되지 않습니다.
최근 계산 기록은 **결과 요약만** 브라우저 로컬스토리지에 저장되며 “내 기록 지우기”로 삭제됩니다.
구독 이메일은 이용자가 직접 입력하고 동의한 경우에만 다루며, 백엔드 미연결 상태에서는 전송·저장하지 않습니다.
외부 스크립트·폰트·분석 도구를 쓰지 않습니다.

## 검증 스크립트

프로젝트 폴더 밖 `projects/` 에 있습니다.

```bash
python3 projects/_check_daily_utility_hub.py   # 구조·참조·클래스·XML 정적 검증(+도구 7개·기록·구독·방침)
python3 projects/_test_daily_utility_hub.py    # 계산 함수를 V8 로 실제 실행해 독립 구현과 대조(퇴직금·주휴수당 포함)
python3 projects/_smoke_daily_utility_hub.py   # 스텁 DOM 위에서 app.js 초기화·탭 전환·렌더링·복사·기록·구독 확인
```
