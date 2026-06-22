import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPSTAGE_API_KEY = process.env.UPSTAGE_API_KEY;
const UPSTAGE_DOCUMENT_MODEL = process.env.UPSTAGE_DOCUMENT_MODEL || "document-parse";
const UPSTAGE_BASE = "https://api.upstage.ai/v1/document-digitization";
const SYNC_PAGE_LIMIT = 100;
const PORT = process.env.PORT || 3000;

const app = express();
const uploadDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".hwp": "application/x-hwp",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif", ".webp", ".docx", ".pptx", ".xlsx", ".hwp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 파일 형식입니다: ${ext}`));
    }
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function authHeaders() {
  if (!UPSTAGE_API_KEY) {
    throw new Error("UPSTAGE_API_KEY 환경 변수가 설정되지 않았습니다.");
  }
  return { Authorization: `Bearer ${UPSTAGE_API_KEY}` };
}

function resolveMimeType(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return MIME_BY_EXT[ext] || file.mimetype || "application/octet-stream";
}

function validatePdf(buffer) {
  const header = buffer.subarray(0, 5).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    return "PDF 형식이 아닙니다. 파일이 손상되었거나 다른 형식일 수 있습니다.";
  }

  const body = buffer.toString("latin1");
  if (!body.includes("%%EOF")) {
    return "PDF 파일이 불완전합니다. 다운로드가 중단되었거나 파일이 손상된 것 같습니다. 원본 PDF를 다시 다운로드한 뒤 업로드해 주세요.";
  }

  return null;
}

function countPdfPages(buffer) {
  const body = buffer.toString("latin1");
  const countMatch = body.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
  if (countMatch) return Number(countMatch[1]);

  const pageMatches = body.match(/\/Type\s*\/Page\b(?!s)/g);
  return pageMatches ? pageMatches.length : null;
}

function isPageLimitError(message = "") {
  return /page limit|exceeds the page limit|maximum allowed is 100/i.test(message);
}

function readFileBuffer(file) {
  return fs.readFileSync(file.path);
}

function buildFormData(file, model, options, buffer = null) {
  const form = new FormData();
  const fileBuffer = buffer || readFileBuffer(file);

  if (fileBuffer.length === 0) {
    throw new Error("업로드된 파일이 비어 있습니다.");
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".pdf") {
    const pdfError = validatePdf(fileBuffer);
    if (pdfError) {
      throw new Error(pdfError);
    }
  }

  const mimeType = resolveMimeType(file);

  form.append(
    "document",
    new Blob([fileBuffer], { type: mimeType }),
    file.originalname
  );
  form.append("model", model);
  form.append("output_formats", "['markdown']");

  if (options.ocr) form.append("ocr", options.ocr);
  if (options.mode && options.mode !== "standard") form.append("mode", options.mode);
  if (options.mergeMultipageTables === "true") {
    form.append("merge_multipage_tables", "true");
  }

  const includeImages = options.includeImages !== "false";
  if (includeImages) {
    form.append("base64_encoding", "['figure', 'chart', 'table']");
  }

  return form;
}

async function checkApiAccess() {
  const headers = authHeaders();

  const chatRes = await fetch("https://api.upstage.ai/v1/chat/completions", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "solar-mini", messages: [{ role: "user", content: "hi" }] }),
  });

  const form = new FormData();
  form.append(
    "document",
    new Blob([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\ntrailer<</Size 3/Root 1 0 R>>\n%%EOF")], {
      type: "application/pdf",
    }),
    "test.pdf"
  );
  form.append("model", "document-parse");

  const docRes = await fetch(UPSTAGE_BASE, {
    method: "POST",
    headers,
    body: form,
  });

  const chatOk = chatRes.ok;
  const docData = await docRes.json().catch(() => ({}));
  const docMessage = docData.error?.message || docData.message || "";
  const docOk = docRes.ok;
  const docBlocked = /invalid|no longer supported|model/i.test(docMessage);

  return {
    chat: chatOk ? "ok" : "fail",
    documentParse: docOk ? "ok" : docBlocked ? "no_access" : "fail",
    documentParseMessage: docMessage,
    hint: docBlocked && chatOk
      ? "현재 API 키는 Chat API만 사용 가능합니다. Upstage Console에서 Document Parse API를 활성화하고 결제 수단을 등록한 뒤, 새 API 키를 발급받아 .env에 설정해 주세요."
      : null,
  };
}

async function requestParse(file, options, useAsync, buffer = null) {
  const endpoint = useAsync ? `${UPSTAGE_BASE}/async` : UPSTAGE_BASE;
  const form = buildFormData(file, UPSTAGE_DOCUMENT_MODEL, options, buffer);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  const data = await response.json();

  if (response.ok) {
    return { response, data, model: UPSTAGE_DOCUMENT_MODEL };
  }

  const message = data.message || data.error?.message || "Upstage API 요청 실패";
  throw { response, data, message };
}

async function callUpstageParse(file, options, useAsync) {
  const buffer = readFileBuffer(file);
  const ext = path.extname(file.originalname).toLowerCase();
  const pageCount = ext === ".pdf" ? countPdfPages(buffer) : null;
  let asyncMode = useAsync || (pageCount !== null && pageCount > SYNC_PAGE_LIMIT);
  let autoAsync = !useAsync && asyncMode;

  try {
    const result = await requestParse(file, options, asyncMode, buffer);
    return { ...result, usedAsync: asyncMode, autoAsync, pageCount };
  } catch (err) {
    const message = err.message || "";

    if (!asyncMode && isPageLimitError(message)) {
      const result = await requestParse(file, options, true, buffer);
      return { ...result, usedAsync: true, autoAsync: true, pageCount };
    }

    if (/empty/i.test(message) && options.ocr !== "force") {
      const result = await requestParse(file, { ...options, ocr: "force" }, asyncMode, buffer);
      return { ...result, usedAsync: asyncMode, autoAsync, pageCount };
    }

    throw err;
  }
}

const IMAGE_CATEGORIES = new Set(["figure", "chart", "table", "equation"]);

function detectImageMime(base64) {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

function toDataUrl(base64Value) {
  if (!base64Value) return null;
  if (typeof base64Value === "string") {
    if (base64Value.startsWith("data:")) return base64Value;
    return `data:${detectImageMime(base64Value)};base64,${base64Value}`;
  }
  if (typeof base64Value === "object" && base64Value.data) {
    const mime = base64Value.mime || base64Value.media_type || detectImageMime(base64Value.data);
    return `data:${mime};base64,${base64Value.data}`;
  }
  return null;
}

function elementToMarkdown(el) {
  const text = (el.content?.markdown || el.content?.text || "").trim();
  const dataUrl = toDataUrl(el.base64_encoding);

  if (dataUrl && IMAGE_CATEGORIES.has(el.category)) {
    const alt = el.category === "table" ? "table" : el.category === "chart" ? "chart" : "figure";
    const imageMd = `![${alt}](${dataUrl})`;
    return text ? `${text}\n\n${imageMd}` : imageMd;
  }

  if (text) return text;
  if (el.content?.html?.trim()) return el.content.html.trim();
  return "";
}

function extractMarkdown(data, file = null) {
  if (Array.isArray(data?.elements) && data.elements.length > 0) {
    const fromElements = data.elements.map(elementToMarkdown).filter(Boolean).join("\n\n");
    if (fromElements.trim()) return fromElements.trim();
  }

  const fromContent = [
    data?.content?.markdown,
    data?.content?.text,
    data?.content?.html,
  ].find((value) => typeof value === "string" && value.trim());

  if (fromContent) return fromContent.trim();

  if (file) {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"].includes(ext)) {
      const buffer = readFileBuffer(file);
      const mime = resolveMimeType(file);
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      return `![${file.originalname}](${dataUrl})`;
    }
  }

  return "";
}

async function mergeAsyncBatches(batches) {
  const sorted = [...batches].sort((a, b) => a.id - b.id);
  const parts = [];

  for (const batch of sorted) {
    if (batch.status !== "completed" || !batch.download_url) continue;
    const res = await fetch(batch.download_url);
    if (!res.ok) throw new Error(`배치 결과 다운로드 실패 (${batch.start_page}-${batch.end_page}페이지)`);
    const data = await res.json();
    parts.push(extractMarkdown(data));
  }

  return parts.filter(Boolean).join("\n\n");
}

app.get("/api/diagnose", async (_req, res) => {
  try {
    return res.json(await checkApiAccess());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/parse", upload.single("document"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "파일을 업로드해 주세요." });
  }

  const options = {
    mode: req.body.mode || "standard",
    ocr: req.body.ocr || "force",
    mergeMultipageTables: req.body.mergeMultipageTables,
    includeImages: req.body.includeImages,
  };
  const useAsync = req.body.useAsync === "true";

  try {
    let { data, usedAsync, autoAsync, pageCount } = await callUpstageParse(file, options, useAsync);

    if (usedAsync) {
      cleanupFile(file.path);
      return res.json({
        async: true,
        autoAsync,
        pageCount,
        requestId: data.request_id || data.id,
        status: data.status || "submitted",
        message: autoAsync
          ? `${pageCount || "100+"}페이지 문서라 비동기 모드로 처리합니다. 완료까지 수 분이 걸릴 수 있습니다.`
          : undefined,
      });
    }

    let markdown = extractMarkdown(data, file);

    if (!markdown && options.ocr !== "force") {
      ({ data } = await callUpstageParse(file, { ...options, ocr: "force" }, false));
      markdown = extractMarkdown(data, file);
    }

    cleanupFile(file.path);

    if (!markdown) {
      return res.status(422).json({
        error: "문서에서 텍스트를 추출하지 못했습니다. 스캔 PDF이거나 이미지 기반 PDF일 수 있습니다. OCR을 Force로 설정 후 다시 시도해 보세요.",
        code: "EMPTY_DOCUMENT",
      });
    }

    return res.json({
      async: false,
      markdown,
      usage: data.usage,
      model: data.model,
      filename: file.originalname.replace(/\.[^.]+$/, ".md"),
    });
  } catch (err) {
    cleanupFile(file?.path);

    if (err.message && !err.response) {
      return res.status(400).json({
        error: err.message,
        code: /불완전|손상/.test(err.message) ? "INVALID_PDF" : undefined,
      });
    }

    if (err.response) {
      const isDocBlocked = /invalid|no longer supported|model/i.test(err.message);
      const isEmptyDoc = /empty/i.test(err.message);
      const isPageLimit = isPageLimitError(err.message);
      let hint = "";
      if (isDocBlocked) {
        hint = " 현재 API 키에 Document Parse 권한이 없습니다. Upstage Console → Billing에서 결제 수단을 등록하고, Document Parse API를 활성화한 뒤 새 API 키를 발급받아 .env의 UPSTAGE_API_KEY를 교체해 주세요.";
      } else if (isEmptyDoc) {
        hint = " 스캔 PDF이거나 텍스트가 없는 PDF일 수 있습니다. OCR 옵션을 Force로 바꾸고 다시 시도해 보세요.";
      } else if (isPageLimit) {
        hint = " 100페이지를 초과하는 문서는 비동기 모드로 처리됩니다. 서버를 재시작한 뒤 다시 시도해 주세요.";
      }
      return res.status(err.response.status).json({
        error: (err.message || "Upstage API 요청 실패") + hint,
        code: isDocBlocked
          ? "DOCUMENT_PARSE_NO_ACCESS"
          : isEmptyDoc
            ? "EMPTY_DOCUMENT"
            : isPageLimit
              ? "PAGE_LIMIT"
              : undefined,
        details: err.data,
      });
    }

    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/parse/status/:requestId", async (req, res) => {
  const { requestId } = req.params;

  try {
    const response = await fetch(`${UPSTAGE_BASE}/requests/${requestId}`, {
      headers: authHeaders(),
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || "상태 조회 실패",
        details: data,
      });
    }

    const result = {
      requestId: data.id,
      status: data.status,
      totalPages: data.total_pages,
      completedPages: data.completed_pages,
      failureMessage: data.failure_message,
    };

    if (data.status === "completed" && Array.isArray(data.batches)) {
      result.markdown = await mergeAsyncBatches(data.batches);
      result.filename = `document-${requestId.slice(0, 8)}.md`;
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: err.message || "서버 오류" });
});

app.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
  if (!UPSTAGE_API_KEY) {
    console.warn("⚠ UPSTAGE_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
  }
});
