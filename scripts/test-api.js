import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.UPSTAGE_API_KEY;
if (!key) {
  console.error("UPSTAGE_API_KEY가 .env에 없습니다.");
  process.exit(1);
}

const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 100 700 Td (Hello) Tj ET\nendstream\nendobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n200\n%%EOF"
);
fs.mkdirSync("uploads", { recursive: true });
fs.writeFileSync("uploads/test.pdf", pdf);

async function docTest(label, extra = {}) {
  const form = new FormData();
  form.append("document", new Blob([pdf], { type: "application/pdf" }), "test.pdf");
  form.append("model", "document-parse");
  form.append("output_formats", "['markdown']");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);

  const res = await fetch("https://api.upstage.ai/v1/document-digitization", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  console.log(`${label}:`, res.status, data.error?.message || data.content?.markdown || "OK");
}

console.log("API key:", key.slice(0, 8) + "...");
await docTest("document-parse");
await docTest("official style", { ocr: "force", base64_encoding: "['table']" });
