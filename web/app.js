// Secure data room PoC - browser side.
//
// The viewer opens a document from Document Engine with a JWT the Node server
// issued for this user and this document only. The JWT is read only and
// short-lived: when it expires the viewer closes, and a new one is issued only
// after the server checks the user's access again. Every page shows a
// watermark with the viewer's name, company and the time. Time spent on each
// page is reported to the server's audit trail.

const VIEWER_BASE = "https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.24.0/";
// The only toolbar items a data room user gets: navigation, zoom and search.
// No print, no export, no annotation or editing tools.
const TOOLBAR = ["sidebar-thumbnails", "pager", "pan", "zoom-out", "zoom-in", "zoom-mode", "spacer", "search"];
// Page time is sent to the server every few seconds and when the viewer closes.
const FLUSH_INTERVAL_MS = 10_000;
// A page scrolled past in less than this is not counted as viewed.
const MIN_PAGE_SECONDS = 1;

const state = { me: null, project: "", room: null, open: null, watermarkLog: [] };
window.dataRoom = state; // read by the end-to-end test

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

// UTC everywhere, like the audit trail and the download watermark.
const formatTime = (date) =>
  date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", timeZoneName: "short" });

// ---------------------------------------------------------------------------
// Sign-in (demo user picker) and folder tree
// ---------------------------------------------------------------------------

async function init() {
  const { users, project } = await api("/api/users");
  state.project = project;
  $("project").textContent = project;
  document.title = `${project} - Data Room`;

  const params = new URLSearchParams(location.search);
  let me = await api("/api/me");
  const wanted = params.get("user");
  if (wanted && wanted !== me.user?.id) me = await api("/api/session", { method: "POST", body: JSON.stringify({ userId: wanted }) });
  if (!me.user) me = await api("/api/session", { method: "POST", body: JSON.stringify({ userId: "owen" }) });
  state.me = me.user;

  const select = $("user-select");
  select.innerHTML = users
    .map((u) => `<option value="${u.id}">${escapeHtml(u.name)} - ${escapeHtml(u.companyLabel)}, ${escapeHtml(u.title.toLowerCase())}</option>`)
    .join("");
  select.value = state.me.id;
  // Switching user signs in again: close the viewer, then reload.
  select.addEventListener("change", async () => {
    await closeViewer("user switched");
    await api("/api/session", { method: "POST", body: JSON.stringify({ userId: select.value }) });
    location.href = location.pathname;
  });
  $("admin-link").hidden = !state.me.isAdmin;

  await loadRoom();
  const docId = params.get("doc");
  if (docId) openDocument(docId);
}

async function loadRoom() {
  state.room = await api("/api/room");
  renderTree();
  renderEmpty();
}

function renderTree() {
  const me = state.me;
  const rights = me.isAdmin
    ? "Administrator: all folders"
    : `${me.canDownload ? "View and watermarked download" : "View only"} - every page watermarked - activity recorded`;
  $("tree").innerHTML = `
    <div class="me">
      <div class="me-name">${escapeHtml(me.name)}</div>
      <div class="muted">${escapeHtml(me.title)}, ${escapeHtml(me.companyName)}</div>
      <div class="badge-row"><span class="role">${escapeHtml(me.companyLabel)}</span></div>
      <div class="muted small">${escapeHtml(rights)}</div>
    </div>
    ${state.room.folders
      .map(
        (f) => `<div class="folder">
          <div class="folder-name">${escapeHtml(f.name)}</div>
          <ul>${f.documents
            .map(
              (d) => `<li><button type="button" class="doc-link" data-doc="${escapeHtml(d.id)}">
                <span class="doc-name">${escapeHtml(d.title)}</span>
                <span class="muted small">${d.pages} p. - ${escapeHtml(d.sourceType)}</span></button></li>`
            )
            .join("")}</ul>
        </div>`
      )
      .join("")}`;
  for (const button of $("tree").querySelectorAll(".doc-link")) {
    button.addEventListener("click", () => openDocument(button.dataset.doc));
  }
  markActive();
}

function markActive() {
  for (const button of $("tree").querySelectorAll(".doc-link")) {
    button.classList.toggle("active", button.dataset.doc === state.open?.doc.id);
  }
}

