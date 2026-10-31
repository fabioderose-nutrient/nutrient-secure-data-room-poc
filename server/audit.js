// Append-only audit trail in data/audit.jsonl.
//
// Each entry carries the SHA-256 of the previous entry and its own hash, so
// editing or deleting a line breaks the chain and `verify()` reports where.

import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";

const GENESIS = "0".repeat(64);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export const EVENTS = {
  "session.started": "Signed in",
  "document.opened": "Document opened",
  "page.viewed": "Page viewed",
  "document.closed": "Document closed",
  "token.expired": "Viewing token expired",
  "token.renewed": "Viewing token renewed",
  download: "Download",
  "access.denied": "Access refused",
  "access.changed": "Folder access changed",
  "download-right.changed": "Download right changed",
  "document.uploaded": "Document uploaded",
};

export function createAuditLog(file) {
  mkdirSync(dirname(file), { recursive: true });
  const entries = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

  function hashOf(entry) {
    const { hash, ...rest } = entry;
    return sha256(JSON.stringify(rest));
  }

  return {
    entries,

    // event: one of EVENTS. user and document are copied (id, name, company /
    // id, title, folder) so the trail stays readable after changes.
    append({ event, user, document, page, seconds, detail, ip }) {
      const prev = entries.at(-1);
      const entry = {
        seq: (prev?.seq ?? 0) + 1,
        at: new Date().toISOString(),
        event,
        user: user ? { id: user.id, name: user.name, company: user.companyName } : null,
        document: document ? { id: document.id, title: document.title, folder: document.folderName } : null,
        page: page ?? null,
        seconds: seconds ?? null,
        detail: detail ?? "",
        ip: ip ?? "",
        prevHash: prev?.hash ?? GENESIS,
      };
      entry.hash = hashOf(entry);
      appendFileSync(file, JSON.stringify(entry) + "\n");
      entries.push(entry);
      return entry;
    },

    verify() {
      let prevHash = GENESIS;
      for (const entry of entries) {
        if (entry.prevHash !== prevHash || hashOf(entry) !== entry.hash) {
          return { ok: false, entries: entries.length, brokenAt: entry.seq };
        }
        prevHash = entry.hash;
      }
      return { ok: true, entries: entries.length, lastHash: prevHash };
    },
  };
}

const CSV_COLUMNS = [
  ["seq", (e) => e.seq],
  ["time_utc", (e) => e.at],
  ["event", (e) => e.event],
  ["user", (e) => e.user?.name],
  ["company", (e) => e.user?.company],
  ["document", (e) => e.document?.title],
  ["folder", (e) => e.document?.folder],
  ["page", (e) => e.page],
  ["seconds", (e) => e.seconds],
  ["detail", (e) => e.detail],
  ["ip", (e) => e.ip],
  ["hash", (e) => e.hash],
];

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  // Quote, and neutralise cells that a spreadsheet would run as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(entries) {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(",")];
  for (const e of entries) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(e))).join(","));
  return lines.join("\r\n") + "\r\n";
}

// Time per page and opens per document and user, from the trail.
export function engagement(entries) {
  const byKey = new Map();
  for (const e of entries) {
    if (!e.document || !e.user || !["page.viewed", "document.opened"].includes(e.event)) continue;
    const key = `${e.document.id}|${e.user.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, { documentId: e.document.id, document: e.document.title, userId: e.user.id, user: e.user.name, company: e.user.company, opens: 0, seconds: 0, pages: {}, lastSeen: e.at });
    }
    const row = byKey.get(key);
    row.lastSeen = e.at;
    if (e.event === "document.opened") row.opens++;
    else {
      row.seconds += e.seconds;
      row.pages[e.page] = (row.pages[e.page] ?? 0) + e.seconds;
    }
  }
  return [...byKey.values()].map((r) => ({ ...r, seconds: Math.round(r.seconds * 10) / 10 }));
}
