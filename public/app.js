
const uploadedFiles = [];
let totalLoadedPages = 0;

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "./pdfjs/pdf.worker.min.js";

const fileInput = document.getElementById("pdfFile");
const pagesDiv = document.getElementById("pages");
const splitBtn = document.getElementById("splitBtn");
const stats = document.getElementById("stats");
const fileLabel = document.getElementById("fileLabel");
const previewCanvas = document.getElementById("previewCanvas");
const prevPreviewBtn = document.getElementById("prevPreviewBtn");
const nextPreviewBtn = document.getElementById("nextPreviewBtn");

const loadedPdfs = [];
const pageOrder = [];
let pageIdCounter = 0;
const previewState = {
    currentIndex: 0,
    totalPages: 0
};

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
    const viewport = page.getViewport({ scale: 0.9 });
    const ctx = previewCanvas.getContext("2d");

    previewCanvas.width = viewport.width;
    previewCanvas.height = viewport.height;

    await page.render({
        canvasContext: ctx,
        viewport
    }).promise;

    previewState.currentIndex = globalIndex;
    updatePreviewNavigation();
}

function updatePreviewNavigation() {
    prevPreviewBtn.disabled = previewState.currentIndex <= 1;
    nextPreviewBtn.disabled = previewState.currentIndex >= previewState.totalPages;
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

    splitPoints.sort((a, b) => a - b);
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
    stats.innerHTML = `<h3>${pageOrder.length} pages loaded</h3>`;
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

splitBtn.addEventListener("click", async () => {

    if (uploadedFiles.length === 0) {
        alert("Please select at least one PDF.");
        return;
    }

    if (splitPoints.length === 0) {
        alert("Please add at least one split marker.");
        return;
    }

    const sourcePdfs = [];
    for (const file of uploadedFiles) {
        const fileBytes = await file.arrayBuffer();
        const sourcePdf = await PDFLib.PDFDocument.load(fileBytes);
        sourcePdfs.push(sourcePdf);
    }

    const mergedPdf = await PDFLib.PDFDocument.create();
    const totalPages = pageOrder.length;

    for (const entry of pageOrder) {
        const sourcePdf = sourcePdfs[entry.pdfIndex];
        const [page] = await mergedPdf.copyPages(sourcePdf, [entry.pageNumber - 1]);
        mergedPdf.addPage(page);
    }

    const zip = new JSZip();
    const boundaries = [0, ...splitPoints, totalPages];

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
    alert("Split complete!");

});


let splitPoints = [];

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
    stats.innerHTML =
    `<h3>${totalLoadedPages} pages loaded</h3>`;
    
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

        // DELETE BUTTON
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML =
            `<span class="material-symbols-rounded">
            delete
            </span>`;

        actions.appendChild(viewBtn);
        actions.appendChild(deleteBtn);

        pageCard.appendChild(actions);
        pageCard.appendChild(canvas);

        pageCard.addEventListener("click", (e) => {

            if (e.target.closest(".view-btn, .delete-btn")) {
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

        deleteBtn.addEventListener("click", (e) => {

            e.stopPropagation();
            const pageIndex = getPageOrderIndex(pageWrapper);

            if (!confirm(`Delete page ${pageIndex + 1}?`)) {
                return;
            }

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

            console.log('Split Points:', splitPoints);
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
});