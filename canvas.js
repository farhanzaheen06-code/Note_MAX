// ===== CANVAS MODULE - OPTIMIZED + PROPER MENU HANDLING =====
const Canvas = (() => {
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#ffffff';
  let penSize = 3;
  let penOpacity = 1;
  let strokes = [];
  let redoStack = [];
  let currentStroke = null;
  let bgType = 'dark';
  let lastPoint = null;
  let scribbleEraseEnabled = true;
  let shapeRecognitionEnabled = false;
  let menuOpen = false;
  let dpr = 1;

  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas || !bgCanvas) return;
    
    ctx = drawingCanvas.getContext('2d', { willReadFrequently: false });
    bgCtx = bgCanvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    
    currentTool = 'pen';
    
    resizeCanvases();
    window.addEventListener('resize', debounce(resizeCanvases, 100));
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvases, 400));

    drawingCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    drawingCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
    drawingCanvas.addEventListener('pointerup', onPointerUp, { passive: false });
    drawingCanvas.addEventListener('pointerleave', onPointerUp, { passive: false });
    drawingCanvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    drawingCanvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    drawingCanvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    setupToolbar();
    setupOutsideClick();
  }

  function debounce(fn, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function resizeCanvases() {
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setTimeout(resizeCanvases, 100);
      return;
    }
    
    dpr = window.devicePixelRatio || 1;

    [drawingCanvas, bgCanvas].forEach(c => {
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    bgCtx.scale(dpr, dpr);

    drawBackground();
    redrawStrokes();
  }

  // ========== SETUP OUTSIDE CLICK TO CLOSE MENU ==========
  function setupOutsideClick() {
    document.addEventListener('pointerdown', (e) => {
      if (!menuOpen) return;
      
      const panel = document.getElementById('penSettings');
      const clickedInsidePanel = panel && panel.contains(e.target);
      const clickedPenTool = e.target.closest('.pen-preset');
      
      if (!clickedInsidePanel && !clickedPenTool) {
        closePenSettings();
      }
    }, true);
  }

  function openPenSettings() {
    const panel = document.getElementById('penSettings');
    if (!panel) return;
    panel.classList.remove('hidden');
    menuOpen = true;
  }

  function closePenSettings() {
    const panel = document.getElementById('penSettings');
    if (!panel) return;
    panel.classList.add('hidden');
    menuOpen = false;
  }

  function togglePenSettings() {
    if (menuOpen) closePenSettings();
    else openPenSettings();
  }

  function setupToolbar() {
    // ===== PEN PRESETS =====
    document.querySelectorAll('.pen-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = btn.classList.contains('active');
        
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = 'pen';
        penColor = btn.dataset.color;
        
        const colorPicker = document.getElementById('penColorPicker');
        if (colorPicker) colorPicker.value = penColor;
        
        // Toggle menu on repeat click of same pen, open on new pen
        if (wasActive) togglePenSettings();
        else openPenSettings();
        
        updateCursor();
      });
    });

    // ===== OTHER TOOLS =====
    document.querySelectorAll('.pen-tool:not(.pen-preset)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tool = btn.dataset.tool;
        if (!tool) return;
        
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = tool;
        
        if (tool === 'highlighter') {
          penColor = '#ffff00';
          openPenSettings();
        } else {
          closePenSettings();
        }
        
        updateCursor();
      });
    });

    // ===== SHAPE RECOGNITION =====
    const autoShape = document.getElementById('autoShapeBtn');
    if (autoShape) {
      autoShape.addEventListener('click', (e) => {
        e.stopPropagation();
        shapeRecognitionEnabled = !shapeRecognitionEnabled;
        autoShape.classList.toggle('active', shapeRecognitionEnabled);
        if (typeof UI !== 'undefined') {
          UI.showToast(shapeRecognitionEnabled ? '✨ Shape Recognition ON' : 'Shape Recognition OFF');
        }
        const toggle = document.getElementById('shapeRecognitionToggle');
        if (toggle) toggle.checked = shapeRecognitionEnabled;
      });
    }

    // ===== CLOSE PANEL BUTTON =====
    document.getElementById('closePenSettings')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closePenSettings();
    });

    // ===== COLOR PICKER =====
    const colorPicker = document.getElementById('penColorPicker');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => { 
        penColor = e.target.value;
        // Update active pen preset visual
        const activePreset = document.querySelector('.pen-preset.active .pen-visual');
        if (activePreset) activePreset.style.background = penColor;
      });
    }

    // ===== SIZE SLIDER =====
    const sizeSlider = document.getElementById('penSizeSlider');
    const sizeValue = document.getElementById('penSizeValue');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', e => {
        penSize = parseInt(e.target.value);
        if (sizeValue) sizeValue.textContent = penSize;
      });
    }

    // ===== OPACITY =====
    const opacitySlider = document.getElementById('penOpacity');
    const opacityValue = document.getElementById('opacityValue');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', e => {
        penOpacity = parseFloat(e.target.value) / 100;
        if (opacityValue) opacityValue.textContent = Math.round(penOpacity * 100);
      });
    }

    // ===== BACKGROUND =====
    const bgSelect = document.getElementById('canvasBgSelect');
    if (bgSelect) {
      bgSelect.addEventListener('change', e => {
        bgType = e.target.value;
        drawBackground();
      });
    }

    // ===== TOGGLES =====
    const scribbleToggle = document.getElementById('scribbleEraseToggle');
    if (scribbleToggle) {
      scribbleToggle.addEventListener('change', e => {
        scribbleEraseEnabled = e.target.checked;
        if (typeof UI !== 'undefined') {
          UI.showToast(scribbleEraseEnabled ? '✏️ Scribble Erase ON' : 'Scribble Erase OFF');
        }
      });
    }

    const shapeToggle = document.getElementById('shapeRecognitionToggle');
    if (shapeToggle) {
      shapeToggle.addEventListener('change', e => {
        shapeRecognitionEnabled = e.target.checked;
        const btn = document.getElementById('autoShapeBtn');
        if (btn) btn.classList.toggle('active', shapeRecognitionEnabled);
      });
    }

    // ===== UNDO / REDO =====
    document.getElementById('undoBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      undo();
    });
    document.getElementById('redoBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      redo();
    });

    // ===== PREVENT PANEL FROM CLOSING WHEN INTERACTING INSIDE =====
    const penSettings = document.getElementById('penSettings');
    if (penSettings) {
      penSettings.addEventListener('pointerdown', e => e.stopPropagation());
      penSettings.addEventListener('click', e => e.stopPropagation());
    }
  }

  function updateCursor() {
    if (!drawingCanvas) return;
    drawingCanvas.style.cursor = 
      currentTool === 'eraser' ? 'cell' :
      currentTool === 'select' || currentTool === 'lasso' ? 'default' :
      'crosshair';
  }

  function getPos(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5
    };
  }

  function onPointerDown(e) {
    if (currentTool === 'select' || currentTool === 'lasso') return;
    e.preventDefault();
    e.stopPropagation();
    
    // Close menu when starting to draw
    if (menuOpen) closePenSettings();
    
    try { drawingCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    
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

    if (currentTool !== 'eraser') {
      ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
      ctx.fillStyle = penColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, penSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = getPos(e);
    if (!currentStroke) return;
    currentStroke.points.push(pos);

    if (currentTool === 'eraser') {
      eraseAt(pos.x, pos.y, penSize * 3);
    } else {
      const dynamicSize = currentTool === 'pen'
        ? penSize * (0.5 + pos.pressure * 0.8)
        : penSize;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (lastPoint) {
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

  function onPointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    try { if (e && e.pointerId) drawingCanvas.releasePointerCapture(e.pointerId); } catch (err) {}

    if (currentStroke && currentStroke.points.length > 0) {
      if (scribbleEraseEnabled && currentTool !== 'eraser' && currentTool !== 'highlighter') {
        if (isScribble(currentStroke.points)) {
          eraseScribbledStrokes(currentStroke.points);
          currentStroke = null;
          redrawStrokes();
          if (typeof UI !== 'undefined') UI.showToast('✏️ Scribble erased!');
          return;
        }
      }

      if (shapeRecognitionEnabled && currentTool === 'pen' && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape, currentStroke.points);
          currentStroke.recognizedShape = shape.type;
          if (typeof UI !== 'undefined') UI.showToast(`✨ ${shape.type} detected`);
        }
      }

      strokes.push(currentStroke);
      redoStack = [];
      redrawStrokes();
    }
    currentStroke = null;
  }

  // ========== SCRIBBLE ==========
  function isScribble(points) {
    if (points.length < 20) return false;
    let directionChanges = 0;
    let lastDx = 0, lastDy = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      if (i > 1) {
        const dotProduct = dx * lastDx + dy * lastDy;
        if (dotProduct < 0) directionChanges++;
      }
      lastDx = dx; lastDy = dy;
    }
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    let pathLength = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    const boxDiagonal = Math.sqrt(width * width + height * height);
    const compactness = boxDiagonal > 0 ? pathLength / boxDiagonal : 0;
    return directionChanges >= 5 && compactness > 3.5;
  }

  function eraseScribbledStrokes(scribblePoints) {
    const xs = scribblePoints.map(p => p.x);
    const ys = scribblePoints.map(p => p.y);
    const minX = Math.min(...xs) - 10;
    const maxX = Math.max(...xs) + 10;
    const minY = Math.min(...ys) - 10;
    const maxY = Math.max(...ys) + 10;
    strokes = strokes.filter(stroke => {
      return !stroke.points.some(p =>
        p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
      );
    });
  }

  // ========== SHAPE RECOGNITION ==========
  function detectShape(points) {
    if (points.length < 8) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX, height = maxY - minY;
    if (width < 20 || height < 20) return null;
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const first = points[0], last = points[points.length - 1];
    const closeDistance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    const isClosed = closeDistance < Math.max(width, height) * 0.3;

    if (isStraightLine(points)) return { type: 'Line', start: first, end: last };

    if (isClosed) {
      const aspectRatio = width / height;
      const avgRadius = (width + height) / 4;
      let circleScore = 0, rectScore = 0;

      points.forEach(p => {
        const dist = Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2));
        if (Math.abs(dist - avgRadius) < avgRadius * 0.25) circleScore++;
        const nearEdge = 
          Math.abs(p.x - minX) < width * 0.1 ||
          Math.abs(p.x - maxX) < width * 0.1 ||
          Math.abs(p.y - minY) < height * 0.1 ||
          Math.abs(p.y - maxY) < height * 0.1;
        if (nearEdge) rectScore++;
      });

      const cP = circleScore / points.length;
      const rP = rectScore / points.length;

      if (cP > 0.6 && cP > rP) {
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.15 ? 'Circle' : 'Ellipse',
          centerX, centerY, radiusX: width / 2, radiusY: height / 2
        };
      }

      if (rP > 0.55) {
        const corners = detectCorners(points);
        if (corners === 3) return {
          type: 'Triangle',
          top: { x: centerX, y: minY },
          left: { x: minX, y: maxY },
          right: { x: maxX, y: maxY }
        };
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.15 ? 'Square' : 'Rectangle',
          minX, minY, maxX, maxY
        };
      }
    }

    if (!isClosed && points.length > 10 && calculateStraightness(points) > 0.85) {
      return { type: 'Arrow', start: first, end: last };
    }
    return null;
  }

  function isStraightLine(points) {
    return points.length >= 3 && calculateStraightness(points) > 0.95;
  }

  function calculateStraightness(points) {
    const first = points[0], last = points[points.length - 1];
    const totalDist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    let pathLen = 0;
    for (let i = 1; i < points.length; i++) {
      pathLen += Math.sqrt(Math.pow(points[i].x - points[i-1].x, 2) + Math.pow(points[i].y - points[i-1].y, 2));
    }
    return pathLen > 0 ? totalDist / pathLen : 0;
  }

  function detectCorners(points) {
    let corners = 0;
    const threshold = Math.PI / 3;
    for (let i = 5; i < points.length - 5; i += 3) {
      const p1 = points[i - 5], p2 = points[i], p3 = points[i + 5];
      const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
      let diff = Math.abs(angle2 - angle1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > threshold) corners++;
    }
    return corners <= 3 ? 3 : 4;
  }

  function generateShapePoints(shape, originalPoints) {
    const pts = [];
    switch (shape.type) {
      case 'Circle': case 'Ellipse':
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          pts.push({
            x: shape.centerX + Math.cos(a) * shape.radiusX,
            y: shape.centerY + Math.sin(a) * shape.radiusY,
            pressure: 0.7
          });
        }
        break;
      case 'Rectangle': case 'Square':
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        break;
      case 'Triangle':
        pts.push({ x: shape.top.x, y: shape.top.y, pressure: 0.7 });
        pts.push({ x: shape.right.x, y: shape.right.y, pressure: 0.7 });
        pts.push({ x: shape.left.x, y: shape.left.y, pressure: 0.7 });
        pts.push({ x: shape.top.x, y: shape.top.y, pressure: 0.7 });
        break;
      case 'Line':
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        break;
      case 'Arrow':
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        const arrowLen = 15;
        pts.push({
          x: shape.end.x - arrowLen * Math.cos(angle - Math.PI / 6),
          y: shape.end.y - arrowLen * Math.sin(angle - Math.PI / 6),
          pressure: 0.7
        });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        pts.push({
          x: shape.end.x - arrowLen * Math.cos(angle + Math.PI / 6),
          y: shape.end.y - arrowLen * Math.sin(angle + Math.PI / 6),
          pressure: 0.7
        });
        break;
      default: return originalPoints;
    }
    return pts;
  }

  function eraseAt(x, y, radius) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    strokes = strokes.filter(stroke => 
      !stroke.points.some(p => Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2)) < radius)
    );
  }

  function undo() {
    if (strokes.length === 0) return;
    redoStack.push(strokes.pop());
    redrawStrokes();
    if (typeof UI !== 'undefined') UI.showToast('↶ Undone');
  }

  function redo() {
    if (redoStack.length === 0) return;
    strokes.push(redoStack.pop());
    redrawStrokes();
    if (typeof UI !== 'undefined') UI.showToast('↷ Redone');
  }

  function clearCanvas() {
    if (!confirm('Clear drawing?')) return;
    strokes = [];
    redoStack = [];
    redrawStrokes();
  }

  function redrawStrokes() {
    if (!ctx) return;
    const w = drawingCanvas.width / dpr;
    const h = drawingCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    strokes.forEach(stroke => {
      if (stroke.points.length < 1) return;
      ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : (stroke.opacity || 1);
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
      }
      if (stroke.points.length > 1) {
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x, last.y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function drawBackground() {
    if (!bgCtx) return;
    const w = bgCanvas.width / dpr;
    const h = bgCanvas.height / dpr;
    bgCtx.clearRect(0, 0, w, h);
    if (bgType === 'dark') { bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h); }
    else if (bgType === 'white') { bgCtx.fillStyle = '#ffffff'; bgCtx.fillRect(0, 0, w, h); }
    else if (bgType === 'cream') { bgCtx.fillStyle = '#fff9e6'; bgCtx.fillRect(0, 0, w, h); }
    else if (bgType === 'lined') {
      bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = 'rgba(255,255,255,0.1)'; bgCtx.lineWidth = 1;
      for (let y = 32; y < h; y += 32) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
    } else if (bgType === 'grid') {
      bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = 'rgba(255,255,255,0.08)'; bgCtx.lineWidth = 1;
      for (let x = 0; x < w; x += 28) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke(); }
      for (let y = 0; y < h; y += 28) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
    } else if (bgType === 'dotgrid') {
      bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
      bgCtx.fillStyle = 'rgba(255,255,255,0.2)';
      for (let x = 28; x < w; x += 28) {
        for (let y = 28; y < h; y += 28) {
          bgCtx.beginPath(); bgCtx.arc(x, y, 1.5, 0, Math.PI * 2); bgCtx.fill();
        }
      }
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
    if (typeof UI !== 'undefined') UI.showToast('Image saved!');
  }

  function getStrokes() { return strokes; }
  function loadStrokes(s) { strokes = s || []; redoStack = []; redrawStrokes(); }

  return { init, undo, redo, clearCanvas, exportImage, getStrokes, loadStrokes, drawBackground };
})();