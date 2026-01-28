// === CONFIG ===
const API_BASE = "https://api.sc.hannesrieder.ch"; // dein Worker (wichtig!)
const MAX_MB_DEFAULT = 8; // wird auch serverseitig geprüft
const MAX_BYTES_DEFAULT = MAX_MB_DEFAULT * 1024 * 1024;

const el = (id) => document.getElementById(id);

const dropzone = el("dropzone");
const fileInput = el("file");
const uploadBtn = el("uploadBtn");
const pwInput = el("pw");
const statusEl = el("status");

const result = el("result");
const linkEl = el("link");
const copyBtn = el("copyBtn");
const img = el("img");

const viewer = el("viewer");
const viewerHint = el("viewerHint");
const pwWrap = el("pwWrap");
const pwView = el("pwView");
const unlockBtn = el("unlockBtn");
const copyViewBtn = el("copyViewBtn");
const imgView = el("imgView");

const maxHint = el("maxhint");
maxHint.textContent = `max ${MAX_MB_DEFAULT} MB • png/jpg/webp/gif`;

// --- helpers ---
function setStatus(msg, kind) {
  statusEl.classList.remove("error", "ok");
  if (kind) statusEl.classList.add(kind);
  statusEl.textContent = msg || "";
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function isImageFile(file) {
  return file && file.type && file.type.startsWith("image/");
}

function validateFile(file) {
  if (!file) return "Bitte ein Bild auswählen.";
  if (!isImageFile(file)) return "Nur Bilder sind erlaubt.";
  if (file.size > MAX_BYTES_DEFAULT) return `Zu groß. Max ${MAX_MB_DEFAULT} MB.`;
  return null;
}

function openFilePicker() {
  fileInput.click();
}

function setDropzoneDrag(active) {
  dropzone.classList.toggle("is-drag", active);
}

// --- drag & drop ---
["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    setDropzoneDrag(true);
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    setDropzoneDrag(false);
  });
});
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    fileInput.files = e.dataTransfer.files;
    setStatus(`bereit: ${f.name} (${Math.round(f.size/1024)} KB)`);
  }
});

dropzone.addEventListener("click", openFilePicker);
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") openFilePicker();
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) setStatus(`bereit: ${f.name} (${Math.round(f.size/1024)} KB)`);
});

// --- upload ---
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  const err = validateFile(file);
  if (err) return setStatus(err, "error");

  setStatus("uploading…");

  const form = new FormData();
  form.append("file", file);
  const pw = pwInput.value.trim();
  if (pw) form.append("password", pw);

  let res;
  try {
    res = await fetch(API_BASE + "/upload", { method: "POST", body: form });
  } catch (e) {
    return setStatus("Netzwerkfehler (Worker nicht erreichbar).", "error");
  }

  if (!res.ok) {
    const t = await res.text();
    return setStatus(`Upload Fehler: ${t}`, "error");
  }

  const data = await res.json();
  const id = data.id;
  const pageUrl = location.origin + "/" + id;

  // show result
  result.hidden = false;
  viewer.hidden = true;
  linkEl.href = pageUrl;
  linkEl.textContent = pageUrl;

  // push url
  history.pushState({}, "", "/" + id);

  // load preview via authenticated fetch (works for password protected too)
  await loadIntoImageElement(id, img, pw);

  setStatus("done ✓ (auto-delete nach 5 tagen)", "ok");
});

// --- copy link ---
copyBtn?.addEventListener("click", async () => {
  const url = linkEl?.href || "";
  if (!url) return;
  const ok = await copyToClipboard(url);
  setStatus(ok ? "link copied ✓" : "copy fehlgeschlagen", ok ? "ok" : "error");
});

// --- viewer mode (if path contains id) ---
async function loadIntoImageElement(id, targetImgEl, password) {
  // use fetch so we can send X-Password header (img src can't)
  const headers = {};
  if (password) headers["X-Password"] = password;

  const r = await fetch(API_BASE + "/" + encodeURIComponent(id), { headers });
  if (r.status === 401) {
    throw new Error("PASSWORD_REQUIRED");
  }
  if (!r.ok) {
    throw new Error("NOT_FOUND");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  targetImgEl.src = url;
}

async function enterViewer(id) {
  // hide uploader result area, show viewer block
  result.hidden = true;
  viewer.hidden = false;

  const pageUrl = location.origin + "/" + id;

  viewerHint.textContent = id;
  copyViewBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(pageUrl);
    setStatus(ok ? "link copied ✓" : "copy fehlgeschlagen", ok ? "ok" : "error");
  }, { once: true });

  // try without password
  try {
    await loadIntoImageElement(id, imgView, "");
    pwWrap.hidden = true;
    unlockBtn.hidden = true;
    setStatus("", null);
  } catch (e) {
    if (e.message === "PASSWORD_REQUIRED") {
      pwWrap.hidden = false;
      unlockBtn.hidden = false;
      viewerHint.textContent = `${id} • passwort nötig`;
      setStatus("Passwort eingeben um das Bild zu laden.", "error");
    } else {
      viewerHint.textContent = `${id} • not found`;
      setStatus("Nicht gefunden.", "error");
    }
  }

  unlockBtn.addEventListener("click", async () => {
    const pw = pwView.value.trim();
    if (!pw) return setStatus("Bitte Passwort eingeben.", "error");
    setStatus("lade…");
    try {
      await loadIntoImageElement(id, imgView, pw);
      setStatus("ok ✓", "ok");
    } catch (e) {
      setStatus("falsches passwort oder not found.", "error");
    }
  });
}

(() => {
  const params = new URLSearchParams(location.search);
  const qid = (params.get("id") || "").trim();     // aus ?id=...
  const pid = location.pathname.replace("/", "").trim(); // aus /abc123

  const id = qid || pid;
  if (!id) return;

  enterViewer(id);
})();