function renderEmpty() {
  const count = state.room.folders.reduce((n, f) => n + f.documents.length, 0);
  $("empty").innerHTML = `<div>
    <h2>${escapeHtml(state.project)}</h2>
    <p>${count} documents in ${state.room.folders.length} folders are open to you. Pick a document on the left.</p>
    <p class="muted small">Documents are view only. Printing, saving and copying text are disabled. Your name, your company and the time are shown on every page.</p>
  </div>`;
  $("empty").hidden = Boolean(state.open);
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

async function requestToken(docId, reason) {
  return api(`/api/documents/${encodeURIComponent(docId)}/viewer-token`, { method: "POST", body: JSON.stringify({ reason }) });
}

async function openDocument(docId, { reason = "open", pageIndex = 0 } = {}) {
  await closeViewer("switched document");
  hideOverlay();
  $("empty").hidden = true;

  let session;
  try {
    session = await requestToken(docId, reason);
  } catch (err) {
    showOverlay(`<h3>Access refused</h3><p>${escapeHtml(err.message)}</p><p class="muted small">The refusal was recorded in the audit trail.</p>`);
    return;
  }

  const open = { doc: session.document, session, instance: null, tracker: createTracker(), timers: [] };
  state.open = open;
  markActive();
  renderDocBar();

  try {
    open.instance = await NutrientViewer.load({
      container: "#viewer",
      serverUrl: session.serverUrl,
      documentId: session.document.id,
      authPayload: { jwt: session.jwt },
      instant: false,
      licenseKey: session.licenseKey || undefined,
      baseUrl: VIEWER_BASE,
      toolbarItems: NutrientViewer.defaultToolbarItems.filter((item) => TOOLBAR.includes(item.type)),
      initialViewState: new NutrientViewer.ViewState({
        readOnly: true,
        allowPrinting: false,
        allowExport: false,
        currentPageIndex: Math.min(pageIndex, session.document.pages - 1),
      }),
      disableTextSelection: true,
      disableForms: true,
      renderPageCallback: drawWatermark,
      // Document Engine refused the token. If it has expired, close the
      // viewer. Otherwise the administrator revoked it: ask the server for a
      // new one, which it only issues if the user still has access.
      onAuthFailed: async () => {
        if (state.open !== open) return;
        if (Date.now() >= open.session.expiresAt) return expireViewer(open);
        try {
          const renewed = await requestToken(open.doc.id, "renew");
          open.session = renewed;
          open.instance?.setSession(renewed.jwt);
          renderDocBar();
        } catch (err) {
          await closeViewer("access withdrawn");
          showOverlay(`<h3>Access withdrawn</h3><p>${escapeHtml(err.message)}</p>
            <p class="muted small">The data room administrator closed this folder to your company. Document Engine ended the viewing session at once.</p>`);
          await loadRoom();
          $("empty").hidden = true;
        }
      },
    });
  } catch (err) {
    showOverlay(`<h3>The document could not be opened</h3><p>${escapeHtml(err.message)}</p>`);
    return;
  }
  if (state.open !== open) return;

  const instance = open.instance;
  window.viewerInstance = instance; // handy in the console and for the test
  open.tracker.setPage(instance.viewState.currentPageIndex + 1);
  instance.addEventListener("viewState.currentPageIndex.change", (index) => open.tracker.setPage(index + 1));
  open.timers.push(setInterval(() => flushActivity(open), FLUSH_INTERVAL_MS));
  open.timers.push(setInterval(() => tickCountdown(open), 1000));
  tickCountdown(open);
}

function renderDocBar() {
  const open = state.open;
  $("doc-bar").hidden = !open;
  if (!open) return;
  $("doc-title").textContent = open.doc.title;
  $("doc-meta").textContent = `${open.doc.folder} - ${open.doc.pages} page${open.doc.pages === 1 ? "" : "s"}`;
  $("download-btn").hidden = !open.session.canDownload;
  $("view-only").hidden = open.session.canDownload;
}

function tickCountdown(open) {
  if (state.open !== open) return;
  const left = Math.max(0, Math.round((open.session.expiresAt - Date.now()) / 1000));
  const chip = $("token-chip");
  chip.textContent = `Token expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  chip.classList.toggle("warn", left <= 20);
  if (left <= 0) expireViewer(open);
}

// The token expired. Document Engine would refuse every further request made
// with it, so the viewer is closed. A new token needs a new access check.
async function expireViewer(open) {
  if (state.open !== open) return;
  const expiredAt = new Date(open.session.expiresAt);
  const pageIndex = open.instance?.viewState.currentPageIndex ?? 0;
  await closeViewer("expired");
  showOverlay(`<h3>Viewing token expired</h3>
    <p>The token for this document expired at ${escapeHtml(formatTime(expiredAt))}. Document Engine refuses it from now on, so the viewer was closed.</p>
    <p class="muted small">Tokens live ${open.session.ttlSeconds} seconds. A new one is issued only after the server checks your access again.</p>
    <button type="button" id="renew-btn">Request a new token</button>`);
  $("renew-btn").addEventListener("click", () => openDocument(open.doc.id, { reason: "renew", pageIndex }));
}

async function closeViewer(reason) {
  const open = state.open;
  if (!open) return;
  state.open = null;
  open.timers.forEach(clearInterval);
  await flushActivity(open, reason);
  if (open.instance) NutrientViewer.unload(open.instance);
  else NutrientViewer.unload("#viewer");
  window.viewerInstance = null;
  renderDocBar();
  markActive();
}

$("close-btn").addEventListener("click", async () => {
  await closeViewer("closed");
  renderEmpty();
});

// ---------------------------------------------------------------------------
// Watermark drawn on every page the viewer renders
// ---------------------------------------------------------------------------

function drawWatermark(ctx, pageIndex, pageSize) {
  const me = state.me;
  const when = formatTime(new Date());
  const line1 = `${me.name} - ${me.companyName}`;
  const line2 = `${when} - Confidential`;
  const { width, height } = pageSize;
  const size = Math.max(9, Math.min(width, height) / 30);

  // Diagonal tiles across the whole page, so a crop still shows a name.
  ctx.save();
  ctx.fillStyle = "rgba(31, 58, 95, 0.14)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const reach = Math.hypot(width, height) / 2;
  const stepX = size * 19;
  const stepY = size * 6.5;
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    for (let x = -reach + (row % 2) * (stepX / 2); x <= reach; x += stepX) {
      ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
      ctx.fillText(line1, x, y - size * 0.6);
      ctx.font = `${size * 0.72}px Helvetica, Arial, sans-serif`;
      ctx.fillText(line2, x, y + size * 0.6);
    }
  }
  ctx.restore();

  // A plain line at the bottom of the page.
  ctx.save();
  ctx.fillStyle = "rgba(122, 31, 31, 0.9)";
  ctx.font = `${Math.max(6, width / 95)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`Viewed by ${me.name} (${me.companyName}) on ${when} - page ${pageIndex + 1} - ${state.project} - Confidential`, width / 2, height - 4);
  ctx.restore();

  state.watermarkLog.push({ pageIndex, text: line1, at: Date.now() });
  if (state.watermarkLog.length > 200) state.watermarkLog.shift();
}

// ---------------------------------------------------------------------------
// Time per page
// ---------------------------------------------------------------------------

// Counts the time the current page is on screen while the tab is visible.
function createTracker() {
  let page = null;
  let since = performance.now();
  let running = document.visibilityState === "visible";
  let totals = new Map();

  function add(minSeconds) {
    const now = performance.now();
    if (page !== null && running) {
      const seconds = (now - since) / 1000;
      if (seconds >= minSeconds) totals.set(page, (totals.get(page) || 0) + seconds);
    }
    since = now;
  }

  return {
    setPage(next) {
      if (next === page) return;
      add(MIN_PAGE_SECONDS);
      page = next;
    },
    visibility(visible) {
      add(0);
      running = visible;
    },
    // Returns the time per page since the last call and starts again.
    take() {
      add(0);
      const pages = [...totals].map(([p, seconds]) => ({ page: p, seconds: Math.round(seconds * 10) / 10 })).filter((v) => v.seconds > 0);
      totals = new Map();
      return pages;
    },
  };
}

async function flushActivity(open, closed) {
  const pages = open.tracker.take();
  if (!pages.length && !closed) return;
  const body = JSON.stringify({ tokenId: open.session.tokenId, pages, closed });
  try {
    await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {
    // offline: the next flush will carry on from here
  }
}

document.addEventListener("visibilitychange", () => state.open?.tracker.visibility(document.visibilityState === "visible"));

// The tab is closing: send what is left with sendBeacon, which survives unload.
window.addEventListener("pagehide", () => {
  const open = state.open;
  if (!open) return;
  const pages = open.tracker.take();
  navigator.sendBeacon("/api/activity", new Blob([JSON.stringify({ tokenId: open.session.tokenId, pages, closed: "tab closed" })], { type: "application/json" }));
});

// ---------------------------------------------------------------------------
// Download, print and copy
// ---------------------------------------------------------------------------

$("download-btn").addEventListener("click", async () => {
  const open = state.open;
  if (!open) return;
  const button = $("download-btn");
  button.disabled = true;
  button.textContent = "Preparing watermarked copy...";
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(open.doc.id)}/download`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const reference = res.headers.get("X-Download-Reference");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${open.doc.title} - ${reference}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Downloaded with reference ${reference}. The download is recorded.`);
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Download watermarked PDF";
  }
});

// The viewer has no print or export button and Document Engine refuses to
// send the PDF without the "download" permission. These shortcuts would only
// print or save the surrounding web page; block them too.
window.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && ["p", "s"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      toast(e.key.toLowerCase() === "p" ? "Printing is disabled in this data room." : "Saving is disabled in this data room.");
    }
  },
  true
);
$("viewer").addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function showOverlay(html) {
  $("overlay").innerHTML = `<div class="overlay-box">${html}</div>`;
  $("overlay").hidden = false;
  $("empty").hidden = true;
}

function hideOverlay() {
  $("overlay").hidden = true;
}

init().catch((err) => {
  document.body.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
});
