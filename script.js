// === CONFIG ===
const API_BASE = "https://api.sc.hannesrieder.ch"; // dein Worker
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
if (maxHint) maxHint.textContent = `max ${MAX_MB_DEFAULT} MB • png/jpg/webp/gif`;

// --- helpers ---
function setStatus(msg, kind) {
  if (!statusEl) return;
  statusEl.classList.remove("error", "ok");
  if (kind) statusEl.classList.add(kind);
  statusEl.textContent = msg || "";
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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
  fileInput?.click();
}

function setDropzoneDrag(active) {
  dropzone?.classList.toggle("is-drag", active);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Lädt Bild in ein <img>.
 * - Ohne Passwort: <img src> + retry (stabil nach Upload)
 * - Mit Passwort: fetch + Header + retry
 */
async function loadIntoImageElement(id, targetImgEl, password, retries = 6) {
  const baseUrl = API_BASE + "/" + encodeURIComponent(id);
  const bust = () => `${baseUrl}?t=${Date.now()}`;

  // Public case: direct image src (no fetch/cors headaches)
  if (!password) {
    for (let i = 0; i < retries; i++) {
      const ok = await new Promise((resolve) => {
        const onLoad = () => cleanup(true);
        const onErr = () => cleanup(false);
        const cleanup = (v) => {
          targetImgEl.removeEventListener("load", onLoad);
          targetImgEl.removeEventListener("error", onErr);
          resolve(v);
        };
        targetImgEl.addEventListener("load", onLoad, { once: true });
        targetImgEl.addEventListener("error", onErr, { once: true });

        targetImgEl.src = bust();
      });

      if (ok) return;
      await sleep(350 * (i + 1));
    }
    throw new Error("NOT_READY");
  }

  // Password case: fetch with header
  for (let i = 0; i < retries; i++) {
    const r = await fetch(bust(), { headers: { "X-Password": password } });

    if (r.status === 401) throw new Error("PASSWORD_REQUIRED");
    if (r.ok) {
      const blob = await r.blob();
      targetImgEl.src = URL.createObjectURL(blob);
      return;
    }

    await sleep(350 * (i + 1));
  }

  throw new Error("NOT_READY");
}

// --- drag & drop ---
if (dropzone) {
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
    if (f && fileInput) {
      fileInput.files = e.dataTransfer.files;
      setStatus(`bereit: ${f.name} (${Math.round(f.size / 1024)} KB)`);
    }
  });

  dropzone.addEventListener("click", openFilePicker);
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openFilePicker();
  });
}

fileInput?.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) setStatus(`bereit: ${f.name} (${Math.round(f.size / 1024)} KB)`);
});

// --- upload ---
uploadBtn?.addEventListener("click", async () => {
  const file = fileInput?.files?.[0];
  const err = validateFile(file);
  if (err) return setStatus(err, "error");

  setStatus("uploading…");

  const form = new FormData();
  form.append("file", file);

  const pw = (pwInput?.value || "").trim();
  if (pw) form.append("password", pw);

  let res;
  try {
    res = await fetch(API_BASE + "/upload", { method: "POST", body: form });
  } catch {
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
  if (result) result.hidden = false;
  if (viewer) viewer.hidden = true;

  if (linkEl) {
    linkEl.href = pageUrl;
    linkEl.textContent = pageUrl;
  }

  // keep pretty URL
  history.pushState({}, "", "/" + id);

  // preview
  try {
    await loadIntoImageElement(id, img, pw, 6);
    setStatus("done ✓ (auto-delete nach 5 tagen)", "ok");
  } catch (e) {
    if (e.message === "NOT_READY") {
      setStatus("done ✓ (preview lädt gleich…)", "ok");
    } else {
      setStatus("Upload done, aber preview konnte nicht geladen werden.", "error");
    }
  }
});

// --- copy link (uploader result) ---
copyBtn?.addEventListener("click", async () => {
  const url = linkEl?.href || "";
  if (!url) return;
  const ok = await copyToClipboard(url);
  setStatus(ok ? "link copied ✓" : "copy fehlgeschlagen", ok ? "ok" : "error");
});

// --- viewer mode ---
async function enterViewer(id) {
  // hide uploader result area, show viewer block
  if (result) result.hidden = true;
  if (viewer) viewer.hidden = false;

  const pageUrl = location.origin + "/" + id;

  if (viewerHint) viewerHint.textContent = id;

  // Copy-Link im Viewer
  copyViewBtn?.addEventListener(
    "click",
    async () => {
      const ok = await copyToClipboard(pageUrl);
      setStatus(ok ? "link copied ✓" : "copy fehlgeschlagen", ok ? "ok" : "error");
    },
    { once: true }
  );

  // Erst public versuchen (zeigt Bild sofort, wenn es public ist)
  setStatus("lade…");

  if (pwWrap) pwWrap.hidden = true;
  if (unlockBtn) unlockBtn.hidden = true;

  try {
    await loadIntoImageElement(id, imgView, "", 6);
    setStatus("", null);
    return;
  } catch (e) {
    // Wenn noch nicht “warm”: nicht als Not Found behandeln
    if (e.message === "NOT_READY") {
      setStatus("Bild wird noch verteilt… kurz warten oder reload.", "error");
      // trotzdem Passwort-UI anbieten (falls protected)
      if (pwWrap) pwWrap.hidden = false;
      if (unlockBtn) unlockBtn.hidden = false;
      if (viewerHint) viewerHint.textContent = `${id} • wird geladen…`;
      return;
    }

    // Bei Passwortschutz oder echtem Not Found:
    if (pwWrap) pwWrap.hidden = false;
    if (unlockBtn) unlockBtn.hidden = false;

    if (e.message === "PASSWORD_REQUIRED") {
      if (viewerHint) viewerHint.textContent = `${id} • passwort nötig`;
      setStatus("Passwort eingeben um das Bild zu laden.", "error");
    } else {
      if (viewerHint) viewerHint.textContent = `${id} • not found`;
      setStatus("Nicht gefunden.", "error");
    }
  }

  // Unlock handler (nur einmal binden)
  unlockBtn?.addEventListener(
    "click",
    async () => {
      const pw = (pwView?.value || "").trim();
      if (!pw) return setStatus("Bitte Passwort eingeben.", "error");

      setStatus("lade…");
      try {
        await loadIntoImageElement(id, imgView, pw, 6);
        setStatus("ok ✓", "ok");
        if (viewerHint) viewerHint.textContent = id;
      } catch {
        setStatus("falsches passwort oder not found.", "error");
      }
    },
    { once: true }
  );
}

// --- initial route check ---
(() => {
  const params = new URLSearchParams(location.search);
  const qid = (params.get("id") || "").trim(); // aus ?id=...
  const pid = location.pathname.replace("/", "").trim(); // aus /abc123
  const id = qid || pid;

  if (!id) return;

  enterViewer(id);
})();
