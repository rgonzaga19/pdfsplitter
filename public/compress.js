/* ============================================
   COMPRESS PDF
   Recompresses the images embedded inside each PDF (leaving text and vector
   content untouched) by swapping each image XObject for a freshly re-encoded,
   smaller JPEG. Everything runs locally in the browser.
   ============================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.min.js";

const fileInput = document.getElementById("pdfFile");
const uploadZone = document.querySelector(".upload-zone");
const uploadSection = document.getElementById("uploadSection");
const compressWorkspace = document.getElementById("compressWorkspace");
const fileListEl = document.getElementById("fileList");
const compressStats = document.getElementById("compressStats");
const fileLabel = document.getElementById("fileLabel");
const addMoreBtn = document.getElementById("addMoreBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const compressBtn = document.getElementById("compressBtn");
const qualityGrid = document.getElementById("qualityGrid");
const processingOverlay = document.getElementById("processingOverlay");
const processingText = document.getElementById("processingText");
const successMessage = document.getElementById("successMessage");
const successBody = document.getElementById("successBody");
const successOkBtn = document.getElementById("successOkBtn");

/* ============================================
   STATE
   ============================================ */

const items = []; // { id, file, pageCount, size, thumbDataUrl }
let itemIdCounter = 0;
let selectedPreset = "balanced";
let isCompressing = false;

const QUALITY_PRESETS = {
    high: { quality: 0.85, maxDimension: 2200 },
    balanced: { quality: 0.65, maxDimension: 1600 },
    small: { quality: 0.42, maxDimension: 1100 }
};

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/* ============================================
   QUALITY PRESET SELECTION
   ============================================ */

qualityGrid.querySelectorAll(".quality-card").forEach(card => {
    card.addEventListener("click", () => {
        selectedPreset = card.dataset.preset;
        qualityGrid.querySelectorAll(".quality-card").forEach(c => {
            c.classList.toggle("active", c === card);
            c.setAttribute("aria-checked", c === card ? "true" : "false");
        });
    });
});

/* ============================================
   FILE LIST RENDERING
   ============================================ */

function updateWorkspaceVisibility() {
    const hasFiles = items.length > 0;
    compressWorkspace.style.display = hasFiles ? "block" : "none";
    uploadSection.style.display = hasFiles ? "none" : "block";
    compressBtn.disabled = !hasFiles || isCompressing;
}

function updateStats() {
    if (items.length === 0) {
        compressStats.innerHTML = "";
        return;
    }
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    compressStats.innerHTML = `
        <div class="stat">
            <div class="stat-value">${items.length}</div>
            <div class="stat-label">${items.length === 1 ? "File" : "Files"}</div>
        </div>
        <div class="stat">
            <div class="stat-value">${formatBytes(totalSize)}</div>
            <div class="stat-label">Total Size</div>
        </div>
    `;
}

function renderFileList() {
    fileListEl.innerHTML = "";
    items.forEach(item => {
        const row = document.createElement("div");
        row.className = "compress-file-row";
        row.dataset.itemId = item.id;

        const thumb = document.createElement("div");
        thumb.className = "compress-file-thumb";
        if (item.thumbDataUrl) {
            const img = document.createElement("img");
            img.src = item.thumbDataUrl;
            img.alt = "";
            thumb.appendChild(img);
        } else {
            thumb.innerHTML = `<span class="material-symbols-rounded">description</span>`;
        }

        const info = document.createElement("div");
        info.className = "compress-file-info";
        info.innerHTML = `
            <p class="compress-file-name" title="${item.file.name}">${item.file.name}</p>
            <p class="compress-file-meta">${item.pageCount} ${item.pageCount === 1 ? "page" : "pages"} &middot; ${formatBytes(item.size)}</p>
        `;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "compress-file-remove";
        removeBtn.title = "Remove";
        removeBtn.innerHTML = `<span class="material-symbols-rounded">close</span>`;
        removeBtn.addEventListener("click", () => {
            const idx = items.findIndex(i => i.id === item.id);
            if (idx !== -1) items.splice(idx, 1);
            renderFileList();
            updateStats();
            updateWorkspaceVisibility();
        });

        row.appendChild(thumb);
        row.appendChild(info);
        row.appendChild(removeBtn);
        fileListEl.appendChild(row);
    });
}

