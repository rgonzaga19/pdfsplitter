const uploadedFiles = [];
let totalLoadedPages = 0;

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "./pdfjs/pdf.worker.min.js";

const fileInput = document.getElementById("pdfFile");
const uploadZone = document.querySelector(".upload-zone");
const pagesDiv = document.getElementById("pages");
const splitBtn = document.getElementById("splitBtn");
const refreshBtn = document.getElementById("refreshBtn");
const deleteBlankBtn = document.getElementById("deleteBlankBtn");
const cancelBlankScanBtn = document.getElementById("cancelBlankScanBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const gridViewBtn = document.getElementById("gridViewBtn");
const listViewBtn = document.getElementById("listViewBtn");
const pagesLoadingOverlay = document.getElementById("pagesLoadingOverlay");
const pagesLoadingText = document.getElementById("pagesLoadingText");
const stats = document.getElementById("stats");
const fileLabel = document.getElementById("fileLabel");
const previewCanvas = document.getElementById("previewCanvas");
const prevPreviewBtn = document.getElementById("prevPreviewBtn");
const nextPreviewBtn = document.getElementById("nextPreviewBtn");
const rotatePreviewBtn = document.getElementById("rotatePreviewBtn");
const successMessage = document.getElementById("successMessage");
const successOkBtn = document.getElementById("successOkBtn");
const landingPage = document.getElementById("landingPage");
const editorPage = document.getElementById("editorPage");

function showEditorPage() {
    landingPage.style.display = "none";
    editorPage.style.display = "flex";
}

function showLandingPage() {
    editorPage.style.display = "none";
    landingPage.style.display = "block";
}

/* ============================================
   GRID / LIST VIEW TOGGLE
   ============================================ */

const PAGES_VIEW_STORAGE_KEY = "pdfSplitterPagesView";

// Re-applies each thumbnail's rotation transform after the card size changes
// (grid vs list use different --card-w/--card-h), so rotated pages keep the
// correct fit-to-card scale instead of showing a stale one.
function refreshAllCanvasRotations() {
    requestAnimationFrame(() => {
        getPageWrappers().forEach(wrapper => {
            setWrapperRotation(wrapper, getWrapperRotation(wrapper));
        });
    });
}

function setPagesView(view) {
    const isList = view === "list";

    pagesDiv.classList.toggle("view-list", isList);
    if (gridViewBtn) gridViewBtn.classList.toggle("active", !isList);
    if (listViewBtn) listViewBtn.classList.toggle("active", isList);

    try {
        localStorage.setItem(PAGES_VIEW_STORAGE_KEY, view);
    } catch (err) {
        // localStorage can be unavailable (e.g. private browsing) - not critical
    }

    refreshAllCanvasRotations();
}

if (gridViewBtn) gridViewBtn.addEventListener("click", () => setPagesView("grid"));
if (listViewBtn) listViewBtn.addEventListener("click", () => setPagesView("list"));

// Restore the last view the user picked, defaulting to grid.
(function initPagesView() {
    let savedView = "grid";
    try {
        savedView = localStorage.getItem(PAGES_VIEW_STORAGE_KEY) || "grid";
    } catch (err) {
        savedView = "grid";
    }
    setPagesView(savedView);
})();

const loadedPdfs = [];
const pageOrder = [];
let pageIdCounter = 0;
let isSplitting = false;
let isLoadingPages = false;

function showPagesLoadingOverlay(total) {
    isLoadingPages = true;
    if (pagesLoadingOverlay) pagesLoadingOverlay.style.display = "flex";
    updatePagesLoadingProgress(0, total);
    updateUndoRedoButtons();
}

function updatePagesLoadingProgress(loaded, total) {
    if (pagesLoadingText) {
        pagesLoadingText.textContent = `Loading pages... ${loaded} / ${total}`;
    }
}

function hidePagesLoadingOverlay() {
    isLoadingPages = false;
    if (pagesLoadingOverlay) pagesLoadingOverlay.style.display = "none";
    updateUndoRedoButtons();
}
const previewState = {
    currentIndex: 0,
    totalPages: 0
};
const PREVIEW_MAX_SCALE = 2.25;

function getPreviewAvailableSize() {
    const horizontalChrome = window.innerWidth <= 720 ? 40 : 160;
    const verticalChrome = window.innerWidth <= 720 ? 88 : 112;

    return {
        width: Math.max(280, window.innerWidth - horizontalChrome),
        height: Math.max(320, window.innerHeight - verticalChrome)
    };
}

function showSuccessMessage() {
    successMessage.classList.add("show");
}

function hideSuccessMessage() {
    successMessage.classList.remove("show");
}

successOkBtn.addEventListener("click", hideSuccessMessage);

successMessage.addEventListener("click", (e) => {
    if (e.target === successMessage) {
        hideSuccessMessage();
    }
});

closeModal.onclick = () => {

    previewModal.style.display = "none";
};

previewModal.onclick = (e) => {

    if (e.target === previewModal) {

        previewModal.style.display = "none";
    }
};

function getPreviewPageReference(globalIndex) {
    const entry = pageOrder[globalIndex - 1];
    if (!entry) return null;

    return {
        pdf: loadedPdfs[entry.pdfIndex].pdf,
        pageNumber: entry.pageNumber,
        globalIndex
    };
}

async function renderPreviewPage(globalIndex) {
    const ref = getPreviewPageReference(globalIndex);
    if (!ref) return;

    const page = await ref.pdf.getPage(ref.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableSize = getPreviewAvailableSize();
    const rawCssScale = Math.min(
        PREVIEW_MAX_SCALE,
        availableSize.width / baseViewport.width,
        availableSize.height / baseViewport.height
    );
    const targetCssWidth = Math.floor(baseViewport.width * rawCssScale);
    const targetCssHeight = Math.floor(baseViewport.height * rawCssScale);
    const cssScale = Math.min(
        targetCssWidth / baseViewport.width,
        targetCssHeight / baseViewport.height
    );
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = page.getViewport({ scale: cssScale });
    const ctx = previewCanvas.getContext("2d");
    const displayWidth = Math.floor(viewport.width);
    const displayHeight = Math.floor(viewport.height);

    previewCanvas.width = Math.floor(displayWidth * pixelRatio);
    previewCanvas.height = Math.floor(displayHeight * pixelRatio);
    previewCanvas.style.width = `${displayWidth}px`;
    previewCanvas.style.height = `${displayHeight}px`;

    const renderContext = {
        canvasContext: ctx,
        viewport
    };

    if (pixelRatio !== 1) {
        renderContext.transform = [pixelRatio, 0, 0, pixelRatio, 0, 0];
    }

    await page.render(renderContext).promise;

    previewState.currentIndex = globalIndex;
    updatePreviewNavigation();
    previewRotation = getWrapperRotation(getPageWrappers()[globalIndex - 1]);
    applyCanvasRotation(previewCanvas, previewRotation);
}

function updatePreviewNavigation() {
    prevPreviewBtn.disabled = previewState.currentIndex <= 1;
    nextPreviewBtn.disabled = previewState.currentIndex >= previewState.totalPages;
}

function normalizeRotation(rotation) {
    return ((Number(rotation) % 360) + 360) % 360;
}

function applyCanvasRotation(canvas, rotation) {
    if (!canvas) return;

    const normalized = normalizeRotation(rotation);
    let scale = 1;
    const pageCard = canvas.closest('.page-card');

    if (pageCard && pageCard.clientWidth > 0 && pageCard.clientHeight > 0) {
        const availableWidth = pageCard.clientWidth - 12;
        const availableHeight = pageCard.clientHeight - 12;
        const canvasWidth = canvas.offsetWidth || canvas.width;
        const canvasHeight = canvas.offsetHeight || canvas.height;
        const rotatedSideways = normalized === 90 || normalized === 270;
        const rotatedWidth = rotatedSideways ? canvasHeight : canvasWidth;
        const rotatedHeight = rotatedSideways ? canvasWidth : canvasHeight;

        scale = Math.min(1, availableWidth / rotatedWidth, availableHeight / rotatedHeight);
    } else if (canvas === previewCanvas && previewModal.style.display !== 'none') {
        const availableSize = getPreviewAvailableSize();
        const canvasWidth = canvas.offsetWidth || canvas.width;
        const canvasHeight = canvas.offsetHeight || canvas.height;
        const rotatedSideways = normalized === 90 || normalized === 270;
        const rotatedWidth = rotatedSideways ? canvasHeight : canvasWidth;
        const rotatedHeight = rotatedSideways ? canvasWidth : canvasHeight;

        scale = Math.min(1, availableSize.width / rotatedWidth, availableSize.height / rotatedHeight);
    }

    canvas.style.transformOrigin = 'center center';
    canvas.style.transform = `rotate(${normalized}deg) scale(${scale})`;
}

function setWrapperRotation(wrapper, rotation) {
    if (!wrapper) return;

    const normalized = normalizeRotation(rotation);
    wrapper.dataset.rotation = String(normalized);
    applyCanvasRotation(wrapper.querySelector('canvas'), normalized);
}

function getWrapperRotation(wrapper) {
    return normalizeRotation(wrapper ? wrapper.dataset.rotation || 0 : 0);
}

function applyRotationToPdfPage(page, rotation) {
    const extraRotation = normalizeRotation(rotation);
    if (extraRotation === 0 || typeof page.setRotation !== 'function') return;

    const currentRotation = page.getRotation ? page.getRotation().angle : 0;
    const finalRotation = normalizeRotation(currentRotation + extraRotation);

    page.setRotation(PDFLib.degrees(finalRotation));
}

let previewRotation = 0;

function applyRotationToThumbnailForCurrentPage() {
    // Keep the outside rotated thumbnail in sync with the preview rotation
    const currentWrapper = getPageWrappers()[previewState.currentIndex - 1];
    if (!currentWrapper) return;

    setWrapperRotation(currentWrapper, previewRotation);
}

function rotatePreviewCanvas() {
    pushUndoSnapshot();

    previewRotation = (previewRotation + 90) % 360;

    // rotate the rendered canvas itself
    applyCanvasRotation(previewCanvas, previewRotation);

    applyRotationToThumbnailForCurrentPage();
}

function getPageWrappers() {
    return Array.from(pagesDiv.querySelectorAll('.page-wrapper:not(.add-page-wrapper)'));
}

function getPageOrderIndex(wrapper) {
    return getPageWrappers().indexOf(wrapper);
}

function updatePageLabels() {
    getPageWrappers().forEach((wrapper, index) => {
        const label = wrapper.querySelector('.page-number');
        if (label) {
            label.textContent = index + 1;
        }
    });
}

function rebuildSplitPointsFromMarkers() {
    splitPoints = [];
    const wrappers = getPageWrappers();

    wrappers.forEach((wrapper, index) => {
        const marker = wrapper.querySelector('.split-marker');
        if (!marker) return;

        const boundary = index + 1;
        if (marker.classList.contains('active')) {
            splitPoints.push(boundary);
        }

        if (wrapper === wrappers[wrappers.length - 1]) {
            marker.style.display = 'none';
        } else {
            marker.style.display = 'flex';
        }
    });

    splitPoints = [...new Set(splitPoints)].sort((a, b) => a - b);
}

function getValidSplitPoints(totalPages) {
    return [...new Set(splitPoints)]
        .filter(point => Number.isInteger(point) && point > 0 && point < totalPages)
        .sort((a, b) => a - b);
}

function updateStatsDisplay() {
    if (!stats) return;
    
    stats.innerHTML = `
        <div class="stat">
            <div class="stat-value">${pageOrder.length}</div>
            <div class="stat-label">Total Pages</div>
        </div>
        <div class="stat">
            <div class="stat-value">${splitPoints.length}</div>
            <div class="stat-label">Split Points</div>
        </div>
    `;
}

function syncPageOrderFromDom() {
    const wrappers = getPageWrappers();
    const newOrder = wrappers
        .map(wrapper => pageOrder.find(entry => entry.id === Number(wrapper.dataset.pageId)))
        .filter(Boolean);

    pageOrder.length = 0;
    pageOrder.push(...newOrder);

    totalLoadedPages = pageOrder.length;
    updatePageLabels();
    rebuildSplitPointsFromMarkers();
    previewState.totalPages = pageOrder.length;
    updateStatsDisplay();
    resetBlankScanState();
    updateUndoRedoButtons();
}

/* ============================================
   UNDO / REDO
   ============================================ */

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let isRestoringHistory = false;

// Captures everything needed to rebuild the page grid: order, source page
// references, per-page rotation, and split marker positions.
function captureSnapshot() {
    return {
        order: getPageWrappers().map(wrapper => {
            const entry = pageOrder.find(e => e.id === Number(wrapper.dataset.pageId));
            if (!entry) return null;
            return {
                id: entry.id,
                pdfIndex: entry.pdfIndex,
                pageNumber: entry.pageNumber,
                rotation: getWrapperRotation(wrapper)
            };
        }).filter(Boolean),
        splitPoints: [...splitPoints]
    };
}

// Call this BEFORE making any edit (delete, duplicate, rotate, reorder,
// split-marker toggle, etc.) so the state right before the edit is saved.
function pushUndoSnapshot() {
    if (isRestoringHistory) return;

    undoStack.push(captureSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
}

// Wipes history entirely — used when a brand new document is loaded or the
// workspace is cleared, since there's nothing meaningful left to undo into.
function resetHistory() {
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0 || isSplitting || isRestoringHistory || isLoadingPages;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0 || isSplitting || isRestoringHistory || isLoadingPages;
}

async function restoreSnapshot(snapshot) {
    isRestoringHistory = true;
    updateUndoRedoButtons();

    try {
        const existingById = new Map(
            getPageWrappers().map(w => [Number(w.dataset.pageId), w])
        );
        const addPageWrapper = pagesDiv.querySelector('.add-page-wrapper');

        // Detach every current page wrapper. Any wrapper that isn't part of the
        // snapshot (e.g. a page that gets un-deleted by undo simply never
        // re-appears, or a page a redo re-adds) is effectively discarded here.
        getPageWrappers().forEach(w => w.remove());

        pageOrder.length = 0;

        for (const item of snapshot.order) {
            let wrapper = existingById.get(item.id);

            if (!wrapper) {
                // Not currently in the DOM (e.g. undoing a delete, or redoing a
                // duplicate) — rebuild its thumbnail straight from the source PDF.
                wrapper = await createPageWrapper(item.pdfIndex, item.pageNumber, item.id, item.rotation);
            }

            setWrapperRotation(wrapper, item.rotation);
            pageOrder.push({ id: item.id, pdfIndex: item.pdfIndex, pageNumber: item.pageNumber });

            if (addPageWrapper) {
                pagesDiv.insertBefore(wrapper, addPageWrapper);
            } else {
                pagesDiv.appendChild(wrapper);
            }
        }

        // Re-apply split marker positions from the snapshot before syncing, since
        // rebuildSplitPointsFromMarkers() (called via syncPageOrderFromDom below)
        // derives splitPoints from each marker's "active" class.
        getPageWrappers().forEach((wrapper, index) => {
            const marker = wrapper.querySelector('.split-marker');
            if (!marker) return;
            marker.classList.toggle('active', snapshot.splitPoints.includes(index + 1));
        });

        syncPageOrderFromDom();
    } finally {
        isRestoringHistory = false;
        updateUndoRedoButtons();
    }
}

async function performUndo() {
    if (undoStack.length === 0 || isSplitting || isRestoringHistory) return;

    const current = captureSnapshot();
    const previous = undoStack.pop();
    redoStack.push(current);

    await restoreSnapshot(previous);
}

async function performRedo() {
    if (redoStack.length === 0 || isSplitting || isRestoringHistory) return;

    const current = captureSnapshot();
    const next = redoStack.pop();
    undoStack.push(current);

    await restoreSnapshot(next);
}

if (undoBtn) undoBtn.addEventListener('click', performUndo);
if (redoBtn) redoBtn.addEventListener('click', performRedo);

document.addEventListener('keydown', (e) => {
    const isMeta = e.ctrlKey || e.metaKey;
    if (!isMeta) return;

    const key = e.key.toLowerCase();

    if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        performRedo();
    }
});

/* ============================================
   BLANK PAGE DETECTION
   ============================================ */

const DELETE_BLANK_DEFAULT_LABEL =
    '<span class="material-symbols-rounded">layers_clear</span><span class="btn-label">Delete Blank Pages</span>';

// null = no scan pending. Array of page IDs = scan complete, awaiting user confirmation.
let blankPageIds = null;

// Tunable thresholds — raise/lower these if detection is too aggressive or too lax.
// DARK_LUMINANCE_CUTOFF:  pixels darker than this count as full-weight "solid ink"
//                         (real text, signatures, stamps).
// FAINT_LUMINANCE_CUTOFF: pixels between the two cutoffs count as faint marks
//                         (scanner shading, light smudges, staple/edge shadows)
//                         and are weighted lightly so a few of them don't
//                         disqualify an otherwise-empty page.
// FAINT_WEIGHT:           how much a faint pixel counts toward ink coverage,
//                         relative to a solid-ink pixel (1.0).
// INK_RATIO_THRESHOLD:    max weighted ink coverage (as a fraction of the page)
//                         still considered blank. Raised so a small stray mark,
//                         corner stamp, thin scan-line, or light watermark
//                         doesn't block detection.
// MEAN_BRIGHTNESS_MIN:    page must be at least this bright on average.
//
// Note: we deliberately do NOT gate on brightness variance. A single thin,
// high-contrast line (e.g. a staple shadow or scanner edge artifact) covers
// only a tiny fraction of the page but creates a large 0-vs-255 spread, which
// spikes variance even though the page is otherwise empty. The ink-ratio
// check already accounts for "how much of the page has marks on it" directly,
// which is a more reliable signal than variance for this case.
const BLANK_DETECTION = {
    DARK_LUMINANCE_CUTOFF: 200,
    FAINT_LUMINANCE_CUTOFF: 242,
    FAINT_WEIGHT: 0.35,
    INK_RATIO_THRESHOLD: 0.04,
    MEAN_BRIGHTNESS_MIN: 215
};

// Reads pixel data straight from the already-rendered thumbnail canvas -
// no need to re-render the PDF page, so this is cheap even for large documents.
function analyzeCanvasBlankness(canvas) {
    if (!canvas || !canvas.width || !canvas.height) {
        return { isBlank: false, inkRatio: 0 };
    }

    const ctx = canvas.getContext('2d');
    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
        console.error('Failed to read canvas pixels for blank-page detection', err);
        return { isBlank: false, inkRatio: 0 };
    }

    const { DARK_LUMINANCE_CUTOFF, FAINT_LUMINANCE_CUTOFF, FAINT_WEIGHT,
        INK_RATIO_THRESHOLD, MEAN_BRIGHTNESS_MIN } = BLANK_DETECTION;

    const data = imageData.data;
    let sum = 0;
    let inkWeight = 0;
    let sampled = 0;

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0) continue; // fully transparent pixels don't count as content

        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += luminance;
        sampled += 1;

        if (luminance < DARK_LUMINANCE_CUTOFF) {
            inkWeight += 1; // solid ink — real content
        } else if (luminance < FAINT_LUMINANCE_CUTOFF) {
            inkWeight += FAINT_WEIGHT; // faint mark/shading — barely counts
        }
    }

    if (sampled === 0) {
        return { isBlank: true, inkRatio: 0 };
    }

    const mean = sum / sampled;
    const inkRatio = inkWeight / sampled;

    // A page counts as blank when its weighted ink coverage is low AND the page
    // is overall bright. Faint marks (scanner noise, light smudges, thin scan
    // lines, a small stray stamp) are weighted lightly so they don't, by
    // themselves, prevent an otherwise-empty page from being flagged.
    const isBlank = inkRatio <= INK_RATIO_THRESHOLD && mean >= MEAN_BRIGHTNESS_MIN;

    return { isBlank, inkRatio };
}

