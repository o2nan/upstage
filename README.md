# PDF → Markdown Converter

Upstage [Document Parse API](https://www.upstage.ai/products/document-parse)를 사용해 PDF 및 기타 문서를 Markdown으로 변환하는 웹 애플리케이션입니다.

## 기능

- PDF, 이미지, DOCX, PPTX, XLSX, HWP 파일 업로드 (드래그 앤 드롭 지원)
- Upstage Document Parse API로 Markdown 변환
- 실시간 Markdown 미리보기
- `.md` 파일 다운로드 및 클립보드 복사
- 파싱 모드 선택 (standard / enhanced / auto / lite)
- OCR 옵션 (auto / force)
- 100페이지 이상 문서용 비동기 모드

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.example`을 참고해 `.env` 파일을 만듭니다.

```env
UPSTAGE_API_KEY=your_api_key_here
UPSTAGE_DOCUMENT_MODEL=document-parse-260128
PORT=3000
```

API 키는 [Upstage Console](https://console.upstage.ai)에서 발급받을 수 있습니다.

> **중요:** Chat API(`solar-mini`)용 키와 Document Parse API는 별도입니다. PDF 변환을 사용하려면 Console에서 **Document Parse API**를 활성화하고, [Billing](https://console.upstage.ai/billing)에 결제 수단을 등록한 뒤 [Document parsing API 키](https://console.upstage.ai/api-keys?api=layout-analysis)를 발급받아야 합니다.

API 키 상태 확인:

```bash
npm run diagnose
```

### 3. 서버 실행

```bash
npm start
```

개발 모드 (파일 변경 시 자동 재시작):

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

## 프로젝트 구조

```
upstage/
├── server/
│   └── index.js       # Express 백엔드 (Upstage API 프록시)
├── public/
│   ├── index.html     # 프론트엔드 UI
│   ├── css/style.css
│   └── js/app.js
├── .env               # API 키 (git 제외)
├── .env.example
└── package.json
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/parse` | 문서 파싱 (동기/비동기) |
| GET | `/api/parse/status/:requestId` | 비동기 작업 상태 조회 |

## 참고

- 동기 API: 최대 100페이지
- 비동기 API: 최대 1,000페이지
- API 키는 `.env`에만 저장하고 Git에 커밋하지 마세요.