/* ============================================
   FILE LOADING (queued so multiple files never race)
   ============================================ */

let fileLoadQueue = Promise.resolve();

function queueFileLoad(file) {
    fileLoadQueue = fileLoadQueue
        .then(() => handleFileLoad(file))
        .catch(err => {
            console.error(`Failed to load "${file.name}"`, err);
            alert(`Failed to load "${file.name}". It may be corrupted or not a valid PDF.`);
        });
    return fileLoadQueue;
}

async function handleFileLoad(file) {
    fileLabel.textContent = file.name;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

    let thumbDataUrl = null;
    try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.22 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        thumbDataUrl = canvas.toDataURL("image/png");
    } catch (err) {
        console.warn("Could not render thumbnail", err);
    }

    items.push({
        id: itemIdCounter++,
        file,
        arrayBuffer,
        pageCount: pdf.numPages,
        size: file.size,
        thumbDataUrl
    });

    renderFileList();
    updateStats();
    updateWorkspaceVisibility();
}

fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    fileInput.value = "";
    files.forEach(file => queueFileLoad(file));
});

addMoreBtn.addEventListener("click", () => fileInput.click());

clearAllBtn.addEventListener("click", () => {
    items.length = 0;
    fileLabel.textContent = "No file chosen";
    renderFileList();
    updateStats();
    updateWorkspaceVisibility();
});

/* ============================================
   DRAG AND DROP
   ============================================ */

document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
});

uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove("drag-over");

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const pdfFiles = Array.from(droppedFiles).filter(file => {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (!isPdf) console.warn(`Skipped non-PDF file: ${file.name}`);
        return isPdf;
    });

    if (pdfFiles.length === 0) {
        alert("Please drop PDF files only. No valid PDF files were found.");
        return;
    }

    pdfFiles.forEach(file => queueFileLoad(file));
});

/* ============================================
   SUCCESS MODAL
   ============================================ */

function showSuccessMessage(text) {
    successBody.textContent = text;
    successMessage.classList.add("show");
}

function hideSuccessMessage() {
    successMessage.classList.remove("show");
}

successOkBtn.addEventListener("click", hideSuccessMessage);
successMessage.addEventListener("click", (e) => {
    if (e.target === successMessage) hideSuccessMessage();
});

/* ============================================
   COMPRESSION ENGINE
   Swaps each image XObject's reference for a freshly re-encoded, smaller
   JPEG. Text, fonts, and vector drawing operators are never touched — only
   the image resource dictionary entries are replaced, so everything else
   in the PDF renders exactly as before.
   ============================================ */

function resolveDict(value) {
    return value instanceof PDFLib.PDFDict ? value : null;
}