function scanForBlankPages() {
    const wrappers = getPageWrappers();
    const ids = [];

    wrappers.forEach(wrapper => {
        const canvas = wrapper.querySelector('canvas');
        const card = wrapper.querySelector('.page-card');
        const { isBlank } = analyzeCanvasBlankness(canvas);

        if (isBlank) {
            ids.push(Number(wrapper.dataset.pageId));
            if (card) card.classList.add('blank-detected');
        } else if (card) {
            card.classList.remove('blank-detected');
        }
    });

    return ids;
}

function resetBlankScanState() {
    blankPageIds = null;
    document.querySelectorAll('.page-card.blank-detected').forEach(card => {
        card.classList.remove('blank-detected');
    });
    if (deleteBlankBtn) {
        deleteBlankBtn.innerHTML = DELETE_BLANK_DEFAULT_LABEL;
        deleteBlankBtn.classList.remove('btn-danger-outline');
    }
    if (cancelBlankScanBtn) {
        cancelBlankScanBtn.style.display = 'none';
    }
}

if (deleteBlankBtn) {
    deleteBlankBtn.addEventListener('click', () => {
        if (isSplitting) return;

        if (blankPageIds === null) {
            // SCAN MODE: detect blank pages and mark them for review
            const found = scanForBlankPages();

            if (found.length === 0) {
                alert('No blank pages were detected.');
                return;
            }

            blankPageIds = found;
            deleteBlankBtn.classList.add('btn-danger-outline');
            deleteBlankBtn.innerHTML =
                `<span class="material-symbols-rounded">delete_sweep</span><span class="btn-label">Confirm Delete (${found.length})</span>`;
            cancelBlankScanBtn.style.display = 'inline-flex';
        } else {
            // CONFIRM MODE: remove the marked pages
            pushUndoSnapshot();

            const idsToRemove = blankPageIds;

            getPageWrappers().forEach(wrapper => {
                if (idsToRemove.includes(Number(wrapper.dataset.pageId))) {
                    wrapper.remove();
                }
            });

            resetBlankScanState();
            syncPageOrderFromDom();
        }
    });
}

