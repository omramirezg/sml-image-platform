/* ============================================================
   SmartMedia Labs — Frontend logic
   Flow:
     1. User picks an image
     2. Request a presigned URL from the backend
     3. PUT directly to the input bucket
     4. Poll the output bucket until the processed version
        appears (or timeout)
     5. Show the result + refresh the history
   ============================================================ */

(() => {
  const CFG = window.CONFIG;

  // ---------- Refs ----------
  const $ = (id) => document.getElementById(id);
  const dropZone        = $("dropZone");
  const fileInput       = $("fileInput");
  const resultCard      = $("resultCard");
  const originalPreview = $("originalPreview");
  const processedPreview= $("processedPreview");
  const originalName    = $("originalName");
  const originalSize    = $("originalSize");
  const processedStatus = $("processedStatus");
  const processedSize   = $("processedSize");
  const processingOverlay = $("processingOverlay");
  const processingLabel = $("processingLabel");
  const savings         = $("savings");
  const savingsValue    = $("savingsValue");
  const downloadBtn     = $("downloadBtn");
  const cancelBtn       = $("cancelBtn");
  const newUploadBtn    = $("newUploadBtn");
  const historyGrid     = $("historyGrid");
  const historyEmpty    = $("historyEmpty");
  const refreshHistoryBtn = $("refreshHistoryBtn");
  const connStatus      = $("connStatus");
  const toastStack      = $("toastStack");

  // ---------- Helpers ----------
  const fmtBytes = (n) => {
    if (n == null || isNaN(n)) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0; let v = Number(n);
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const toast = (msg, type = "info", ms = 3500) => {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 300);
    }, ms);
  };

  const setConn = (label, ok = true) => {
    connStatus.textContent = label;
    const dot = document.querySelector(".status-dot");
    if (dot) dot.style.background = ok ? "var(--accent-3)" : "var(--danger)";
    if (dot) dot.style.boxShadow = `0 0 8px ${ok ? "var(--accent-3)" : "var(--danger)"}`;
  };

  const apiUrl = (path) => {
    if (!CFG.API_URL) return null;
    return CFG.API_URL.replace(/\/$/, "") + path;
  };

  // ---------- Backend calls ----------
  async function requestPresignedUrl(file) {
    if (CFG.DEMO_MODE) {
      // Simulate: random id and a missing uploadUrl
      await sleep(400);
      return {
        imageId: "demo-" + Math.random().toString(36).slice(2, 10),
        uploadUrl: null  // demo marker
      };
    }
    const url = apiUrl(CFG.ENDPOINTS.PRESIGNED_URL);
    if (!url) throw new Error("API_URL not configured");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        size: file.size
      })
    });
    if (!res.ok) throw new Error(`Backend responded ${res.status}`);
    const raw = await res.json();
    // The payload may come wrapped (API Gateway proxy) or not, and
    // field names can vary. Normalize here.
    const data = (raw && typeof raw.body === "string") ? JSON.parse(raw.body) : raw;
    const uploadUrl = data.uploadUrl || data.url || data.presignedUrl || data.signedUrl;
    const imageId   = data.imageId   || data.key || data.id || data.fileName;
    if (!uploadUrl) {
      console.error("Unexpected response from backend:", raw);
      throw new Error("Response does not include an upload URL");
    }
    return { uploadUrl, imageId };
  }

  async function uploadToS3(uploadUrl, file) {
    if (CFG.DEMO_MODE || !uploadUrl) {
      // Simulate upload with a small delay
      await sleep(800);
      return;
    }
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  }

  async function fetchHistory() {
    if (CFG.DEMO_MODE) {
      return loadDemoHistory();
    }
    return loadRealHistory();
  }

  // ---------- Output bucket polling ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function buildOutputUrl(imageId) {
    // The output bucket follows the {imageId}.jpg pattern.
    // If the backend already returned an extension, strip it before appending.
    const base = String(imageId).replace(/\.[a-z0-9]+$/i, "");
    return `${CFG.OUTPUT_BUCKET_URL.replace(/\/$/, "")}/${base}.jpg`;
  }

  function imageExists(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(true);
      img.onerror = () => resolve(false);
      // Cache-bust so we don't get stuck on a cached 404
      img.src = url + "?t=" + Date.now();
    });
  }

  async function waitForProcessedImage(imageId) {
    const url = buildOutputUrl(imageId);
    const start = Date.now();
    while (Date.now() - start < CFG.POLL_TIMEOUT_MS) {
      if (cancelRequested) throw new Error("__cancelled__");
      if (await imageExists(url)) return url;
      await sleep(CFG.POLL_INTERVAL_MS);
    }
    throw new Error("La imagen tardó demasiado en procesarse. Intenta de nuevo.");
  }

  // ---------- Demo: simulate processing in the browser ----------
  function compressInBrowser(file) {
    // To make the demo visible and useful: resize to max 1024px and
    // export JPEG quality 0.7. UI-only.
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error("empty canvas"));
            resolve(blob);
          }, "image/jpeg", 0.7);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- LocalStorage for demo history ----------
  const DEMO_KEY = "sml.demo.history";
  function loadDemoHistory() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]"); }
    catch { return []; }
  }
  function saveDemoHistory(items) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(items.slice(0, 24))); }
    catch {}
  }
  function pushDemoHistory(entry) {
    const items = loadDemoHistory();
    items.unshift(entry);
    saveDemoHistory(items);
  }
  function removeFromDemoHistory(imageId) {
    const items = loadDemoHistory().filter((it) => it.imageId !== imageId);
    saveDemoHistory(items);
    return items;
  }

  // ---------- LocalStorage for real-mode history ----------
  const REAL_KEY = "sml.real.history";
  function loadRealHistory() {
    try { return JSON.parse(localStorage.getItem(REAL_KEY) || "[]"); }
    catch { return []; }
  }
  function pushRealHistory(entry) {
    const items = loadRealHistory();
    items.unshift(entry);
    try { localStorage.setItem(REAL_KEY, JSON.stringify(items.slice(0, 24))); }
    catch {}
  }

  // ---------- UI state ----------
  function resetResultCard() {
    resultCard.classList.add("hidden");
    originalPreview.classList.remove("is-loaded");
    processedPreview.classList.remove("is-loaded");
    processedPreview.src = "";
    processingOverlay.classList.remove("hidden");
    processingLabel.textContent = "Procesando…";
    processedStatus.textContent = "Esperando…";
    processedSize.textContent = "—";
    savings.classList.add("hidden");
    savingsValue.textContent = "—";
    downloadBtn.classList.add("hidden");
    downloadBtn.removeAttribute("href");
  }

  function showOriginal(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      originalPreview.src = e.target.result;
      originalPreview.onload = () => originalPreview.classList.add("is-loaded");
    };
    reader.readAsDataURL(file);
    originalName.textContent = file.name;
    originalSize.textContent = fmtBytes(file.size);
  }

  function showProcessed(url, sizeAfter, sizeBefore) {
    processedPreview.src = url;
    processedPreview.onload = () => {
      processedPreview.classList.add("is-loaded");
      processingOverlay.classList.add("hidden");
    };
    processedStatus.textContent = "Procesada";
    processedSize.textContent = fmtBytes(sizeAfter);
    if (sizeBefore && sizeAfter) {
      const pct = Math.max(0, Math.round((1 - sizeAfter / sizeBefore) * 100));
      savingsValue.textContent = `-${pct}%`;
      savings.classList.remove("hidden");
    }
    downloadBtn.href = url;
    downloadBtn.classList.remove("hidden");
  }

  function showError(msg) {
    processingLabel.textContent = "Error";
    processedStatus.textContent = "Error";
    processingOverlay.style.background = "rgba(120, 20, 20, 0.5)";
    toast(msg, "error", 5000);
  }

  // ---------- Main flow ----------
  let isBusy = false;
  let cancelRequested = false;

  async function handleFile(file) {
    if (isBusy) return;
    if (!file || !file.type.startsWith("image/")) {
      toast("Selecciona un archivo de imagen válido.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("La imagen excede 10 MB.", "error");
      return;
    }

    isBusy = true;
    cancelRequested = false;
    resetResultCard();
    resultCard.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
    newUploadBtn.classList.add("hidden");
    showOriginal(file);
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });

    try {
      processingLabel.textContent = "Solicitando upload…";
      const { imageId, uploadUrl } = await requestPresignedUrl(file);

      processingLabel.textContent = "Subiendo…";
      await uploadToS3(uploadUrl, file);

      processingLabel.textContent = "Procesando…";
      let processedUrl, sizeAfter;

      if (CFG.DEMO_MODE) {
        const blob = await compressInBrowser(file);
        processedUrl = URL.createObjectURL(blob);
        sizeAfter = blob.size;
        await sleep(900);
        pushDemoHistory({
          imageId,
          originalName: file.name,
          sizeBefore: file.size,
          sizeAfter,
          processedUrl,
          status: "processed",
          createdAt: Date.now()
        });
        renderHistory(await fetchHistory());
      } else {
        processedUrl = await waitForProcessedImage(imageId);
        try {
          const head = await fetch(processedUrl, { method: "HEAD", mode: "cors" });
          const len = head.headers.get("Content-Length");
          sizeAfter = len ? parseInt(len, 10) : null;
        } catch {
          sizeAfter = null;
        }
        pushRealHistory({
          imageId,
          originalName: file.name,
          sizeBefore: file.size,
          sizeAfter,
          processedUrl,
          status: "processed",
          createdAt: Date.now()
        });
        renderHistory(fetchHistory()).catch(() => {});
      }

      showProcessed(processedUrl, sizeAfter, file.size);
      toast("Imagen optimizada.", "success");
    } catch (err) {
      if (cancelRequested) {
        resetResultCard();
      } else {
        console.error(err);
        showError(err.message || "Algo salió mal.");
      }
    } finally {
      isBusy = false;
      cancelRequested = false;
      cancelBtn.classList.add("hidden");
      newUploadBtn.classList.remove("hidden");
    }
  }

  // ---------- History ----------
  async function deleteHistoryItem(imageId) {
    if (!imageId) return;
    if (CFG.DEMO_MODE) {
      const items = removeFromDemoHistory(imageId);
      await renderHistory(items);
      toast("Eliminado del historial.", "info");
      return;
    }
    // Real mode: backend doesn't expose DELETE yet. Leave a clear seam
    // for when it does (e.g. DELETE /history/{imageId}).
    toast("Eliminar aún no está disponible con el backend real.", "error");
  }

  async function renderHistory(itemsPromise) {
    let items;
    try {
      items = itemsPromise instanceof Promise ? await itemsPromise : itemsPromise;
    } catch (e) {
      items = [];
    }
    historyGrid.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      historyGrid.appendChild(historyEmpty);
      return;
    }
    items.forEach((it) => {
      const url = it.processedUrl || (it.imageId ? buildOutputUrl(it.imageId) : null);
      if (!url) return;
      const div = document.createElement("div");
      div.className = "history-item";
      div.title = it.originalName || it.imageId || "";
      // Only render the delete button when the backend supports it.
      // In real mode there's no DELETE endpoint yet — hide it until then.
      const deleteBtn = CFG.DEMO_MODE
        ? `<button class="history-delete" type="button" aria-label="Eliminar">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
               <path d="M18 6 6 18M6 6l12 12"/>
             </svg>
           </button>`
        : "";
      div.innerHTML = `
        <img src="${url}" alt="" loading="lazy" />
        ${deleteBtn}
        <div class="item-info">
          <span>${(it.originalName || it.imageId || "").slice(0, 18)}</span>
          <span>${fmtBytes(it.sizeAfter)}</span>
        </div>
      `;
      div.onclick = () => window.open(url, "_blank", "noopener");
      // Delete button: stop propagation so the tile click (open in new tab) does not fire
      const delBtn = div.querySelector(".history-delete");
      if (delBtn) {
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteHistoryItem(it.imageId);
        });
      }
      historyGrid.appendChild(div);
    });
  }

  async function refreshHistory() {
    try {
      const items = await fetchHistory();
      await renderHistory(items);
    } catch (e) {
      console.warn("Could not load history:", e);
    }
  }

  // ---------- Events ----------
  // Download: el atributo download es ignorado en links cross-origin (CloudFront ≠ S3).
  // Se intercepta el click, se trae la imagen como blob y se crea un link local.
  downloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const href = downloadBtn.getAttribute("href");
    if (!href) return;
    try {
      const res = await fetch(href, { mode: "cors" });
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = (originalName.textContent || "imagen").replace(/\.[^.]+$/, "") + "-optimizada.jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      window.open(href, "_blank", "noopener");
    }
  });

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("is-dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("is-dragover");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = "";
  });
  newUploadBtn.addEventListener("click", () => {
    resetResultCard();
    fileInput.click();
  });
  refreshHistoryBtn.addEventListener("click", refreshHistory);
  cancelBtn.addEventListener("click", () => {
    if (isBusy) cancelRequested = true;
  });

  // ---------- Init ----------
  if (CFG.DEMO_MODE) {
    setConn("Modo demo", true);
    // The 24-item cap only applies to demo history (localStorage); in real
    // mode the backend decides the page size, so the hint would be misleading.
    $("historyHint")?.classList.remove("hidden");
  } else if (!CFG.API_URL) {
    setConn("Sin API", false);
    toast("API_URL vacía en config.js — modo demo desactivado pero sin backend.", "error", 6000);
  } else {
    setConn("Conectado", true);
  }

  refreshHistory();
})();
