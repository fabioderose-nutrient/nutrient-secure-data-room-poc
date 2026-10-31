// End-to-end checks of the secure data room.
//
// Starts its own copy of the Node server on TEST_PORT (default 4721) with a
// short token lifetime and an empty data folder, so the demo's own audit trail
// is not touched. Document Engine must be running (docker compose up -d) and
// keys/ must exist (scripts/generate-keys.sh).
//
//   node e2e.mjs                 run the checks
//   node e2e.mjs --screenshots   also write docs/screenshots/*.png
//
// Each check prints PASS or FAIL with the measured value. The exit code is the
// number of failures.

import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 4721);
const TTL = Number(process.env.TEST_TOKEN_TTL_SECONDS || 30);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv.includes("--screenshots") ? join(ROOT, "docs", "screenshots") : null;

const env = Object.fromEntries(
  [".env", "keys/app.env"].flatMap((file) =>
    readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  )
);
const DE = `http://localhost:${env.DOCUMENT_ENGINE_PORT || 5720}`;

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== "" ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

// ---------------------------------------------------------------------------
// Server under test
// ---------------------------------------------------------------------------

const dataDir = mkdtempSync(join(tmpdir(), "data-room-e2e-"));
const server = spawn(process.execPath, ["--env-file=../.env", "--env-file=../keys/app.env", "server.js"], {
  cwd: join(ROOT, "server"),
  env: { ...process.env, APP_PORT: String(PORT), VIEWER_TOKEN_TTL_SECONDS: String(TTL), DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60 && !serverLog.includes("Secure data room PoC on"); i++) await sleep(1000);
if (!serverLog.includes("Secure data room PoC on")) {
  console.error(serverLog);
  server.kill();
  process.exit(1);
}
console.log(`Server under test on ${BASE}, viewer tokens valid ${TTL} s, data in a temporary folder.\n`);

// One cookie jar per user, like separate browsers.
const cookies = {};
async function signIn(userId) {
  const res = await fetch(`${BASE}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
  cookies[userId] = res.headers.get("set-cookie").split(";")[0];
}
async function call(userId, path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: cookies[userId] ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
// The request the Web SDK sends to Document Engine to open a viewer session.
async function engineAuth(documentId, jwt) {
  const res = await fetch(`${DE}/i/d/${documentId}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "PSPDFKit-Platform": "web", "PSPDFKit-Version": "protocol=5, client=1.24.0" },
    body: JSON.stringify({ jwt, origin: BASE }),
  });
  return { status: res.status, text: (await res.text()).slice(0, 200) };
}
const auditFor = async (query = "") => (await call("ruth", `/api/admin/audit?limit=5000${query}`)).body;