if (cancelBlankScanBtn) {
    cancelBlankScanBtn.addEventListener('click', () => {
        resetBlankScanState();
    });
}

/* ============================================
   PAGE WRAPPER CREATION (shared by initial load,
   duplication, and undo/redo restoration)
   ============================================ */

// Builds a fully-wired page wrapper (thumbnail + view/rotate/duplicate/delete
// buttons + split marker) for a given source page. Does NOT touch pageOrder or
// insert into the DOM — the caller does that, since insertion position and
// pageOrder bookkeeping differ between initial load, duplication, and restore.
async function createPageWrapper(pdfIndex, pageNumber, pageId, rotation = 0) {
    const pdf = loadedPdfs[pdfIndex].pdf;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.20 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
        canvasContext: context,
        viewport
    }).promise;

    const wrapper = document.createElement("div");
    wrapper.className = "page-wrapper";
    wrapper.dataset.pageId = pageId;
    enableDragAndDrop(wrapper);

    const pageCard = document.createElement("div");
    pageCard.className = "page-card";

    const actions = document.createElement("div");
    actions.className = "page-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "view-btn";
    viewBtn.innerHTML = `<span class="material-symbols-rounded">zoom_in</span>`;

    const rotateBtn = document.createElement("button");
    rotateBtn.className = "rotate-btn";
    rotateBtn.innerHTML = `<span class="material-symbols-rounded">rotate_right</span>`;

    const duplicateBtn = document.createElement("button");
    duplicateBtn.className = "duplicate-btn";
    duplicateBtn.innerHTML = `<span class="material-symbols-rounded">content_copy</span>`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = `<span class="material-symbols-rounded">delete</span>`;

    actions.appendChild(viewBtn);
    actions.appendChild(rotateBtn);
    actions.appendChild(duplicateBtn);
    actions.appendChild(deleteBtn);

    pageCard.appendChild(actions);
    pageCard.appendChild(canvas);
    wrapper.appendChild(pageCard);

    const label = document.createElement("p");
    label.className = "page-number";
    wrapper.appendChild(label);

    const marker = document.createElement("button");
    marker.className = "split-marker";
    marker.innerHTML = "✂";
    marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const boundary = getPageOrderIndex(wrapper) + 1;
        if (boundary <= 0 || boundary >= getPageWrappers().length) return;

        pushUndoSnapshot();

        if (splitPoints.includes(boundary)) {
            splitPoints = splitPoints.filter(point => point !== boundary);
            marker.classList.remove('active');
        } else {
            splitPoints.push(boundary);
            splitPoints.sort((a, b) => a - b);
            marker.classList.add('active');
        }

        updateStatsDisplay();
    });
    wrapper.appendChild(marker);

    setWrapperRotation(wrapper, rotation);

    rotateBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pushUndoSnapshot();
        setWrapperRotation(wrapper, getWrapperRotation(wrapper) + 90);
    });

    duplicateBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        pushUndoSnapshot();
        await duplicatePageWrapper(wrapper);
    });

    pageCard.addEventListener("click", (ev) => {
        if (ev.target.closest(".view-btn, .delete-btn, .rotate-btn, .duplicate-btn")) return;

        const isSelected = pageCard.classList.contains("selected");
        document.querySelectorAll(".page-card.selected").forEach(card => card.classList.remove("selected"));
        if (!isSelected) pageCard.classList.add("selected");
    });

    viewBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const pIndex = getPageOrderIndex(wrapper);
        if (pIndex === -1) return;

        previewModal.style.display = "block";
        await renderPreviewPage(pIndex + 1);
    });

    deleteBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pushUndoSnapshot();
        wrapper.remove();
        syncPageOrderFromDom();
    });

    return wrapper;
}

