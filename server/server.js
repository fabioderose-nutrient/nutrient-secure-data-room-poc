// Secure data room PoC - Node server.
//
// - Keeps the folders, documents, folder access per bidder and download rights
//   in data/state.json, and the audit trail in data/audit.jsonl.
// - Uploads the sample documents to Nutrient Document Engine on first start
//   (Word and Excel files are converted to PDF by Document Engine).
// - Decides who may open what. For an allowed document it signs a short-lived,
//   read-only viewer JWT for that single document; Document Engine checks the
//   signature, the document and the expiry on every viewer request.
// - Builds watermarked downloads with the Document Engine Build API.
// - Records every open, page view, download and refusal.
//
// The demo has no real sign-in: the user picks who they are and the server
// keeps that choice in a signed cookie.

import express from "express";
import jwt from "jsonwebtoken";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, extname, join } from "path";
import { BIDDERS, COMPANIES, PROJECT, SEED_DOCUMENTS, SEED_FOLDERS, USERS } from "./data-room.js";
import { createDocumentEngine, SUPPORTED_EXTENSIONS } from "./document-engine.js";
import { createAuditLog, engagement, EVENTS, toCsv } from "./audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PORT = Number(process.env.APP_PORT || 4720);
const DOCUMENT_ENGINE_PORT = process.env.DOCUMENT_ENGINE_PORT || "5720";
// URL the server uses for the Document Engine API.
const DE_URL = process.env.DE_URL || `http://localhost:${DOCUMENT_ENGINE_PORT}`;
// URL the browser uses to reach Document Engine (page images, text, search).
const DE_EXTERNAL_URL = process.env.DE_EXTERNAL_URL || `http://localhost:${DOCUMENT_ENGINE_PORT}`;
const TOKEN_TTL = Number(process.env.VIEWER_TOKEN_TTL_SECONDS || 120);
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const SAMPLES_DIR = join(ROOT, "samples", "documents");
// Web SDK license key. Empty = evaluation mode.
const WEB_SDK_LICENSE_KEY = process.env.WEB_SDK_LICENSE_KEY || "";

// Written to keys/app.env by scripts/generate-keys.sh.
const API_TOKEN = process.env.DE_API_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!API_TOKEN || !SESSION_SECRET) {
  console.error("DE_API_TOKEN or SESSION_SECRET is not set: run scripts/generate-keys.sh, then npm start.");
  process.exit(1);
}
const JWT_PRIVATE_KEY = readFileSync(process.env.JWT_PRIVATE_KEY_PATH || join(ROOT, "keys", "jwt-private.pem"), "utf8");

const engine = createDocumentEngine({ url: DE_URL, apiToken: API_TOKEN });
const audit = createAuditLog(join(DATA_DIR, "audit.jsonl"));

// ---------------------------------------------------------------------------
// State: folders with their access per bidder, documents, download rights
// ---------------------------------------------------------------------------

const STATE_FILE = join(DATA_DIR, "state.json");

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return {
    folders: SEED_FOLDERS.map((f) => ({ ...f, access: { ...f.access } })),
    documents: [],
    download: Object.fromEntries(USERS.map((u) => [u.id, u.download])),
  };
}

const state = loadState();

function saveState() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const findFolder = (id) => state.folders.find((f) => f.id === id);
const findDocument = (id) => state.documents.find((d) => d.id === id);

// The user as stored in the audit trail and sent to the browser.
function describeUser(user) {
  const company = COMPANIES[user.company];
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    role: user.role,
    company: user.company,
    companyName: company.name,
    companyLabel: company.label,
    isAdmin: user.role === "admin",
    canDownload: Boolean(state.download[user.id]),
  };
}

function describeDocument(doc) {
  return { ...doc, folderName: findFolder(doc.folder)?.name ?? doc.folder };
}

// The single access rule: the administrator sees everything, a bidder sees
// the folders opened to their company.
function canView(user, doc) {
  if (user.role === "admin") return true;
  return Boolean(findFolder(doc.folder)?.access[user.company]);
}