const browser = await chromium.launch();
try {
  for (const u of ["ruth", "owen", "maya", "jonas"]) await signIn(u);

  // -------------------------------------------------------------------------
  console.log("Access control (server)");
  // -------------------------------------------------------------------------
  const roomB = (await call("jonas", "/api/room")).body.folders.map((f) => f.id);
  const roomA = (await call("owen", "/api/room")).body.folders.map((f) => f.id);
  check("Bidder B does not see the clean team folder", !roomB.includes("03-commercial") && roomB.length === 4, roomB.join(", "));
  check("Bidder A sees all five folders", roomA.length === 5, roomA.join(", "));

  const refused = await call("jonas", "/api/documents/heron-customer-contracts/viewer-token", { method: "POST", body: {} });
  check("Bidder B gets no token for a document in a Bidder A only folder", refused.status === 403, `HTTP ${refused.status}: ${refused.body.error}`);

  const unknown = await call("jonas", "/api/documents/not-a-document/viewer-token", { method: "POST", body: {} });
  check("A token for an unknown document is refused", unknown.status === 404, `HTTP ${unknown.status}`);

  const leaseB = await call("jonas", "/api/documents/heron-lease/viewer-token", { method: "POST", body: {} });
  const c = claims(leaseB.body.jwt);
  check(
    "Viewer JWT is read only, for one document, short-lived",
    leaseB.status === 200 &&
      c.allowed_documents.length === 1 &&
      c.allowed_documents[0].document_id === "heron-lease" &&
      JSON.stringify(c.allowed_documents[0].permissions) === '["read"]' &&
      c.exp - c.iat === TTL &&
      c.user_id === "jonas" &&
      Boolean(c.jti),
    `permissions ${JSON.stringify(c.allowed_documents[0].permissions)}, exp - iat = ${c.exp - c.iat} s`
  );

  const sameDoc = await engineAuth("heron-lease", leaseB.body.jwt);
  check("Document Engine accepts the token for its own document", sameDoc.status === 200, `HTTP ${sameDoc.status}`);
  const otherDoc = await engineAuth("heron-customer-contracts", leaseB.body.jwt);
  check("Document Engine refuses the same token for another document", otherDoc.status === 403, `HTTP ${otherDoc.status}: ${otherDoc.text}`);

  const adminAsBidder = await call("owen", "/api/admin/audit");
  check("A bidder cannot read the audit trail", adminAsBidder.status === 403, `HTTP ${adminAsBidder.status}`);

  const forged = await fetch(`${BASE}/api/room`, { headers: { cookie: cookies.owen.replace(/\.[^.]+$/, ".forged") } });
  check("A forged sign-in cookie is refused", forged.status === 401, `HTTP ${forged.status}`);

  const otherToken = await call("maya", "/api/activity", { method: "POST", body: { tokenId: c.jti, pages: [{ page: 1, seconds: 5 }] } });
  check("Page times cannot be reported on another user's token", otherToken.status === 403, `HTTP ${otherToken.status}`);

  // -------------------------------------------------------------------------
  console.log("\nWatermarked download (Document Engine Build API)");
  // -------------------------------------------------------------------------
  const dlAnalyst = await call("owen", "/api/documents/heron-lease/download");
  check("Bidder A analyst cannot download", dlAnalyst.status === 403, dlAnalyst.body.error);
  const dlB = await call("jonas", "/api/documents/heron-lease/download");
  check("Bidder B analyst cannot download", dlB.status === 403, dlB.body.error);

  const started = Date.now();
  const dl = await call("maya", "/api/documents/heron-financial-summary/download", { raw: true });
  const buildMs = Date.now() - started;
  const reference = dl.headers.get("x-download-reference");
  const pdfBytes = new Uint8Array(await dl.arrayBuffer());
  check("Bidder A deal lead downloads a PDF", dl.status === 200 && dl.headers.get("content-type") === "application/pdf", `${pdfBytes.length} bytes in ${buildMs} ms, ref ${reference}`);

  // pdf.js takes over the buffer it is given: pass a copy.
  const pdf = await getDocument({ data: pdfBytes.slice(), verbosity: 0 }).promise;
  let pagesWithMark = 0;
  let annotations = 0;
  let sample = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const text = (await page.getTextContent()).items.map((i) => i.str).join(" ");
    annotations += (await page.getAnnotations()).length;
    if (text.includes("Maya Castellan - Kellsfield Capital") && text.includes(`Downloaded by Maya Castellan (Kellsfield Capital)`) && text.includes(`Ref ${reference}`)) pagesWithMark++;
    if (p === 1) sample = text.match(/Downloaded by [^]*?Confidential/)?.[0] ?? "";
  }
  check("Every page of the download carries the watermark text", pagesWithMark === pdf.numPages && pdf.numPages === 2, `${pagesWithMark}/${pdf.numPages} pages: "${sample}"`);
  check("The watermark is burned in (no annotation left to delete)", annotations === 0, `${annotations} annotations`);

  // -------------------------------------------------------------------------
  console.log("\nViewer (Bidder A analyst in a browser)");
  // -------------------------------------------------------------------------
  const ctxOwen = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const owen = await ctxOwen.newPage();
  owen.on("pageerror", (e) => console.log(`[owen] page error: ${e.message}`));
  await owen.goto(`${BASE}/?user=owen&doc=heron-information-memorandum`);
  await owen.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
  await owen.waitForTimeout(2000);

  const toolbar = await owen.evaluate(() => window.viewerInstance.toolbarItems.map((i) => i.type));
  const forbidden = ["print", "export-pdf", "document-editor", "document-crop", "annotate", "ink", "highlighter", "text-highlighter", "signature", "stamp", "note", "text", "image", "debug"];
  check("Toolbar has no print, export or editing items", !toolbar.some((t) => forbidden.includes(t)), toolbar.join(", "));
  const buttons = await owen.locator("#viewer button").evaluateAll((els) => els.map((e) => e.getAttribute("title") || e.getAttribute("aria-label") || e.textContent.trim()));
  check("No print, export, download or save button in the viewer", !buttons.some((b) => /print|export|download|save/i.test(b)), buttons.join(", "));

  const locked = await owen.evaluate(async () => {
    const i = window.viewerInstance;
    const out = { allowPrinting: i.viewState.allowPrinting, allowExport: i.viewState.allowExport, readOnly: i.viewState.readOnly };
    try {
      i.setViewState((v) => v.set("allowExport", true));
      out.unlock = "allowed";
    } catch (e) {
      out.unlock = e.message;
    }
    try {
      await i.exportPDF();
      out.exportPDF = "exported";
    } catch (e) {
      out.exportPDF = e.message;
    }
    try {
      await i.print();
      out.print = "printed";
    } catch (e) {
      out.print = e.message;
    }
    return out;
  });
  check("Printing, export and editing are off in the view state", !locked.allowPrinting && !locked.allowExport && locked.readOnly);
  check("Turning export back on from the console is refused (no download permission in the JWT)", locked.unlock !== "allowed", locked.unlock);
  check("exportPDF() and print() are refused", locked.exportPDF !== "exported" && locked.print !== "printed", `${locked.exportPDF} / ${locked.print}`);

  const box = await owen.locator("#viewer").boundingBox();
  await owen.mouse.move(box.x + 300, box.y + 420);
  await owen.mouse.down();
  await owen.mouse.move(box.x + 900, box.y + 470, { steps: 12 });
  await owen.mouse.up();
  const selected = await owen.evaluate(() => ({ sdk: Boolean(window.viewerInstance.getTextSelection()), dom: window.getSelection().toString() }));
  check("Dragging over the text selects nothing to copy", !selected.sdk && selected.dom === "", JSON.stringify(selected));

  await owen.keyboard.press("ControlOrMeta+p");
  const toastText = await owen.textContent("#toast");
  check("Ctrl/Cmd+P is blocked", (await owen.isVisible("#toast")) && /Printing is disabled/.test(toastText), toastText);

  // The watermark: what renderPageCallback drew, and what the viewer shows.
  // Zoom on the foot of page 1, where the callback writes a line in dark red.
  const mark = await owen.evaluate(() => {
    const log = window.dataRoom.watermarkLog;
    return { texts: [...new Set(log.map((w) => w.text))], pages: [...new Set(log.map((w) => w.pageIndex))] };
  });
  check(
    "Watermark drawn on each page the viewer rendered, with the viewer's name and company",
    mark.texts.length === 1 && mark.texts[0] === "Owen Fairley - Kellsfield Capital" && mark.pages.length >= 2,
    `"${mark.texts[0]}" on page index(es) ${mark.pages.sort().join(", ")}`
  );
  await owen.evaluate(() => {
    const i = window.viewerInstance;
    const size = i.pageInfoForIndex(0);
    i.jumpAndZoomToRect(0, new NutrientViewer.Geometry.Rect({ left: size.width * 0.15, top: size.height - 26, width: size.width * 0.7, height: 26 }));
  });
  await owen.waitForTimeout(2500);
  // The viewer composes the callback's drawing into the page images it shows.
  // Count the pixels in the colour of the footer line (dark red at 90%).
  const footerPixels = await owen.evaluate(() => {
    const root = document.querySelector("#viewer .PSPDFKit-Container").shadowRoot;
    let count = 0;
    for (const img of root.querySelectorAll("img")) {
      if (!img.naturalWidth) continue;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 100 && d[i] < 175 && d[i + 1] > 25 && d[i + 1] < 90 && Math.abs(d[i + 1] - d[i + 2]) < 15) count++;
    }
    return count;
  });
  check("Watermark is part of the page images on screen", footerPixels > 500, `${footerPixels} pixels in the watermark colour`);
  // Optional: read the line back from a screenshot with Tesseract OCR.
  const ocrImage = join(dataDir, "watermark.png");
  await owen.locator("#viewer").screenshot({ path: ocrImage });
  const ocr = spawnSync("tesseract", [ocrImage, "-"], { encoding: "utf8" });
  if (ocr.error) console.log("SKIP  Watermark read back by OCR  (tesseract is not installed)");
  else {
    const line = ocr.stdout.split("\n").find((l) => l.includes("Viewed by")) ?? "";
    check("Watermark read back from a screenshot by OCR", /Owen Fairley \(Kellsfield Capital\)/.test(line) && /UTC/.test(line), line.trim());
  }

  // Time per page: close, open the memorandum again from the folder tree,
  // stay 4 s on page 1, 3 s on page 2 and 5 s on page 3, then close.
  await owen.click("#close-btn");
  const closedEntry = (await auditFor("&event=document.closed&user=owen")).entries[0];
  check("Closing the document is recorded", closedEntry?.detail === "closed", closedEntry?.detail);
  const lastSeq = (await auditFor()).entries[0].seq;
  await owen.click('.doc-link[data-doc="heron-information-memorandum"]');
  await owen.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
  const plan = [
    [0, 4000],
    [1, 3000],
    [2, 5000],
  ];
  for (const [index, ms] of plan) {
    await owen.evaluate((i) => window.viewerInstance.setViewState((v) => v.set("currentPageIndex", i)), index);
    await owen.waitForTimeout(ms);
  }
  await owen.click("#close-btn");
  await owen.waitForTimeout(500);
  const views = (await auditFor("&event=page.viewed&user=owen&document=heron-information-memorandum")).entries.filter((e) => e.seq > lastSeq);
  const perPage = {};
  for (const e of views) perPage[e.page] = (perPage[e.page] ?? 0) + e.seconds;
  const within = plan.every(([index, ms]) => Math.abs((perPage[index + 1] ?? 0) - ms / 1000) <= 1);
  check(
    "Time per page recorded within 1 s of the time spent (4 s, 3 s, 5 s)",
    within && Object.keys(perPage).length === 3,
    Object.entries(perPage).map(([p, s]) => `page ${p}: ${s.toFixed(1)} s`).join(", ")
  );

  if (SHOTS) {
    await owen.goto(`${BASE}/?user=owen&doc=heron-financial-summary`);
    await owen.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
    await owen.waitForTimeout(3000);
    await owen.screenshot({ path: join(SHOTS, "01-bidder-view-watermark.png") });
    await owen.click("#close-btn");
  }

  // -------------------------------------------------------------------------
  console.log(`\nToken expiry (tokens live ${TTL} s)`);
  // -------------------------------------------------------------------------
  await owen.goto(`${BASE}/?user=owen&doc=heron-lease`);
  await owen.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
  const session = await owen.evaluate(() => window.dataRoom.open.session);
  await owen.evaluate(() => window.viewerInstance.setViewState((v) => v.set("currentPageIndex", 1)));
  await owen.waitForSelector("#overlay:not([hidden])", { timeout: (TTL + 10) * 1000 });
  const closedAfter = (Date.now() - session.expiresAt) / 1000;
  const overlayText = (await owen.textContent("#overlay")).replace(/\s+/g, " ").trim();
  const viewerGone = await owen.evaluate(() => window.viewerInstance === null && !document.querySelector("#viewer .PSPDFKit-Container"));
  check("The viewer closes when the token expires", /Viewing token expired/.test(overlayText) && viewerGone && Math.abs(closedAfter) < 2, `closed ${closedAfter.toFixed(1)} s after exp`);
  const expired = await engineAuth("heron-lease", session.jwt);
  check("Document Engine refuses the expired token", expired.status === 403, `HTTP ${expired.status}: ${expired.text}`);
  await owen.click("#renew-btn");
  await owen.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
  const reopenedAt = await owen.evaluate(() => window.viewerInstance.viewState.currentPageIndex);
  const renewed = (await auditFor("&event=token.renewed&user=owen")).entries.length;
  const expiredLogged = (await auditFor("&event=token.expired&user=owen")).entries.length;
  check("A new token is issued after a new access check, back on the same page", renewed === 1 && expiredLogged === 1 && reopenedAt === 1, `page index ${reopenedAt}, ${expiredLogged} token.expired, ${renewed} token.renewed`);
  await owen.click("#close-btn");

  // -------------------------------------------------------------------------
  console.log("\nAccess withdrawn while Bidder B is reading");
  // -------------------------------------------------------------------------
  const ctxJonas = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const jonas = await ctxJonas.newPage();
  await jonas.goto(`${BASE}/?user=jonas&doc=heron-lease`);
  await jonas.waitForFunction(() => window.viewerInstance, null, { timeout: 90000 });
  await jonas.waitForTimeout(1500);
  const liveJwt = await jonas.evaluate(() => window.dataRoom.open.session.jwt);
  const withdrawn = await call("ruth", "/api/admin/folders/05-property-ip/access", { method: "PUT", body: { company: "bidder-b", allowed: false } });
  const t0 = Date.now();
  check("Closing the folder revokes Bidder B's open token", withdrawn.status === 200 && withdrawn.body.revoked >= 1, `${withdrawn.body.revoked} token(s) revoked`);
  // The next page the viewer needs is refused by Document Engine.
  await jonas.evaluate(() => window.viewerInstance.setViewState((v) => v.set("currentPageIndex", 2)));
  const ended = await jonas.waitForSelector("#overlay:not([hidden])", { timeout: 20000 }).then(
    () => true,
    () => false
  );
  const endedText = ended ? (await jonas.textContent("#overlay")).replace(/\s+/g, " ").trim() : "";
  check("Bidder B's viewer ends with 'Access withdrawn'", ended && /Access withdrawn/.test(endedText), `${Date.now() - t0} ms after the change`);
  const revokedAuth = await engineAuth("heron-lease", liveJwt);
  check("Document Engine refuses the revoked token", revokedAuth.status === 403, `HTTP ${revokedAuth.status}: ${revokedAuth.text}`);
  const roomAfter = (await call("jonas", "/api/room")).body.folders.map((f) => f.id);
  check("The folder disappears from Bidder B's data room", !roomAfter.includes("05-property-ip"), roomAfter.join(", "));
  await call("ruth", "/api/admin/folders/05-property-ip/access", { method: "PUT", body: { company: "bidder-b", allowed: true } });
  await ctxJonas.close();

  // -------------------------------------------------------------------------
  console.log("\nAdministration and audit trail");
  // -------------------------------------------------------------------------
  const wordFile = readFileSync(join(ROOT, "samples", "documents", "employment-policies.docx"));
  const upload = await fetch(`${BASE}/api/admin/documents?folder=04-people&name=pension-scheme-summary.docx&title=Pension%20scheme%20summary`, {
    method: "POST",
    headers: { cookie: cookies.ruth, "Content-Type": "application/octet-stream" },
    body: wordFile,
  });
  const uploaded = await upload.json();
  check("Administrator uploads a Word file; Document Engine converts it", upload.status === 200 && uploaded.document.pages >= 1, `${uploaded.document?.pages} pages`);
  const roomWithUpload = (await call("jonas", "/api/room")).body.folders.find((f) => f.id === "04-people").documents.map((d) => d.title);
  check("The new document appears in the bidders' folder", roomWithUpload.includes("Pension scheme summary"), roomWithUpload.join(", "));

  const all = await auditFor();
  const counts = {};
  for (const e of all.entries) counts[e.event] = (counts[e.event] ?? 0) + 1;
  check(
    "Audit trail has opens, page views, downloads and refusals",
    counts["document.opened"] >= 3 && counts["page.viewed"] >= 3 && counts.download === 1 && counts["access.denied"] >= 5 && counts["access.changed"] === 2,
    Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")
  );
  const deniedDetails = all.entries.filter((e) => e.event === "access.denied").map((e) => `${e.user?.name}: ${e.detail}`);
  check("Refusals name the user and the reason", deniedDetails.some((d) => d.startsWith("Jonas Pereira: view: folder")) && deniedDetails.some((d) => d.includes("download")), deniedDetails[0]);
  check("Hash chain of the audit trail is intact", all.chain.ok, `${all.chain.entries} entries`);

  const csvRes = await call("ruth", "/api/admin/audit.csv", { raw: true });
  const csv = await csvRes.text();
  const csvLines = csv.trim().split("\r\n");
  check(
    "CSV export has a header and one row per entry",
    csvRes.headers.get("content-type").startsWith("text/csv") && csvLines[0].startsWith("seq,time_utc,event,user") && csvLines.length - 1 === all.total,
    `${csvLines.length - 1} rows`
  );

  const engagement = (await call("ruth", "/api/admin/engagement")).body.rows.find((r) => r.userId === "owen" && r.documentId === "heron-information-memorandum");
  check("Engagement shows Owen's time on each page of the memorandum", engagement && Object.keys(engagement.pages).length === 3, engagement && `${engagement.seconds} s over ${Object.keys(engagement.pages).length} pages`);

  if (SHOTS) {
    const ctxAdmin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await ctxAdmin.newPage();
    await adminPage.goto(`${BASE}/?user=ruth`);
    await adminPage.goto(`${BASE}/admin.html`);
    await adminPage.waitForSelector("#audit tr:nth-child(3)");
    await adminPage.waitForTimeout(800);
    await adminPage.screenshot({ path: join(SHOTS, "02-admin-audit.png") });

    // The downloaded copy, opened in a standalone Web SDK viewer: the
    // watermark is now part of the pages.
    const copyPage = await ctxAdmin.newPage();
    await copyPage.goto(`${BASE}/?user=maya`);
    await copyPage.waitForFunction(() => window.dataRoom?.room);
    await copyPage.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)).buffer;
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;inset:0;z-index:20";
      document.body.append(container);
      window.copyViewer = await NutrientViewer.load({
        container,
        document: bytes,
        baseUrl: "https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.24.0/",
        toolbarItems: NutrientViewer.defaultToolbarItems.filter((i) => ["pager", "zoom-out", "zoom-in", "zoom-mode"].includes(i.type)),
        initialViewState: new NutrientViewer.ViewState({ layoutMode: NutrientViewer.LayoutMode.DOUBLE, zoom: NutrientViewer.ZoomMode.FIT_TO_VIEWPORT, readOnly: true }),
      });
    }, Buffer.from(pdfBytes).toString("base64"));
    await copyPage.waitForTimeout(3000);
    await copyPage.screenshot({ path: join(SHOTS, "03-downloaded-copy.png") });
    await ctxAdmin.close();
  }

  // Leave Document Engine as it was: delete the uploaded test document.
  if (uploaded.document) {
    await fetch(`${DE}/api/documents/${uploaded.document.id}`, { method: "DELETE", headers: { Authorization: `Token token=${env.DE_API_TOKEN}` } });
  }
  await ctxOwen.close();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures);