async function duplicatePageWrapper(sourceWrapper) {
    const pageIndex = getPageOrderIndex(sourceWrapper);
    if (pageIndex === -1) return;

    const entry = pageOrder[pageIndex];
    if (!entry) return;

    const pageId = pageIdCounter++;
    const newWrapper = await createPageWrapper(
        entry.pdfIndex,
        entry.pageNumber,
        pageId,
        getWrapperRotation(sourceWrapper)
    );

    pageOrder.push({ id: pageId, pdfIndex: entry.pdfIndex, pageNumber: entry.pageNumber });

    if (sourceWrapper.nextSibling) {
        pagesDiv.insertBefore(newWrapper, sourceWrapper.nextSibling);
    } else {
        pagesDiv.appendChild(newWrapper);
    }

    syncPageOrderFromDom();
}

let draggedPageId = null;

function clearDragState() {
    draggedPageId = null;
    document.querySelectorAll('.page-wrapper.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.page-wrapper.dragging').forEach(el => el.classList.remove('dragging'));
}

function enableDragAndDrop(wrapper) {
    wrapper.draggable = true;

    wrapper.addEventListener('dragstart', (e) => {
        draggedPageId = wrapper.dataset.pageId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedPageId);
        wrapper.classList.add('dragging');
    });

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        wrapper.classList.add('drag-over');
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedWrapper = pagesDiv.querySelector(`[data-page-id="${draggedPageId}"]`);
        if (!draggedWrapper || draggedWrapper === wrapper) return;

        pushUndoSnapshot();
        pagesDiv.insertBefore(draggedWrapper, wrapper);
        clearDragState();
        syncPageOrderFromDom();
    });

    wrapper.addEventListener('dragend', () => {
        clearDragState();
    });
}

