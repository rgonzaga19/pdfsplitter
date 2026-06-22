const uploadedFiles = [];
let totalLoadedPages = 0;

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "./pdfjs/pdf.worker.min.js";

const fileInput = document.getElementById("pdfFile");
const uploadZone = document.querySelector(".upload-zone");
const pagesDiv = document.getElementById("pages");
const splitBtn = document.getElementById("splitBtn");
const refreshBtn = document.getElementById("refreshBtn");
const stats = document.getElementById("stats");
const fileLabel = document.getElementById("fileLabel");
const previewCanvas = document.getElementById("previewCanvas");
const prevPreviewBtn = document.getElementById("prevPreviewBtn");
const nextPreviewBtn = document.getElementById("nextPreviewBtn");
const rotatePreviewBtn = document.getElementById("rotatePreviewBtn");
const successMessage = document.getElementById("successMessage");
const successOkBtn = document.getElementById("successOkBtn");
const contentWrapper = document.getElementById("contentWrapper");

const loadedPdfs = [];
const pageOrder = [];
let pageIdCounter = 0;
let isSplitting = false;
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
}

async function duplicatePageWrapper(sourceWrapper) {
    const pageIndex = getPageOrderIndex(sourceWrapper);
    if (pageIndex === -1) return;

    const entry = pageOrder[pageIndex];
    if (!entry) return;

    const srcPdf = loadedPdfs[entry.pdfIndex].pdf;
    const page = await srcPdf.getPage(entry.pageNumber);
    const viewport = page.getViewport({ scale: 0.20 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
        canvasContext: context,
        viewport
    }).promise;

    const newWrapper = document.createElement('div');
    newWrapper.className = 'page-wrapper';
    newWrapper.dataset.pageId = pageIdCounter;

    pageOrder.push({
        id: pageIdCounter,
        pdfIndex: entry.pdfIndex,
        pageNumber: entry.pageNumber
    });

    pageIdCounter += 1;
    enableDragAndDrop(newWrapper);

    const newPageCard = document.createElement('div');
    newPageCard.className = 'page-card';

    const newActions = document.createElement('div');
    newActions.className = 'page-actions';

    const newViewBtn = document.createElement('button');
    newViewBtn.className = 'view-btn';
    newViewBtn.innerHTML =
        `<span class="material-symbols-rounded">
        zoom_in
        </span>`;

    const newRotateBtn = document.createElement('button');
    newRotateBtn.className = 'rotate-btn';
    newRotateBtn.innerHTML =
        `<span class="material-symbols-rounded">
        rotate_right
        </span>`;

    const newDuplicateBtn = document.createElement('button');
    newDuplicateBtn.className = 'duplicate-btn';
    newDuplicateBtn.innerHTML =
        `<span class="material-symbols-rounded">
        content_copy
        </span>`;

    const newDeleteBtn = document.createElement('button');
    newDeleteBtn.className = 'delete-btn';
    newDeleteBtn.innerHTML =
        `<span class="material-symbols-rounded">
        delete
        </span>`;

    newActions.appendChild(newViewBtn);
    newActions.appendChild(newRotateBtn);
    newActions.appendChild(newDuplicateBtn);
    newActions.appendChild(newDeleteBtn);

    newPageCard.appendChild(newActions);
    newPageCard.appendChild(canvas);
    newWrapper.appendChild(newPageCard);

    const newLabel = document.createElement('p');
    newLabel.className = 'page-number';
    newLabel.textContent = pageOrder.length;
    newWrapper.appendChild(newLabel);

    const newMarker = document.createElement('button');
    newMarker.className = 'split-marker';
    newMarker.textContent = '\u2702';
    newMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const boundary = getPageOrderIndex(newWrapper) + 1;
        if (boundary <= 0 || boundary >= getPageWrappers().length) return;

        if (splitPoints.includes(boundary)) {
            splitPoints = splitPoints.filter(point => point !== boundary);
            newMarker.classList.remove('active');
        } else {
            splitPoints.push(boundary);
            splitPoints.sort((a, b) => a - b);
            newMarker.classList.add('active');
        }

        updateStatsDisplay();
    });
    newWrapper.appendChild(newMarker);

    setWrapperRotation(newWrapper, getWrapperRotation(sourceWrapper));

    newRotateBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setWrapperRotation(newWrapper, getWrapperRotation(newWrapper) + 90);
    });

    newDuplicateBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await duplicatePageWrapper(newWrapper);
    });

    newPageCard.addEventListener('click', (ev) => {
        if (ev.target.closest('.view-btn, .delete-btn, .rotate-btn, .duplicate-btn')) return;
        const isSelected = newPageCard.classList.contains('selected');
        document.querySelectorAll('.page-card.selected').forEach(card => card.classList.remove('selected'));
        if (!isSelected) newPageCard.classList.add('selected');
    });

    newViewBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const pIndex = getPageOrderIndex(newWrapper);
        if (pIndex === -1) return;

        previewModal.style.display = 'block';
        await renderPreviewPage(pIndex + 1);
    });

    newDeleteBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        newWrapper.remove();
        syncPageOrderFromDom();
    });

    if (sourceWrapper.nextSibling) {
        pagesDiv.insertBefore(newWrapper, sourceWrapper.nextSibling);
    } else {
        pagesDiv.appendChild(newWrapper);
    }

    setWrapperRotation(newWrapper, getWrapperRotation(newWrapper));
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
    const addPageWrapper = pagesDiv.querySelector('.add-page-wrapper');
    if (draggedWrapper && addPageWrapper) {
        pagesDiv.insertBefore(draggedWrapper, addPageWrapper);
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

    // Process each PDF file
    pdfFiles.forEach(file => {
        // Trigger the file input change event logic for each file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        
        // Manually trigger the change event
        const event = new Event('change', { bubbles: true });
        fileInput.dispatchEvent(event);
    });
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
        zip.file(`split_${i + 1}.pdf`, pdfBytes);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");

    a.href = zipUrl;
    a.download = "split-output.zip";
    a.click();

    URL.revokeObjectURL(zipUrl);
    showSuccessMessage();
    } catch (err) {
        console.error('Failed to split PDF', err);
        alert("Something went wrong while splitting the PDF.");
    } finally {
    isSplitting = false;
    splitBtn.disabled = uploadedFiles.length === 0;
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
    contentWrapper.style.display = "none";

    fileLabel.textContent = "No file chosen";

    // Disable split until a new PDF is loaded
    splitBtn.disabled = true;
}