async function seedDocuments() {
  // Documents uploaded by the administrator that Document Engine no longer
  // has (after `docker compose down -v`) are dropped from the list.
  for (const doc of [...state.documents]) {
    if (doc.addedBy !== "seed" && !(await engine.info(doc.id))) {
      state.documents.splice(state.documents.indexOf(doc), 1);
      console.log(`[setup] "${doc.title}" is no longer in Document Engine; removed from the data room.`);
    }
  }
  for (const seed of SEED_DOCUMENTS) {
    const known = findDocument(seed.id);
    let info = await engine.info(seed.id);
    if (known && info) continue;
    if (!info) {
      info = await engine.upload(seed.id, readFileSync(join(SAMPLES_DIR, seed.file)), seed.file, seed.title);
      console.log(`[setup] Uploaded ${seed.file} to Document Engine (${info.pageCount} page(s), ${info.uploadMs} ms).`);
    }
    if (known) {
      known.pages = info.pageCount;
      continue;
    }
    state.documents.push({
      id: seed.id,
      folder: seed.folder,
      title: seed.title,
      sourceFile: seed.file,
      sourceType: extname(seed.file).slice(1).toUpperCase(),
      pages: info.pageCount,
      addedAt: new Date().toISOString(),
      addedBy: "seed",
    });
  }
  saveState();
}

// ---------------------------------------------------------------------------
// Demo sign-in: a signed cookie with the user id
// ---------------------------------------------------------------------------

const COOKIE = "dataroom_session";
const sign = (value) => createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");

function sessionCookie(userId) {
  const value = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString("base64url");
  return `${value}.${sign(value)}`;
}

function userFromCookie(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [value, signature] = raw.slice(COOKIE.length + 1).split(".");
  if (!value || !signature) return null;
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { uid } = JSON.parse(Buffer.from(value, "base64url").toString());
  return USERS.find((u) => u.id === uid) ?? null;
}

const clientIp = (req) => (req.ip || "").replace(/^::ffff:/, "");

function requireUser(req, res, next) {
  const user = userFromCookie(req);
  if (!user) return res.status(401).json({ error: "Not signed in. Pick a user first." });
  req.user = describeUser(user);
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.isAdmin) return next();
  audit.append({ event: "access.denied", user: req.user, detail: `admin: ${req.method} ${req.path}`, ip: clientIp(req) });
  res.status(403).json({ error: "Only the data room administrator can do this." });
}

// ---------------------------------------------------------------------------
// Viewer tokens
// ---------------------------------------------------------------------------

// Tokens issued and not yet expired, by jti. Used to revoke the open viewer
// sessions of a bidder when the administrator withdraws a folder, and to tie
// page views to the token they were made with.
const liveTokens = new Map();

function signViewerToken(user, doc) {
  const jti = randomUUID();
  const token = jwt.sign(
    {
      version: "2025-03-01",
      scope: "frontend",
      // One document, read only: no "write" (no annotations) and no
      // "download" (Document Engine refuses to export or print the PDF).
      allowed_documents: [{ document_id: doc.id, permissions: ["read"] }],
      user_id: user.id,
      jti,
    },
    JWT_PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: TOKEN_TTL }
  );
  const { exp, iat } = jwt.decode(token);
  liveTokens.set(jti, { jwt: token, userId: user.id, company: user.company, documentId: doc.id, exp, iat });
  return { token, jti, exp, iat };
}

