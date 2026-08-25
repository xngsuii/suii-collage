(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = document.getElementById('fileInput');
  const layoutsEl = document.getElementById('layouts');
  const gapInput = document.getElementById('gap');
  const bgColorInput = document.getElementById('bgColor');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');

  const SIZE = canvas.width; // internal resolution, square

  // Each layout is a list of cells: [x, y, w, h] in 0..1 relative units.
  const LAYOUTS = [
    { id: '2v', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    { id: '2h', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
    { id: '3v', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
    { id: '3h', cells: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]] },
    { id: 'grid4', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
    { id: 'big-top', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
    { id: 'big-left', cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
    { id: 'grid9', cells: Array.from({ length: 9 }, (_, i) => [
      (i % 3) / 3, Math.floor(i / 3) / 3, 1 / 3, 1 / 3,
    ]) },
  ];

  let currentLayout = LAYOUTS[4]; // grid4 as default
  // cells[i] = { img, panX, panY, zoom }  (panX/panY in cell-local pixel units, zoom >= 1)
  let cells = [];
  let activeCellIndex = null;

  function resetCells() {
    cells = currentLayout.cells.map(() => ({ img: null, panX: 0, panY: 0, zoom: 1 }));
    activeCellIndex = null;
  }

  function cellRectPx(rect) {
    const gap = Number(gapInput.value);
    const [x, y, w, h] = rect;
    return {
      x: x * SIZE + gap / 2,
      y: y * SIZE + gap / 2,
      w: w * SIZE - gap,
      h: h * SIZE - gap,
    };
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = bgColorInput.value;
    ctx.fillRect(0, 0, SIZE, SIZE);

    currentLayout.cells.forEach((rectDef, i) => {
      const rect = cellRectPx(rectDef);
      const cell = cells[i];

      if (cell.img) {
        drawImageInCell(cell, rect);
      } else {
        drawPlaceholder(rect);
      }
    });
  }

  function drawImageInCell(cell, rect) {
    const { img, panX, panY, zoom } = cell;
    const coverScale = Math.max(rect.w / img.width, rect.h / img.height) * zoom;
    const drawW = img.width * coverScale;
    const drawH = img.height * coverScale;

    const dx = rect.x + (rect.w - drawW) / 2 + panX;
    const dy = rect.y + (rect.h - drawH) / 2 + panY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();
  }

  function drawPlaceholder(rect) {
    ctx.save();
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8);

    ctx.fillStyle = '#bbb';
    ctx.font = `${Math.min(rect.w, rect.h) * 0.18}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.restore();
  }

  function clampPan(cell, rect) {
    const coverScale = Math.max(rect.w / cell.img.width, rect.h / cell.img.height) * cell.zoom;
    const drawW = cell.img.width * coverScale;
    const drawH = cell.img.height * coverScale;
    const maxPanX = Math.max(0, (drawW - rect.w) / 2);
    const maxPanY = Math.max(0, (drawH - rect.h) / 2);
    cell.panX = Math.min(maxPanX, Math.max(-maxPanX, cell.panX));
    cell.panY = Math.min(maxPanY, Math.max(-maxPanY, cell.panY));
  }

  function findCellAt(px, py) {
    for (let i = 0; i < currentLayout.cells.length; i++) {
      const rect = cellRectPx(currentLayout.cells[i]);
      if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) {
        return i;
      }
    }
    return null;
  }

  function canvasPoint(evt) {
    const bounds = canvas.getBoundingClientRect();
    const scaleX = SIZE / bounds.width;
    const scaleY = SIZE / bounds.height;
    return {
      x: (evt.clientX - bounds.left) * scaleX,
      y: (evt.clientY - bounds.top) * scaleY,
    };
  }

  function loadImageIntoCell(index, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      cells[index] = { img, panX: 0, panY: 0, zoom: 1 };
      draw();
    };
    img.src = url;
  }

  // --- layout picker UI ---
  function buildLayoutButtons() {
    layoutsEl.innerHTML = '';
    LAYOUTS.forEach((layout) => {
      const btn = document.createElement('button');
      btn.className = 'layout-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', layout.id);
      layout.cells.forEach(([x, y, w, h]) => {
        const cellPreview = document.createElement('span');
        cellPreview.className = 'cell';
        cellPreview.style.left = `${x * 100}%`;
        cellPreview.style.top = `${y * 100}%`;
        cellPreview.style.width = `${w * 100 - 6}%`;
        cellPreview.style.height = `${h * 100 - 6}%`;
        btn.appendChild(cellPreview);
      });
      btn.addEventListener('click', () => {
        currentLayout = layout;
        resetCells();
        highlightActiveLayout();
        draw();
      });
      layout.buttonEl = btn;
      layoutsEl.appendChild(btn);
    });
    highlightActiveLayout();
  }

  function highlightActiveLayout() {
    LAYOUTS.forEach((l) => l.buttonEl.classList.toggle('active', l === currentLayout));
  }

  // --- pointer interaction: tap to add/replace, drag to pan, wheel to zoom ---
  let dragState = null; // { index, startX, startY, startPanX, startPanY, moved }

  canvas.addEventListener('pointerdown', (evt) => {
    const p = canvasPoint(evt);
    const index = findCellAt(p.x, p.y);
    if (index === null) return;

    const cell = cells[index];
    if (!cell.img) {
      activeCellIndex = index;
      fileInput.click();
      return;
    }

    dragState = {
      index,
      startX: p.x,
      startY: p.y,
      startPanX: cell.panX,
      startPanY: cell.panY,
      moved: false,
    };
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (!dragState) return;
    const p = canvasPoint(evt);
    const dx = p.x - dragState.startX;
    const dy = p.y - dragState.startY;
    if (Math.hypot(dx, dy) > 3) dragState.moved = true;

    const cell = cells[dragState.index];
    cell.panX = dragState.startPanX + dx;
    cell.panY = dragState.startPanY + dy;
    clampPan(cell, cellRectPx(currentLayout.cells[dragState.index]));
    draw();
  });

  canvas.addEventListener('pointerup', (evt) => {
    if (!dragState) return;
    const { index, moved } = dragState;
    dragState = null;
    if (!moved) {
      activeCellIndex = index;
      fileInput.click();
    }
  });

  canvas.addEventListener('wheel', (evt) => {
    const p = canvasPoint(evt);
    const index = findCellAt(p.x, p.y);
    if (index === null || !cells[index].img) return;
    evt.preventDefault();

    const cell = cells[index];
    const delta = evt.deltaY < 0 ? 0.1 : -0.1;
    cell.zoom = Math.min(4, Math.max(1, cell.zoom + delta));
    clampPan(cell, cellRectPx(currentLayout.cells[index]));
    draw();
  }, { passive: false });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file && activeCellIndex !== null) {
      loadImageIntoCell(activeCellIndex, file);
    }
    fileInput.value = '';
  });

  gapInput.addEventListener('input', draw);
  bgColorInput.addEventListener('input', draw);

  resetBtn.addEventListener('click', () => {
    resetCells();
    draw();
  });

  downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `suii-collage-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  buildLayoutButtons();
  resetCells();
  draw();
})();