refreshBtn.addEventListener('click', (e) => {
    e.preventDefault();

    // Close preview if open
    previewModal.style.display = 'none';

    resetAll();
});

fileInput.addEventListener("change", async (e) => {

    const file = e.target.files[0];
    if (!file) return;

    fileLabel.textContent = file.name;
    uploadedFiles.push(file);
    fileInput.value = "";

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
    }

    const arrayBuffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer
    }).promise;

    loadedPdfs.push({ pdf, pageCount: pdf.numPages });
    const startPageNumber = totalLoadedPages;
    totalLoadedPages += pdf.numPages;
    previewState.totalPages = totalLoadedPages;

    // SHOW CONTENT SECTION WHEN PDF LOADS
    contentWrapper.style.display = "block";
    
    splitBtn.disabled = false;

    for (let i = 1; i <= pdf.numPages; i++) {

        const page = await pdf.getPage(i);

        const viewport = page.getViewport({
            scale: 0.20
        });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport
        }).promise;

       // PAGE WRAPPER
        const pageWrapper = document.createElement("div");
        pageWrapper.className = "page-wrapper";
        pageWrapper.dataset.pageId = pageIdCounter;
        pageOrder.push({
            id: pageIdCounter,
            pdfIndex: loadedPdfs.length - 1,
            pageNumber: i
        });
        pageIdCounter += 1;
        enableDragAndDrop(pageWrapper);

        // PAGE CARD
        // PAGE CARD
        const pageCard = document.createElement("div");
        pageCard.className = "page-card";

        // ACTION BAR
        const actions = document.createElement("div");
        actions.className = "page-actions";

        // VIEW BUTTON
        const viewBtn = document.createElement("button");
        viewBtn.className = "view-btn";
        viewBtn.innerHTML =
            `<span class="material-symbols-rounded">
            zoom_in
            </span>`;

        // ROTATE BUTTON
        const rotateBtn = document.createElement("button");
        rotateBtn.className = "rotate-btn";
        rotateBtn.innerHTML =
            `<span class="material-symbols-rounded">
            rotate_right
            </span>`;

        // DUPLICATE BUTTON
        const duplicateBtn = document.createElement("button");
        duplicateBtn.className = "duplicate-btn";
        duplicateBtn.innerHTML =
            `<span class="material-symbols-rounded">
            content_copy
            </span>`;

        // DELETE BUTTON
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML =
            `<span class="material-symbols-rounded">
            delete
            </span>`;

        actions.appendChild(viewBtn);
        actions.appendChild(rotateBtn);
        actions.appendChild(duplicateBtn);
        actions.appendChild(deleteBtn);



        pageCard.appendChild(actions);
        pageCard.appendChild(canvas);

        // Per-page rotation state (for thumbnail)
        // Start at 0 rotation
        pageWrapper.dataset.rotation = "0";

        rotateBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            const current = getWrapperRotation(pageWrapper);
            const next = (current + 90) % 360;
            setWrapperRotation(pageWrapper, next);
        });

        pageCard.addEventListener("click", (e) => {



            if (
                e.target.closest(
                    ".view-btn, .delete-btn, .rotate-btn, .duplicate-btn"
                )
            ) {
                return;
            }



            const isSelected = pageCard.classList.contains("selected");

            document
                .querySelectorAll(".page-card.selected")
                .forEach(card => card.classList.remove("selected"));

            if (!isSelected) {
                pageCard.classList.add("selected");
            }
        });

        viewBtn.addEventListener("click", async (e) => {

            e.stopPropagation();
            const wrapper = viewBtn.closest('.page-wrapper');
            const pageIndex = getPageOrderIndex(wrapper);
            if (pageIndex === -1) return;

            previewModal.style.display = "block";
            await renderPreviewPage(pageIndex + 1);
        });

        duplicateBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Duplicate the PDF page card using the current page wrapper reference
            const pageIndex = getPageOrderIndex(pageWrapper);
            if (pageIndex === -1) return;

            const entry = pageOrder[pageIndex];
            if (!entry) return;

            const srcPdf = loadedPdfs[entry.pdfIndex].pdf;
            const srcPageNumber = entry.pageNumber;

            const page = await srcPdf.getPage(srcPageNumber);
            const viewport = page.getViewport({ scale: 0.20 });

            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({
                canvasContext: context,
                viewport
            }).promise;

            // Create new wrapper and card
            const newWrapper = document.createElement('div');
            newWrapper.className = 'page-wrapper';
            newWrapper.dataset.pageId = pageIdCounter;

            pageOrder.push({
                id: pageIdCounter,
                pdfIndex: entry.pdfIndex,
                pageNumber: entry.pageNumber
            });

            pageIdCounter += 1;
            enableDragAndDrop(newWrapper);

            const newPageCard = document.createElement('div');
            newPageCard.className = 'page-card';

            const newActions = document.createElement('div');
            newActions.className = 'page-actions';

            const newViewBtn = document.createElement('button');
            newViewBtn.className = 'view-btn';
            newViewBtn.innerHTML =
                `<span class="material-symbols-rounded">
                zoom_in
                </span>`;

            const newRotateBtn = document.createElement('button');
            newRotateBtn.className = 'rotate-btn';
            newRotateBtn.innerHTML =
                `<span class="material-symbols-rounded">
                rotate_right
                </span>`;

            const newDuplicateBtn = document.createElement('button');
            newDuplicateBtn.className = 'duplicate-btn';
            newDuplicateBtn.innerHTML =
                `<span class="material-symbols-rounded">
                content_copy
                </span>`;

            const newDeleteBtn = document.createElement('button');
            newDeleteBtn.className = 'delete-btn';
            newDeleteBtn.innerHTML =
                `<span class="material-symbols-rounded">
                delete
                </span>`;

            newActions.appendChild(newViewBtn);
            newActions.appendChild(newRotateBtn);
            newActions.appendChild(newDuplicateBtn);
            newActions.appendChild(newDeleteBtn);

            newPageCard.appendChild(newActions);
            newPageCard.appendChild(canvas);

            newWrapper.appendChild(newPageCard);

            const newLabel = document.createElement('p');
            newLabel.className = 'page-number';
            newLabel.textContent = pageOrder.length;
            newWrapper.appendChild(newLabel);

            // Split marker
            const newMarker = document.createElement('button');
            newMarker.className = 'split-marker';
            newMarker.innerHTML = '✂';
            newMarker.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const boundary = getPageOrderIndex(newWrapper) + 1;
                if (boundary <= 0 || boundary >= getPageWrappers().length) return;

                if (splitPoints.includes(boundary)) {
                    splitPoints = splitPoints.filter(point => point !== boundary);
                    newMarker.classList.remove('active');
                } else {
                    splitPoints.push(boundary);
                    splitPoints.sort((a, b) => a - b);
                    newMarker.classList.add('active');
                }

                updateStatsDisplay();
            });
            newWrapper.appendChild(newMarker);

            // Rotation state
            setWrapperRotation(newWrapper, getWrapperRotation(pageWrapper));

            newRotateBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();

                const current = getWrapperRotation(newWrapper);
                const next = (current + 90) % 360;
                setWrapperRotation(newWrapper, next);
            });

            newDuplicateBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                await duplicatePageWrapper(newWrapper);
            });

            // Select behavior
            newPageCard.addEventListener('click', (ev) => {
                if (ev.target.closest('.view-btn, .delete-btn, .rotate-btn, .duplicate-btn')) return;
                const isSelected = newPageCard.classList.contains('selected');
                document.querySelectorAll('.page-card.selected').forEach(card => card.classList.remove('selected'));
                if (!isSelected) newPageCard.classList.add('selected');
            });

            newViewBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const wrapper = newViewBtn.closest('.page-wrapper');
                const pIndex = getPageOrderIndex(wrapper);
                if (pIndex === -1) return;

                previewModal.style.display = 'block';
                await renderPreviewPage(pIndex + 1);
            });

            newDeleteBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                newWrapper.remove();
                syncPageOrderFromDom();
            });

            // Insert duplicate right after the source
            if (pageWrapper.nextSibling) {
                pagesDiv.insertBefore(newWrapper, pageWrapper.nextSibling);
            } else {
                pagesDiv.appendChild(newWrapper);
            }

            setWrapperRotation(newWrapper, getWrapperRotation(newWrapper));
            syncPageOrderFromDom();
        });

        deleteBtn.addEventListener("click", (e) => {

            e.stopPropagation();
            const pageIndex = getPageOrderIndex(pageWrapper);



            pageWrapper.remove();
            syncPageOrderFromDom();
        });


        pageWrapper.appendChild(pageCard);

        const label = document.createElement("p");
        label.className = "page-number";
        label.textContent = pageOrder.length;

        pageWrapper.appendChild(label);

        const marker = document.createElement("button");
        marker.className = "split-marker";
        marker.innerHTML = "✂";

        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            const boundary = getPageOrderIndex(pageWrapper) + 1;
            if (boundary <= 0 || boundary >= getPageWrappers().length) return;

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

        pageWrapper.appendChild(marker);
        pagesDiv.appendChild(pageWrapper);
    }

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

    // UPDATE STATS AFTER LOADING
    updateStatsDisplay();
});