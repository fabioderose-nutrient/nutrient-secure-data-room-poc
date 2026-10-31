// Secure data room PoC - administration page.
//
// Folder access per bidder, download rights per user, uploads, the time
// spent on each page and the audit trail. Every call is checked by the server:
// only the data room administrator gets an answer.

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const admin = { state: null, filters: { event: "", user: "", document: "" } };

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const duration = (seconds) => {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};
const utc = (iso) => iso.replace("T", " ").slice(0, 19);

async function init() {
  const [{ users, project }, me] = await Promise.all([api("/api/users"), api("/api/me")]);
  $("project").textContent = project;
  document.title = `${project} - Data Room Administration`;
  const select = $("user-select");
  select.innerHTML = users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} - ${escapeHtml(u.companyLabel)}</option>`).join("");
  select.value = me.user?.id ?? "";
  select.addEventListener("change", async () => {
    await api("/api/session", { method: "POST", body: JSON.stringify({ userId: select.value }) });
    location.reload();
  });
  try {
    await refreshState();
  } catch (err) {
    // A bidder opened this page: the server refused and recorded it.
    $("admin").innerHTML = `<section class="card"><h2>Administration</h2><p>${escapeHtml(err.message)}</p><p class="muted small">The refusal was recorded in the audit trail.</p></section>`;
    return;
  }
  await refreshActivity();
  setInterval(refreshActivity, 5000);
}

async function refreshState() {
  admin.state = await api("/api/admin/state");
  renderAccess();
  renderUsers();
  renderUploadFolders();
}

function renderAccess() {
  const { companies, folders } = admin.state;
  $("access").innerHTML = `
    <tr><th>Folder</th><th class="num">Documents</th>${companies.map((c) => `<th class="center">${escapeHtml(c.label)}<br><span class="muted small">${escapeHtml(c.name)}</span></th>`).join("")}</tr>
    ${folders
      .map(
        (f) => `<tr><td>${escapeHtml(f.name)}</td><td class="num">${f.documents.length}</td>
          ${companies
            .map((c) => `<td class="center"><input type="checkbox" data-folder="${f.id}" data-company="${c.id}" ${f.access[c.id] ? "checked" : ""} aria-label="${escapeHtml(`${f.name}: ${c.name}`)}"></td>`)
            .join("")}</tr>`
      )
      .join("")}`;
  for (const box of $("access").querySelectorAll("input")) {
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        await api(`/api/admin/folders/${box.dataset.folder}/access`, { method: "PUT", body: JSON.stringify({ company: box.dataset.company, allowed: box.checked }) });
      } catch (err) {
        alert(err.message);
      }
      await refreshState();
      await refreshActivity();
    });
  }
}

function renderUsers() {
  $("users").innerHTML = `
    <tr><th>User</th><th>Company</th><th>Role</th><th class="center">May download</th></tr>
    ${admin.state.users
      .map(
        (u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.companyName)}<br><span class="muted small">${escapeHtml(u.companyLabel)}</span></td><td>${escapeHtml(u.title)}</td>
          <td class="center">${u.isAdmin ? '<span class="muted small">always</span>' : `<input type="checkbox" data-user="${u.id}" ${u.canDownload ? "checked" : ""} aria-label="${escapeHtml(u.name)} may download">`}</td></tr>`
      )
      .join("")}`;
  for (const box of $("users").querySelectorAll("input")) {
    box.addEventListener("change", async () => {
      await api(`/api/admin/users/${box.dataset.user}/download`, { method: "PUT", body: JSON.stringify({ allowed: box.checked }) }).catch((err) => alert(err.message));
      await refreshState();
      await refreshActivity();
    });
  }
}

function renderUploadFolders() {
  const select = $("upload-folder");
  const current = select.value;
  select.innerHTML = admin.state.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
  if (current) select.value = current;
}