pagesDiv.addEventListener('dragover', (e) => {
    e.preventDefault();
});

pagesDiv.addEventListener('drop', (e) => {
    if (e.target.closest('.page-wrapper:not(.add-page-wrapper)')) return;
    const draggedWrapper = pagesDiv.querySelector(`[data-page-id="${draggedPageId}"]`);
    const addPageWrapperEl = pagesDiv.querySelector('.add-page-wrapper');
    if (draggedWrapper && addPageWrapperEl) {
        pushUndoSnapshot();
        pagesDiv.insertBefore(draggedWrapper, addPageWrapperEl);
        clearDragState();
        syncPageOrderFromDom();
    }
});

/* ============================================
   DRAG AND DROP PDF UPLOAD
   ============================================ */

// Prevent default drag behaviors on the page
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

// Highlight upload zone on dragover
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');
});

// Handle dropped files
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');

    const droppedFiles = e.dataTransfer.files;
    
    if (!droppedFiles || droppedFiles.length === 0) {
        return;
    }

    // Filter for PDF files only
    const pdfFiles = Array.from(droppedFiles).filter(file => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            console.warn(`Skipped non-PDF file: ${file.name}`);
        }
        return isPdf;
    });

    if (pdfFiles.length === 0) {
        alert('Please drop PDF files only. No valid PDF files were found.');
        return;
    }

    // Queue each dropped PDF so they load one at a time instead of racing
    // (loading them concurrently would corrupt shared state like page order).
    pdfFiles.forEach(file => queueFileLoad(file));
});

prevPreviewBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (previewState.currentIndex > 1) {
        await renderPreviewPage(previewState.currentIndex - 1);
    }
});

nextPreviewBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (previewState.currentIndex < previewState.totalPages) {
        await renderPreviewPage(previewState.currentIndex + 1);
    }
});

if (rotatePreviewBtn) {
    rotatePreviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rotatePreviewCanvas();
    });
}


splitBtn.addEventListener("click", async () => {

    if (isSplitting) return;

    if (uploadedFiles.length === 0) {
        alert("Please select at least one PDF.");
        return;
    }

    const totalPages = pageOrder.length;
    rebuildSplitPointsFromMarkers();
    const validSplitPoints = getValidSplitPoints(totalPages);

    if (validSplitPoints.length === 0) {
        alert("Please add at least one split marker.");
        return;
    }

    isSplitting = true;
    splitBtn.disabled = true;
    deleteBlankBtn.disabled = true;
    updateUndoRedoButtons();
    splitBtn.innerHTML = '<span class="material-symbols-rounded">schedule</span><span class="btn-label">Splitting...</span>';

    try {
    const sourcePdfs = [];
    for (const file of uploadedFiles) {
        const fileBytes = await file.arrayBuffer();
        const sourcePdf = await PDFLib.PDFDocument.load(fileBytes);
        sourcePdfs.push(sourcePdf);
    }

    const mergedPdf = await PDFLib.PDFDocument.create();

    for (const entry of pageOrder) {
        const sourcePdf = sourcePdfs[entry.pdfIndex];
        const [page] = await mergedPdf.copyPages(sourcePdf, [entry.pageNumber - 1]);

        // Apply per-page rotation from the DOM to the exported PDF.
        const wrapper = getPageWrappers().find(w => Number(w.dataset.pageId) === entry.id);
        const rotation = getWrapperRotation(wrapper);

        if (rotation !== 0) {
            try {
                // pdf-lib in your version rejects some angles (error shows: Invalid rotation: 180).
                // Convert the UI degrees to pdf-lib's supported set by using incremental rotation.
                // Since UI rotates only by 90° steps, we can safely apply rotation via page.rotate.
                // page.rotate(...) applies rotation relative to current page rotation.

                const normalized = normalizeRotation(rotation);

                // In pdf-lib v1.17.1, for some builds setRotation rejects values.
                // For this app, we apply rotation as a page transformation matrix by re-using
                // the already-copied page and calling setRotation ONLY when it is strictly required.
                // Since rotation is always in 90deg steps, we map 180 -> 0 by rotating twice via rotate().

                if (typeof page.setRotation === 'function') {
                    const currentRotation = page.getRotation ? page.getRotation().angle : 0;
                    page.setRotation(PDFLib.degrees(normalizeRotation(currentRotation + normalized)));
                }
            } catch (err) {
                console.error('Failed to apply rotation to exported PDF page', err);
            }
        }


        mergedPdf.addPage(page);
    }


    const zip = new JSZip();
    const boundaries = [0, ...validSplitPoints, totalPages];

    // Derive base name from the first uploaded file, stripping the .pdf extension
    const baseName = uploadedFiles[0].name.replace(/\.pdf$/i, '');

    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];

        const newPdf = await PDFLib.PDFDocument.create();
        const pageIndexes = [];

        for (let p = start; p < end; p++) {
            pageIndexes.push(p);
        }

        const copiedPages = await newPdf.copyPages(mergedPdf, pageIndexes);
        copiedPages.forEach(page => newPdf.addPage(page));

        const pdfBytes = await newPdf.save();
        zip.file(`${baseName}(${i + 1}).pdf`, pdfBytes);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");

    a.href = zipUrl;
    a.download = `${baseName}.zip`;
    a.click();

    URL.revokeObjectURL(zipUrl);
    showSuccessMessage();
    } catch (err) {
        console.error('Failed to split PDF', err);
        alert("Something went wrong while splitting the PDF.");
    } finally {
    isSplitting = false;
    splitBtn.disabled = uploadedFiles.length === 0;
    deleteBlankBtn.disabled = uploadedFiles.length === 0;
    updateUndoRedoButtons();
    splitBtn.innerHTML = '<span class="material-symbols-rounded">cloud_download</span><span class="btn-label">Split & Download</span>';
    }

});