setInterval(() => {
  const now = Date.now() / 1000;
  for (const [jti, t] of liveTokens) if (t.exp + 120 < now) liveTokens.delete(jti);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const app = express();
app.set("trust proxy", "loopback");
app.use(express.static(join(ROOT, "web")));

app.get("/api/users", (req, res) => {
  res.json({ project: PROJECT, users: USERS.map(describeUser) });
});

// Demo sign-in. A real data room would authenticate the user first (SSO, MFA).
app.post("/api/session", express.json(), (req, res) => {
  const user = USERS.find((u) => u.id === req.body?.userId);
  if (!user) return res.status(404).json({ error: "Unknown user." });
  res.set("Set-Cookie", `${COOKIE}=${sessionCookie(user.id)}; Path=/; HttpOnly; SameSite=Strict`);
  const me = describeUser(user);
  audit.append({ event: "session.started", user: me, ip: clientIp(req) });
  res.json({ user: me });
});

app.get("/api/me", (req, res) => {
  const user = userFromCookie(req);
  res.json({ user: user ? describeUser(user) : null, project: PROJECT, tokenTtlSeconds: TOKEN_TTL });
});

app.use("/api", requireUser);

// The folders and documents this user may see. Folders closed to the user's
// company are not listed at all.
app.get("/api/room", (req, res) => {
  const folders = state.folders
    .filter((f) => req.user.isAdmin || f.access[req.user.company])
    .map((f) => ({
      id: f.id,
      name: f.name,
      documents: state.documents.filter((d) => d.folder === f.id).map(({ id, title, pages, sourceType }) => ({ id, title, pages, sourceType })),
    }));
  res.json({ folders });
});

// Viewer token for one document. `reason` is "open" or "renew" (after the
// previous token expired or was refused).
app.post("/api/documents/:id/viewer-token", express.json(), (req, res) => {
  const doc = findDocument(req.params.id);
  const ip = clientIp(req);
  if (!doc) {
    audit.append({ event: "access.denied", user: req.user, detail: `view: unknown document ${String(req.params.id).slice(0, 80)}`, ip });
    return res.status(404).json({ error: "No such document." });
  }
  const document = describeDocument(doc);
  if (!canView(req.user, doc)) {
    audit.append({ event: "access.denied", user: req.user, document, detail: `view: folder "${document.folderName}" is not open to ${req.user.companyName}`, ip });
    return res.status(403).json({ error: `${req.user.companyName} has no access to the folder "${document.folderName}".` });
  }
  const renew = req.body?.reason === "renew";
  const { token, jti, exp } = signViewerToken(req.user, doc);
  audit.append({
    event: renew ? "token.renewed" : "document.opened",
    user: req.user,
    document,
    detail: `token ${jti.slice(0, 8)}, valid ${TOKEN_TTL} s`,
    ip,
  });
  res.json({
    jwt: token,
    tokenId: jti,
    expiresAt: exp * 1000,
    ttlSeconds: TOKEN_TTL,
    serverUrl: `${DE_EXTERNAL_URL}/`,
    licenseKey: WEB_SDK_LICENSE_KEY,
    document: { id: doc.id, title: doc.title, folder: document.folderName, pages: doc.pages },
    canDownload: req.user.canDownload,
  });
});

// Activity reported by the viewer: time spent on each page, and why the
// viewer closed. Sent with fetch, or with navigator.sendBeacon when the tab
// closes. The token id ties the report to a token this user received for this
// document; reports are accepted up to 60 s after the token expired, so the
// last page time is not lost.
app.post("/api/activity", express.json({ type: () => true }), (req, res) => {
  const { tokenId, pages = [], closed } = req.body || {};
  const issued = liveTokens.get(tokenId);
  if (!issued || issued.userId !== req.user.id || issued.exp + 60 < Date.now() / 1000) {
    return res.status(403).json({ error: "Unknown or expired viewer session." });
  }
  const doc = findDocument(issued.documentId);
  const document = describeDocument(doc);
  const ip = clientIp(req);
  for (const view of pages.slice(0, 500)) {
    const page = Number(view.page);
    const seconds = Math.round(Number(view.seconds) * 10) / 10;
    if (!Number.isInteger(page) || page < 1 || page > doc.pages || !(seconds > 0) || seconds > 24 * 3600) continue;
    audit.append({ event: "page.viewed", user: req.user, document, page, seconds, ip });
  }
  if (closed === "expired") {
    audit.append({ event: "token.expired", user: req.user, document, detail: `token ${tokenId.slice(0, 8)}: viewer closed`, ip });
  } else if (closed) {
    audit.append({ event: "document.closed", user: req.user, document, detail: String(closed).slice(0, 60), ip });
  }
  res.json({ ok: true });
});

// Watermarked copy, for users with the download right only. Document Engine
// burns the user's name, company, the time and a reference into every page.
app.get("/api/documents/:id/download", async (req, res, next) => {
  try {
    const doc = findDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "No such document." });
    const document = describeDocument(doc);
    const ip = clientIp(req);
    if (!canView(req.user, doc) || !req.user.canDownload) {
      const why = !canView(req.user, doc) ? `folder "${document.folderName}" is not open to ${req.user.companyName}` : `${req.user.name} has no download right`;
      audit.append({ event: "access.denied", user: req.user, document, detail: `download: ${why}`, ip });
      return res.status(403).json({ error: `Download refused: ${why}.` });
    }
    const reference = `DL-${randomBytes(3).toString("hex").toUpperCase()}`;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const started = Date.now();
    const pdf = await engine.buildWatermarkedPdf(doc.id, {
      title: `${doc.title} (${reference})`,
      author: `${PROJECT} data room`,
      watermarks: [
        // Diagonal name and company across the whole page. With a rotation,
        // Document Engine fits the text into the box.
        { text: `${req.user.name} - ${req.user.companyName}`, width: "100%", height: "100%", rotation: 45, opacity: 0.3, fontSize: 40, fontColor: "#1f3a5f" },
        // Reference line at the foot of every page. `top` as a percentage
        // works for any page size (in Document Engine 1.20.0, `bottom` is
        // measured from the top edge too).
        {
          text: `Downloaded by ${req.user.name} (${req.user.companyName}) on ${stamp} - Ref ${reference} - ${PROJECT} - Confidential`,
          width: "94%",
          height: 14,
          top: "97%",
          opacity: 0.9,
          fontSize: 7,
          fontColor: "#7a1f1f",
        },
      ],
    });
    const sha = createHash("sha256").update(pdf).digest("hex");
    audit.append({
      event: "download",
      user: req.user,
      document,
      detail: `ref ${reference}, ${pdf.length} bytes, built in ${Date.now() - started} ms, sha256 ${sha.slice(0, 16)}`,
      ip,
    });
    const fileName = `${doc.title.replace(/[^A-Za-z0-9 ._-]+/g, "")} - ${reference}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Download-Reference": reference,
      "Cache-Control": "no-store",
    });
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Administrator
// ---------------------------------------------------------------------------

app.use("/api/admin", requireAdmin);

app.get("/api/admin/state", (req, res) => {
  res.json({
    companies: BIDDERS.map((id) => COMPANIES[id]),
    folders: state.folders.map((f) => ({ ...f, documents: state.documents.filter((d) => d.folder === f.id) })),
    users: USERS.map(describeUser),
    liveTokens: liveTokens.size,
    tokenTtlSeconds: TOKEN_TTL,
    uploadTypes: SUPPORTED_EXTENSIONS,
  });
});

// Opens or closes a folder for a bidder. Closing it also revokes the viewer
// tokens that bidder holds for documents in the folder: Document Engine ends
// those viewer sessions at once instead of waiting for the tokens to expire.
app.put("/api/admin/folders/:id/access", express.json(), async (req, res, next) => {
  try {
    const folder = findFolder(req.params.id);
    const { company, allowed } = req.body || {};
    if (!folder || !BIDDERS.includes(company)) return res.status(400).json({ error: "Unknown folder or bidder." });
    folder.access[company] = Boolean(allowed);
    saveState();
    let revoked = 0;
    if (!allowed) {
      const now = Date.now() / 1000;
      const docs = new Set(state.documents.filter((d) => d.folder === folder.id).map((d) => d.id));
      const toRevoke = [...liveTokens.values()].filter((t) => t.company === company && docs.has(t.documentId) && t.exp > now);
      revoked = await engine.revoke(toRevoke.map((t) => t.jwt));
    }
    audit.append({
      event: "access.changed",
      user: req.user,
      detail: `"${folder.name}" ${allowed ? "opened to" : "closed to"} ${COMPANIES[company].name}${allowed ? "" : `, ${revoked} open viewer token(s) revoked`}`,
      ip: clientIp(req),
    });
    res.json({ folder, revoked });
  } catch (err) {
    next(err);
  }
});

app.put("/api/admin/users/:id/download", express.json(), (req, res) => {
  const user = USERS.find((u) => u.id === req.params.id);
  if (!user || user.role === "admin") return res.status(400).json({ error: "Unknown bidder user." });
  state.download[user.id] = Boolean(req.body?.allowed);
  saveState();
  audit.append({
    event: "download-right.changed",
    user: req.user,
    detail: `${user.name} (${COMPANIES[user.company].name}): download ${state.download[user.id] ? "allowed" : "not allowed"}`,
    ip: clientIp(req),
  });
  res.json({ user: describeUser(user) });
});

// Adds a document to a folder: raw file body, ?folder=&name=&title=.
// PDF, Word, Excel and PowerPoint; Document Engine converts Office files.
app.post("/api/admin/documents", express.raw({ type: () => true, limit: "50mb" }), async (req, res, next) => {
  try {
    const folder = findFolder(String(req.query.folder || ""));
    const name = String(req.query.name || "").replace(/[\\/]/g, "_");
    const ext = extname(name).toLowerCase();
    if (!folder) return res.status(400).json({ error: "Unknown folder." });
    if (!SUPPORTED_EXTENSIONS.includes(ext)) return res.status(400).json({ error: `Supported files: ${SUPPORTED_EXTENSIONS.join(", ")}.` });
    if (!req.body?.length) return res.status(400).json({ error: "Empty file." });
    const title = String(req.query.title || "").trim() || name.slice(0, -ext.length);
    const id = `doc-${randomUUID().slice(0, 8)}`;
    const info = await engine.upload(id, req.body, name, title);
    const doc = { id, folder: folder.id, title, sourceFile: name, sourceType: ext.slice(1).toUpperCase(), pages: info.pageCount, addedAt: new Date().toISOString(), addedBy: req.user.name };
    state.documents.push(doc);
    saveState();
    audit.append({ event: "document.uploaded", user: req.user, document: describeDocument(doc), detail: `${name}, ${req.body.length} bytes, ${info.pageCount} pages, ${info.uploadMs} ms`, ip: clientIp(req) });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

function filterEntries(query) {
  return audit.entries.filter(
    (e) =>
      (!query.event || e.event === query.event) &&
      (!query.user || e.user?.id === query.user) &&
      (!query.document || e.document?.id === query.document)
  );
}

app.get("/api/admin/audit", (req, res) => {
  const list = filterEntries(req.query);
  res.json({ events: EVENTS, total: list.length, entries: list.slice(-Number(req.query.limit || 500)).reverse(), chain: audit.verify() });
});

app.get("/api/admin/audit.csv", (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="data-room-audit-${day}.csv"` });
  res.send(toCsv(filterEntries(req.query)));
});

app.get("/api/admin/engagement", (req, res) => {
  const pages = Object.fromEntries(state.documents.map((d) => [d.id, d.pages]));
  res.json({ rows: engagement(audit.entries).map((r) => ({ ...r, pageCount: pages[r.documentId] ?? null })) });
});

// Errors as JSON, for the browser and the test script.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

await engine.waitUntilUp();
await seedDocuments();
app.listen(PORT, () => console.log(`Secure data room PoC on http://localhost:${PORT} (viewer tokens valid ${TOKEN_TTL} s)`));