async function decodeRawBitmapToBlob(stream, dict, width, height) {
    const colorSpaceObj = dict.lookup(PDFLib.PDFName.of("ColorSpace"));
    const bpcObj = dict.lookup(PDFLib.PDFName.of("BitsPerComponent"));
    const bpc = bpcObj && bpcObj.asNumber ? bpcObj.asNumber() : 8;
    const csName = colorSpaceObj instanceof PDFLib.PDFName ? colorSpaceObj.asString() : null;

    // Only handle the common, unambiguous cases. Indexed palettes, CMYK, ICC
    // profiles, and non-8-bit samples need a full color-space interpreter to
    // decode correctly, so we leave those images untouched rather than risk
    // corrupting them.
    if (bpc !== 8 || (csName !== "/DeviceRGB" && csName !== "/DeviceGray")) {
        return null;
    }

    const decoded = PDFLib.decodePDFRawStream(stream).decode();
    const channels = csName === "/DeviceRGB" ? 3 : 1;
    if (decoded.length < width * height * channels) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const out = imageData.data;

    for (let p = 0; p < width * height; p++) {
        if (channels === 3) {
            out[p * 4] = decoded[p * 3];
            out[p * 4 + 1] = decoded[p * 3 + 1];
            out[p * 4 + 2] = decoded[p * 3 + 2];
        } else {
            const v = decoded[p];
            out[p * 4] = v;
            out[p * 4 + 1] = v;
            out[p * 4 + 2] = v;
        }
        out[p * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

function getFilterNames(dict) {
    const filterObj = dict.lookup(PDFLib.PDFName.of("Filter"));
    const names = [];
    if (filterObj instanceof PDFLib.PDFName) {
        names.push(filterObj.asString());
    } else if (filterObj instanceof PDFLib.PDFArray) {
        for (let i = 0; i < filterObj.size(); i++) {
            const f = filterObj.lookup(i, PDFLib.PDFName);
            if (f) names.push(f.asString());
        }
    }
    return names;
}

async function recompressImageStream(pdfDoc, stream, preset) {
    if (!(stream instanceof PDFLib.PDFStream)) return null;

    const dict = stream.dict;
    const subtype = dict.lookup(PDFLib.PDFName.of("Subtype"));
    if (!(subtype instanceof PDFLib.PDFName) || subtype.asString() !== "/Image") return null;

    // Skip stencil masks — these carry 1-bit stencil data, not photographic
    // content, and re-encoding them as JPEG would corrupt them.
    const imageMask = dict.lookup(PDFLib.PDFName.of("ImageMask"));
    if (imageMask instanceof PDFLib.PDFBool && imageMask.asBoolean()) return null;

    const widthObj = dict.lookup(PDFLib.PDFName.of("Width"));
    const heightObj = dict.lookup(PDFLib.PDFName.of("Height"));
    const width = widthObj && widthObj.asNumber ? widthObj.asNumber() : null;
    const height = heightObj && heightObj.asNumber ? heightObj.asNumber() : null;
    if (!width || !height || width * height < 64 * 64) return null;

    const filterNames = getFilterNames(dict);
    let sourceBlob = null;

    try {
        if (filterNames.includes("/DCTDecode")) {
            // Already JPEG-encoded — use the raw bytes directly, no decoding needed.
            if (!(stream instanceof PDFLib.PDFRawStream)) return null;
            sourceBlob = new Blob([stream.getContents()], { type: "image/jpeg" });
        } else if (filterNames.includes("/JPXDecode") || filterNames.includes("/CCITTFaxDecode")) {
            // JPEG2000 / fax-encoded images aren't worth re-decoding in-browser.
            return null;
        } else {
            sourceBlob = await decodeRawBitmapToBlob(stream, dict, width, height);
        }

        if (!sourceBlob) return null;

        const bitmap = await createImageBitmap(sourceBlob);
        const scale = Math.min(1, preset.maxDimension / Math.max(bitmap.width, bitmap.height));
        const outW = Math.max(1, Math.round(bitmap.width * scale));
        const outH = Math.max(1, Math.round(bitmap.height * scale));

        const outCanvas = document.createElement("canvas");
        outCanvas.width = outW;
        outCanvas.height = outH;
        outCanvas.getContext("2d").drawImage(bitmap, 0, 0, outW, outH);
        bitmap.close();

        const newBlob = await new Promise(resolve => outCanvas.toBlob(resolve, "image/jpeg", preset.quality));
        const newBytes = new Uint8Array(await newBlob.arrayBuffer());

        // Only keep the recompressed version if it actually shrank.
        if (newBytes.length >= stream.getContentsSize()) return null;

        const embedded = await pdfDoc.embedJpg(newBytes);
        return embedded.ref;
    } catch (err) {
        console.warn("Skipped recompressing an image", err);
        return null;
    }
}

async function compressPdfBytes(arrayBuffer, preset, onProgress) {
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { updateMetadata: false });
    const pages = pdfDoc.getPages();
    const replacementCache = new Map(); // original ref key -> new PDFRef | null

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const resources = page.node.Resources ? page.node.Resources() : null;
        if (resources) {
            const xObjects = resolveDict(resources.lookup(PDFLib.PDFName.of("XObject")));
            if (xObjects) {
                for (const [name, ref] of xObjects.entries()) {
                    if (!(ref instanceof PDFLib.PDFRef)) continue;
                    const cacheKey = ref.toString();

                    if (replacementCache.has(cacheKey)) {
                        const cached = replacementCache.get(cacheKey);
                        if (cached) xObjects.set(name, cached);
                        continue;
                    }

                    const stream = pdfDoc.context.lookup(ref);
                    const newRef = await recompressImageStream(pdfDoc, stream, preset);
                    replacementCache.set(cacheKey, newRef);
                    if (newRef) xObjects.set(name, newRef);
                }
            }
        }
        if (onProgress) onProgress(i + 1, pages.length);
    }

    return pdfDoc.save({ useObjectStreams: true });
}

/* ============================================
   COMPRESS & DOWNLOAD
   ============================================ */

function showProcessing(text) {
    processingText.textContent = text;
    processingOverlay.style.display = "flex";
}

function hideProcessing() {
    processingOverlay.style.display = "none";
}

compressBtn.addEventListener("click", async () => {
    if (isCompressing || items.length === 0) return;

    isCompressing = true;
    compressBtn.disabled = true;
    addMoreBtn.disabled = true;
    clearAllBtn.disabled = true;
    fileInput.disabled = true;

    const preset = QUALITY_PRESETS[selectedPreset];
    const results = [];

    try {
        for (let f = 0; f < items.length; f++) {
            const item = items[f];
            showProcessing(
                items.length > 1
                    ? `Compressing "${item.file.name}" (${f + 1} of ${items.length})...`
                    : `Compressing "${item.file.name}"...`
            );

            const compressedBytes = await compressPdfBytes(item.arrayBuffer, preset, (done, total) => {
                processingText.textContent =
                    (items.length > 1
                        ? `Compressing "${item.file.name}" (${f + 1} of ${items.length})`
                        : `Compressing "${item.file.name}"`) + ` — page ${done}/${total}`;
            });

            results.push({
                name: item.file.name.replace(/\.pdf$/i, ""),
                originalSize: item.size,
                compressedSize: compressedBytes.length,
                bytes: compressedBytes
            });
        }

        const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
        const totalCompressed = results.reduce((sum, r) => sum + r.compressedSize, 0);
        const reduction = totalOriginal > 0
            ? Math.max(0, Math.round((1 - totalCompressed / totalOriginal) * 100))
            : 0;

        if (results.length === 1) {
            const r = results[0];
            const blob = new Blob([r.bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${r.name}-compressed.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            const zip = new JSZip();
            results.forEach(r => zip.file(`${r.name}-compressed.pdf`, r.bytes));
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "compressed-pdfs.zip";
            a.click();
            URL.revokeObjectURL(url);
        }

        showSuccessMessage(
            `Reduced from ${formatBytes(totalOriginal)} to ${formatBytes(totalCompressed)}` +
            (reduction > 0 ? ` (${reduction}% smaller).` : `. This file was already well-optimized.`)
        );
    } catch (err) {
        console.error("Failed to compress PDF(s)", err);
        alert("Something went wrong while compressing your PDF(s).");
    } finally {
        hideProcessing();
        isCompressing = false;
        addMoreBtn.disabled = false;
        clearAllBtn.disabled = false;
        fileInput.disabled = false;
        updateWorkspaceVisibility();
    }
});
