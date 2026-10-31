// Thin client for the Document Engine server API (API token authentication).

const OFFICE_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
};

export const SUPPORTED_EXTENSIONS = Object.keys(OFFICE_TYPES);

export function createDocumentEngine({ url, apiToken }) {
  async function call(path, options = {}) {
    return fetch(`${url}${path}`, {
      ...options,
      headers: { Authorization: `Token token=${apiToken}`, ...(options.headers || {}) },
    });
  }

  async function failIfNotOk(res, what) {
    if (!res.ok) throw new Error(`${what} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  return {
    async waitUntilUp() {
      for (let attempt = 1; attempt <= 60; attempt++) {
        try {
          if ((await fetch(`${url}/healthcheck`)).ok) return;
        } catch {
          // not up yet
        }
        if (attempt === 1) console.log(`[setup] Waiting for Document Engine at ${url} ...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(`Document Engine is not reachable at ${url}. Did you run docker compose up -d?`);
    },

    // { pageCount, title } or null if the document does not exist.
    async info(documentId) {
      const res = await call(`/api/documents/${encodeURIComponent(documentId)}/document_info`);
      if (res.status === 404) return null;
      await failIfNotOk(res, "document_info");
      const { data } = await res.json();
      return { pageCount: data.pageCount, title: data.title };
    },

    // Uploads a PDF or an Office file. Document Engine converts Office files
    // to PDF on upload, so the viewer and the Build API always see a PDF.
    async upload(documentId, buffer, fileName, title) {
      const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: OFFICE_TYPES[ext] || "application/octet-stream" }), fileName);
      form.append("document_id", documentId);
      form.append("title", title);
      const started = Date.now();
      await failIfNotOk(await call("/api/documents", { method: "POST", body: form }), `Upload of ${fileName}`);
      const info = await this.info(documentId);
      return { ...info, uploadMs: Date.now() - started };
    },

    // Builds a copy of a stored document with text watermarks burned in:
    // `watermark` actions, then `flatten` so they become page content that
    // cannot be deleted as annotations.
    async buildWatermarkedPdf(documentId, { watermarks, title, author }) {
      const instructions = {
        parts: [{ document: { id: documentId } }],
        actions: [...watermarks.map((w) => ({ type: "watermark", ...w })), { type: "flatten" }],
        output: { type: "pdf", metadata: { title, author } },
      };
      const form = new FormData();
      form.append("instructions", JSON.stringify(instructions));
      const res = await failIfNotOk(await call("/api/build", { method: "POST", body: form }), "Build API");
      return Buffer.from(await res.arrayBuffer());
    },

    // Revokes viewer JWTs (they need a `jti`). Document Engine also ends the
    // viewer sessions opened with them at once.
    async revoke(jwts) {
      if (!jwts.length) return 0;
      const res = await failIfNotOk(
        await call("/api/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jwts }) }),
        "JWT revocation"
      );
      const body = await res.json().catch(() => ({}));
      return Array.isArray(body.data) ? body.data.length : jwts.length;
    },
  };
}
