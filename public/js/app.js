const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const clearFile = document.getElementById("clearFile");
const parseBtn = document.getElementById("parseBtn");
const modeSelect = document.getElementById("mode");
const ocrSelect = document.getElementById("ocr");
const mergeTables = document.getElementById("mergeTables");
const includeImages = document.getElementById("includeImages");
const useAsync = document.getElementById("useAsync");
const progress = document.getElementById("progress");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const errorBox = document.getElementById("errorBox");
const preview = document.getElementById("preview");
const resultActions = document.getElementById("resultActions");
const usageInfo = document.getElementById("usageInfo");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const apiWarning = document.getElementById("apiWarning");

let selectedFile = null;
let markdownResult = "";
let downloadFilename = "document.md";
let apiBlocked = false;

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

clearFile.addEventListener("click", (e) => {
  e.stopPropagation();
  resetFile();
});

parseBtn.addEventListener("click", startParse);
copyBtn.addEventListener("click", copyMarkdown);
downloadBtn.addEventListener("click", downloadMarkdown);

function setFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileInfo.classList.remove("hidden");
  parseBtn.disabled = apiBlocked;
  hideError();
}

function resetFile() {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  parseBtn.disabled = true;
}

function hideError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function showError(msg, code) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");

  if (code === "DOCUMENT_PARSE_NO_ACCESS") {
    showApiWarning(msg);
  } else if (code === "EMPTY_DOCUMENT") {
    ocrSelect.value = "force";
  }
}

function showApiWarning(message) {
  apiWarning.innerHTML = `
    <strong>Document Parse API 사용 불가</strong>
    <p>${message}</p>
    <ol>
      <li><a href="https://console.upstage.ai/billing" target="_blank" rel="noopener">Upstage Console → Billing</a>에서 결제 수단 등록</li>
      <li><a href="https://console.upstage.ai/api-keys?api=layout-analysis" target="_blank" rel="noopener">Document parsing API 키</a> 발급</li>
      <li>프로젝트 <code>.env</code> 파일의 <code>UPSTAGE_API_KEY</code> 교체 후 서버 재시작</li>
    </ol>
  `;
  apiWarning.classList.remove("hidden");
}

async function checkApiStatus() {
  try {
    const res = await fetch("/api/diagnose");
    const data = await res.json();
    if (data.documentParse === "no_access" && data.hint) {
      apiBlocked = true;
      showApiWarning(data.hint);
      parseBtn.disabled = true;
    }
  } catch {
    // ignore
  }
}

checkApiStatus();

function showProgress(text, indeterminate = true, percent = 0) {
  progress.classList.remove("hidden");
  progressText.textContent = text;
  progressFill.classList.toggle("indeterminate", indeterminate);
  if (!indeterminate) progressFill.style.width = `${percent}%`;
}

function hideProgress() {
  progress.classList.add("hidden");
  progressFill.classList.remove("indeterminate");
  progressFill.style.width = "0%";
}

function showResult(markdown, usage, filename) {
  markdownResult = markdown;
  downloadFilename = filename || "document.md";

  if (markdown) {
    preview.innerHTML = `<div class="preview-content">${marked.parse(markdown)}</div>`;
  } else {
    preview.innerHTML = `<div class="preview-empty"><p>변환 결과가 비어 있습니다.</p></div>`;
  }

  resultActions.classList.remove("hidden");

  if (usage?.pages) {
    usageInfo.textContent = `${usage.pages}페이지 처리됨`;
  } else {
    usageInfo.textContent = "";
  }
}

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

async function startParse() {
  if (!selectedFile) return;

  hideError();
  parseBtn.disabled = true;
  resultActions.classList.add("hidden");
  preview.innerHTML = `<div class="preview-empty"><p>변환 중...</p></div>`;
  showProgress("Upstage API에 문서를 전송하는 중...", true);

  const formData = new FormData();
  formData.append("document", selectedFile);
  formData.append("mode", modeSelect.value);
  formData.append("ocr", ocrSelect.value);
  formData.append("mergeMultipageTables", mergeTables.checked ? "true" : "false");
  formData.append("includeImages", includeImages.checked ? "true" : "false");
  formData.append("useAsync", useAsync.checked ? "true" : "false");

  try {
    const res = await fetch("/api/parse", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error || "변환 요청 실패");
      err.code = data.code;
      throw err;
    }

    if (data.async) {
      if (data.message) showToast(data.message);
      await pollAsyncStatus(data.requestId);
    } else {
      hideProgress();
      showResult(data.markdown, data.usage, data.filename);
    }
  } catch (err) {
    hideProgress();
    const code = err.code;
    showError(err.message, code);
    preview.innerHTML = `<div class="preview-empty"><p>변환에 실패했습니다.</p></div>`;
  } finally {
    parseBtn.disabled = false;
  }
}

async function pollAsyncStatus(requestId) {
  const maxAttempts = 1200;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    await sleep(5000);

    const res = await fetch(`/api/parse/status/${requestId}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "상태 조회 실패");
    }

    const { status, totalPages, completedPages } = data;

    if (status === "completed") {
      hideProgress();
      if (!data.markdown?.trim()) {
        throw new Error("변환은 완료됐지만 Markdown 결과가 비어 있습니다.");
      }
      showResult(data.markdown, { pages: totalPages }, data.filename);
      return;
    }

    if (status === "failed") {
      throw new Error(data.failureMessage || "비동기 변환 실패");
    }

    const percent = totalPages ? Math.round((completedPages / totalPages) * 100) : 0;
    const statusLabel = { submitted: "대기 중", started: "처리 중", scheduled: "예약됨" }[status] || status;
    showProgress(
      `${statusLabel}... ${completedPages || 0}/${totalPages || "?"}페이지 (${percent}%)`,
      false,
      percent
    );
  }

  throw new Error("처리 시간이 초과되었습니다. 나중에 다시 시도해 주세요.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyMarkdown() {
  if (!markdownResult) return;
  try {
    await navigator.clipboard.writeText(markdownResult);
    showToast("클립보드에 복사되었습니다");
  } catch {
    showToast("복사에 실패했습니다");
  }
}

function downloadMarkdown() {
  if (!markdownResult) return;
  const blob = new Blob([markdownResult], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadFilename;
  a.click();
  URL.revokeObjectURL(url);
}