$("upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("upload-file").files[0];
  if (!file) return;
  const status = $("upload-status");
  status.textContent = `Uploading ${file.name}...`;
  const query = new URLSearchParams({ folder: $("upload-folder").value, name: file.name, title: $("upload-title").value });
  try {
    const res = await fetch(`/api/admin/documents?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    status.textContent = `Added "${body.document.title}" (${body.document.pages} pages).`;
    $("upload").reset();
  } catch (err) {
    status.textContent = `Upload failed: ${err.message}`;
  }
  await refreshState();
  await refreshActivity();
});

async function refreshActivity() {
  const query = new URLSearchParams(Object.entries(admin.filters).filter(([, v]) => v));
  const [audit, { rows }] = await Promise.all([api(`/api/admin/audit?${query}`), api("/api/admin/engagement")]);
  renderFilters(audit.events);
  renderChain(audit.chain);
  renderAudit(audit);
  renderEngagement(rows);
}

function renderFilters(events) {
  if ($("f-event").options.length) return;
  $("f-event").innerHTML = `<option value="">All events</option>` + Object.entries(events).map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  $("f-user").innerHTML = `<option value="">All users</option>` + admin.state.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  $("f-document").innerHTML =
    `<option value="">All documents</option>` + admin.state.folders.flatMap((f) => f.documents).map((d) => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join("");
  for (const [id, key] of [["f-event", "event"], ["f-user", "user"], ["f-document", "document"]]) {
    $(id).addEventListener("change", () => {
      admin.filters[key] = $(id).value;
      refreshActivity();
    });
  }
}

function renderChain(chain) {
  $("chain").innerHTML = chain.ok
    ? `<span class="ok" title="Last hash ${escapeHtml(chain.lastHash ?? "")}">Hash chain intact</span> <span class="muted small">${chain.entries} entries</span>`
    : `<span class="bad">Hash chain broken at entry ${chain.brokenAt}</span>`;
}

function renderAudit({ entries, total }) {
  $("audit").innerHTML = `
    <tr><th class="num">#</th><th>Time (UTC)</th><th>Event</th><th>User</th><th>Company</th><th>Document</th><th class="num">Page</th><th class="num">Seconds</th><th>Detail</th></tr>
    ${entries
      .map(
        (e) => `<tr>
          <td class="num">${e.seq}</td><td>${utc(e.at)}</td>
          <td><span class="ev ev-${e.event.replace(/\./g, "-")}">${escapeHtml(e.event)}</span></td>
          <td>${escapeHtml(e.user?.name ?? "")}</td><td>${escapeHtml(e.user?.company ?? "")}</td>
          <td>${escapeHtml(e.document?.title ?? "")}</td>
          <td class="num">${e.page ?? ""}</td><td class="num">${e.seconds ?? ""}</td>
          <td class="detail">${escapeHtml(e.detail)}</td></tr>`
      )
      .join("")}
    ${entries.length < total ? `<tr><td colspan="9" class="muted small">Showing the last ${entries.length} of ${total} entries. The CSV export has all of them.</td></tr>` : ""}`;
}

function renderEngagement(rows) {
  if (!rows.length) {
    $("engagement").innerHTML = `<tr><td class="muted">No document opened yet.</td></tr>`;
    return;
  }
  rows.sort((a, b) => a.document.localeCompare(b.document) || b.seconds - a.seconds);
  $("engagement").innerHTML = `
    <tr><th>Document</th><th>User</th><th>Company</th><th class="num">Opens</th><th class="num">Time</th><th class="num">Pages viewed</th><th>Time per page</th></tr>
    ${rows
      .map((r) => {
        const count = r.pageCount ?? Math.max(0, ...Object.keys(r.pages).map(Number));
        const max = Math.max(1, ...Object.values(r.pages));
        const bars = Array.from({ length: count }, (_, i) => {
          const s = r.pages[i + 1] ?? 0;
          return `<span class="${s ? "" : "zero"}" style="height:${Math.max(2, (s / max) * 26)}px" title="Page ${i + 1}: ${duration(s)}"></span>`;
        }).join("");
        const viewed = Object.keys(r.pages).length;
        return `<tr><td>${escapeHtml(r.document)}</td><td>${escapeHtml(r.user)}</td><td>${escapeHtml(r.company)}</td>
          <td class="num">${r.opens}</td><td class="num">${duration(r.seconds)}</td><td class="num">${viewed} / ${count}</td>
          <td><div class="bars">${bars}</div></td></tr>`;
      })
      .join("")}`;
}

$("csv-btn").addEventListener("click", () => {
  const query = new URLSearchParams(Object.entries(admin.filters).filter(([, v]) => v));
  location.href = `/api/admin/audit.csv?${query}`;
});

init().catch((err) => {
  $("admin").innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
});
