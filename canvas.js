// ===== CANVAS MODULE =====
const Canvas = (() => {
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#000000';
  let penSize = 3;
  let penOpacity = 1;
  let strokes = [];
  let redoStack = [];
  let currentStroke = null;
  let bgType = 'white';
  let lastPoint = null;

  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    ctx = drawingCanvas.getContext('2d');
    bgCtx = bgCanvas.getContext('2d');
    resizeCanvases();

    window.addEventListener('resize', resizeCanvases);

    // Pointer events for Apple Pencil + touch + mouse
    drawingCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    drawingCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
    drawingCanvas.addEventListener('pointerup', onPointerUp);
    drawingCanvas.addEventListener('pointerout', onPointerUp);
    drawingCanvas.addEventListener('pointercancel', onPointerUp);

    setupToolbar();
  }

  function resizeCanvases() {
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return;
    const { width, height } = wrap.getBoundingClientRect();

    [drawingCanvas, bgCanvas].forEach(c => {
      c.width = width * window.devicePixelRatio;
      c.height = height * window.devicePixelRatio;
      c.style.width = width + 'px';
      c.style.height = height + 'px';
    });

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    bgCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    drawBackground();
    redrawStrokes();
  }

  function setupToolbar() {
    // Tools
    document.querySelectorAll('.draw-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.draw-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.dataset.tool;
        updateCursor();
      });
    });

    // Color
    const colorPicker = document.getElementById('penColorPicker');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => { penColor = e.target.value; });
    }

    // Size
    const sizeSlider = document.getElementById('penSizeSlider');
    const sizeValue = document.getElementById('penSizeValue');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', e => {
        penSize = parseInt(e.target.value);
        if (sizeValue) sizeValue.textContent = penSize + 'px';
      });
    }

    // Opacity
    const opacitySlider = document.getElementById('penOpacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', e => { penOpacity = parseFloat(e.target.value); });
    }

    // Background
    const bgSelect = document.getElementById('canvasBgSelect');
    if (bgSelect) {
      bgSelect.addEventListener('change', e => {
        bgType = e.target.value;
        drawBackground();
      });
    }

    // Actions
    document.getElementById('undoBtn')?.addEventListener('click', undo);
    document.getElementById('redoBtn')?.addEventListener('click', redo);
    document.getElementById('clearCanvasBtn')?.addEventListener('click', clearCanvas);
    document.getElementById('exportCanvasBtn')?.addEventListener('click', exportImage);
  }

  function updateCursor() {
    drawingCanvas.style.cursor = currentTool === 'eraser' ? 'cell' : 'crosshair';
  }

  function getPos(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    const pressure = e.pressure || 0.5;
    return { x, y, pressure };
  }

  function onPointerDown(e) {
    e.preventDefault();
    drawingCanvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    const pos = getPos(e);
    lastPoint = pos;

    currentStroke = {
      tool: currentTool,
      color: penColor,
      size: penSize,
      opacity: penOpacity,
      points: [pos]
    };

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!isDrawing) return;

    const pos = getPos(e);
    currentStroke.points.push(pos);

    const dynamicSize = currentTool === 'pen'
      ? penSize * (0.5 + pos.pressure * 0.8)
      : penSize;

    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, penSize * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (lastPoint) {
        // Smooth curve through midpoints
        const mx = (lastPoint.x + pos.x) / 2;
        const my = (lastPoint.y + pos.y) / 2;
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, mx, my);
        ctx.stroke();
      }
    }

    lastPoint = pos;
  }

  function onPointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (currentStroke && currentStroke.points.length > 0) {
      strokes.push(currentStroke);
      redoStack = [];
    }
    currentStroke = null;
  }

  function undo() {
    if (strokes.length === 0) return;
    redoStack.push(strokes.pop());
    redrawStrokes();
    UI.showToast('Undone');
  }

  function redo() {
    if (redoStack.length === 0) return;
    strokes.push(redoStack.pop());
    redrawStrokes();
    UI.showToast('Redone');
  }

  function clearCanvas() {
    if (!confirm('Clear the entire drawing?')) return;
    strokes = [];
    redoStack = [];
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    UI.showToast('Canvas cleared');
  }

  function redrawStrokes() {
    const w = drawingCanvas.width / window.devicePixelRatio;
    const h = drawingCanvas.height / window.devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;

      ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      for (let i = 1; i < stroke.points.length - 1; i++) {
        const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
      }

      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    });

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBackground() {
    const w = bgCanvas.width / window.devicePixelRatio;
    const h = bgCanvas.height / window.devicePixelRatio;
    bgCtx.clearRect(0, 0, w, h);

    if (bgType === 'lined') {
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = '#c7d2fe';
      bgCtx.lineWidth = 1;
      const lineHeight = 32;
      for (let y = lineHeight; y < h; y += lineHeight) {
        bgCtx.beginPath();
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(w, y);
        bgCtx.stroke();
      }
      bgCtx.strokeStyle = '#f87171';
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      bgCtx.moveTo(60, 0);
      bgCtx.lineTo(60, h);
      bgCtx.stroke();
    } else if (bgType === 'grid') {
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = '#e0e7ff';
      bgCtx.lineWidth = 1;
      const gridSize = 28;
      for (let x = 0; x < w; x += gridSize) {
        bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke();
      }
    } else if (bgType === 'dotgrid') {
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.fillStyle = '#c7d2fe';
      const spacing = 28;
      for (let x = spacing; x < w; x += spacing) {
        for (let y = spacing; y < h; y += spacing) {
          bgCtx.beginPath();
          bgCtx.arc(x, y, 1.5, 0, Math.PI * 2);
          bgCtx.fill();
        }
      }
    } else if (bgType === '#1a1a1a') {
      bgCtx.fillStyle = '#1a1a1a';
      bgCtx.fillRect(0, 0, w, h);
    } else if (bgType === '#fff9e6') {
      bgCtx.fillStyle = '#fff9e6';
      bgCtx.fillRect(0, 0, w, h);
    } else {
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, w, h);
    }
  }

  function exportImage() {
    const merged = document.createElement('canvas');
    merged.width = drawingCanvas.width;
    merged.height = drawingCanvas.height;
    const mCtx = merged.getContext('2d');
    mCtx.drawImage(bgCanvas, 0, 0);
    mCtx.drawImage(drawingCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'notemax-drawing.png';
    link.href = merged.toDataURL('image/png');
    link.click();
    UI.showToast('Image saved!');
  }

  function getDataURL() {
    const merged = document.createElement('canvas');
    merged.width = drawingCanvas.width;
    merged.height = drawingCanvas.height;
    const mCtx = merged.getContext('2d');
    mCtx.drawImage(bgCanvas, 0, 0);
    mCtx.drawImage(drawingCanvas, 0, 0);
    return merged.toDataURL('image/png');
  }

  function getStrokes() { return strokes; }

  function loadStrokes(savedStrokes) {
    strokes = savedStrokes || [];
    redoStack = [];
    redrawStrokes();
  }

  return {
    init, undo, redo, clearCanvas, exportImage,
    getDataURL, getStrokes, loadStrokes, drawBackground
  };
})();