let splitPoints = [];

function resetAll() {
    // Reset state
    uploadedFiles.length = 0;
    loadedPdfs.length = 0;
    pageOrder.length = 0;
    splitPoints = [];
    pageIdCounter = 0;
    totalLoadedPages = 0;
    previewState.currentIndex = 0;
    previewState.totalPages = 0;

    // Reset UI
    pagesDiv.innerHTML = "";
    stats.innerHTML = "";
    showLandingPage();

    fileLabel.textContent = "No file chosen";

    // Disable split until a new PDF is loaded
    splitBtn.disabled = true;
    deleteBlankBtn.disabled = true;
    fileInput.disabled = false;
    hidePagesLoadingOverlay();
    resetBlankScanState();
    resetHistory();
}

refreshBtn.addEventListener('click', (e) => {
    e.preventDefault();

    // Close preview if open
    previewModal.style.display = 'none';

    resetAll();
});

/* ============================================
   FILE LOADING (queued so multiple files never race)
   ============================================ */

// Dropping several PDFs at once (or picking one while another is still
// loading) used to fire overlapping async loads that stomped on shared state
// (pageOrder, pageIdCounter, the loading overlay, etc). This queue forces
// every file to finish loading completely before the next one starts.
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
    uploadedFiles.push(file);

    const existingAddCard = pagesDiv.querySelector(".add-page-wrapper");
    if (existingAddCard) {
        existingAddCard.remove();
    }

    const isInitialLoad = totalLoadedPages === 0;
    if (isInitialLoad) {
        splitPoints = [];
        pageOrder.length = 0;
        pageIdCounter = 0;
        loadedPdfs.length = 0;
        totalLoadedPages = 0;
        pagesDiv.innerHTML = "";
        // Fresh document — nothing meaningful left to undo into.
        resetHistory();
    } else {
        // Let the user undo "adding this file" back to the prior page set.
        pushUndoSnapshot();
    }

    const arrayBuffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer
    }).promise;

    loadedPdfs.push({ pdf, pageCount: pdf.numPages });
    totalLoadedPages += pdf.numPages;
    previewState.totalPages = totalLoadedPages;

    // SHOW EDITOR PAGE WHEN PDF LOADS
    showEditorPage();

    splitBtn.disabled = true;
    deleteBlankBtn.disabled = true;
    refreshBtn.disabled = true;
    fileInput.disabled = true;
    resetBlankScanState();
    showPagesLoadingOverlay(pdf.numPages);

    for (let i = 1; i <= pdf.numPages; i++) {
        const pageId = pageIdCounter++;
        const wrapper = await createPageWrapper(loadedPdfs.length - 1, i, pageId);
        pageOrder.push({ id: pageId, pdfIndex: loadedPdfs.length - 1, pageNumber: i });
        pagesDiv.appendChild(wrapper);
        updatePagesLoadingProgress(i, pdf.numPages);
    }

    hidePagesLoadingOverlay();
    splitBtn.disabled = false;
    deleteBlankBtn.disabled = false;
    refreshBtn.disabled = false;
    fileInput.disabled = false;

    const addPageWrapper = document.createElement("div");
    addPageWrapper.className = "page-wrapper add-page-wrapper";

    const addPageCard = document.createElement("div");
    addPageCard.className = "page-card add-page-card";

    const addPdfBtn = document.createElement("button");
    addPdfBtn.className = "add-pdf-btn";
    addPdfBtn.innerHTML =
        `<span class="material-symbols-rounded">
            add
        </span>`;
    addPdfBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    const addLabel = document.createElement("p");
    addLabel.className = "add-page-label";
    addLabel.textContent = "add pdf files";

    addPageCard.appendChild(addPdfBtn);
    addPageCard.appendChild(addLabel);
    addPageWrapper.appendChild(addPageCard);
    addPageWrapper.addEventListener('click', () => {
        fileInput.click();
    });
    pagesDiv.appendChild(addPageWrapper);

    // Rebuild pageOrder/labels/split markers/stats from the final DOM state
    syncPageOrderFromDom();
}

fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    fileInput.value = "";
    if (!file) return;

    queueFileLoad(file);
});