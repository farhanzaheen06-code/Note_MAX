// ===== CANVAS MODULE WITH SCRIBBLE ERASE + SHAPE RECOGNITION =====
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

  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas) return;
    
    ctx = drawingCanvas.getContext('2d');
    bgCtx = bgCanvas.getContext('2d');
    
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    bgCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    drawBackground();
    redrawStrokes();
  }

  function setupToolbar() {
    // Pen presets from top toolbar
    document.querySelectorAll('.pen-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = 'pen';
        penColor = btn.dataset.color;
        const colorPicker = document.getElementById('penColorPicker');
        if (colorPicker) colorPicker.value = penColor;
        togglePenSettings(true);
      });
    });

    // Other tools
    document.querySelectorAll('.pen-tool:not(.pen-preset)').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.dataset.tool || 'pen';
        updateCursor();
      });
    });

    // Highlighter
    const highlighter = document.getElementById('highlighterTool');
    if (highlighter) {
      highlighter.addEventListener('click', () => {
        currentTool = 'highlighter';
        penColor = '#ffff00';
        togglePenSettings(true);
      });
    }

    // Auto shape recognition button toggle
    const autoShape = document.getElementById('autoShapeBtn');
    if (autoShape) {
      autoShape.addEventListener('click', () => {
        shapeRecognitionEnabled = !shapeRecognitionEnabled;
        autoShape.classList.toggle('active', shapeRecognitionEnabled);
        UI.showToast(shapeRecognitionEnabled ? '✨ Shape recognition ON' : 'Shape recognition OFF');
        const toggle = document.getElementById('shapeRecognitionToggle');
        if (toggle) toggle.checked = shapeRecognitionEnabled;
      });
    }

    // Pen color
    const colorPicker = document.getElementById('penColorPicker');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => { penColor = e.target.value; });
    }

    // Pen size
    const sizeSlider = document.getElementById('penSizeSlider');
    const sizeValue = document.getElementById('penSizeValue');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', e => {
        penSize = parseInt(e.target.value);
        if (sizeValue) sizeValue.textContent = penSize;
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

    // Scribble erase toggle
    const scribbleToggle = document.getElementById('scribbleEraseToggle');
    if (scribbleToggle) {
      scribbleToggle.addEventListener('change', e => {
        scribbleEraseEnabled = e.target.checked;
        UI.showToast(scribbleEraseEnabled ? '✏️ Scribble erase ON' : 'Scribble erase OFF');
      });
    }

    // Shape recognition toggle
    const shapeToggle = document.getElementById('shapeRecognitionToggle');
    if (shapeToggle) {
      shapeToggle.addEventListener('change', e => {
        shapeRecognitionEnabled = e.target.checked;
        const btn = document.getElementById('autoShapeBtn');
        if (btn) btn.classList.toggle('active', shapeRecognitionEnabled);
      });
    }

    // Undo/Redo
    document.getElementById('undoBtn')?.addEventListener('click', undo);
    document.getElementById('redoBtn')?.addEventListener('click', redo);

    // Show pen settings when pen selected
    document.getElementById('penSettings')?.addEventListener('click', e => e.stopPropagation());
    
    // Click on canvas hides settings panel
    document.getElementById('canvasWrap')?.addEventListener('click', e => {
      if (e.target.tagName === 'CANVAS') togglePenSettings(false);
    });
  }

  function togglePenSettings(show) {
    const panel = document.getElementById('penSettings');
    if (!panel) return;
    if (show) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
  }

  function updateCursor() {
    if (currentTool === 'eraser') drawingCanvas.style.cursor = 'cell';
    else if (currentTool === 'select' || currentTool === 'lasso') drawingCanvas.style.cursor = 'default';
    else drawingCanvas.style.cursor = 'crosshair';
  }

  function getPos(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top),
      pressure: e.pressure || 0.5
    };
  }

  function onPointerDown(e) {
    if (currentTool === 'select' || currentTool === 'lasso') return;
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

    if (currentTool !== 'eraser') {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const pos = getPos(e);
    currentStroke.points.push(pos);

    if (currentTool === 'eraser') {
      // Direct eraser
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

  function onPointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (currentStroke && currentStroke.points.length > 0) {

      // === SCRIBBLE-TO-ERASE detection ===
      if (scribbleEraseEnabled && currentTool !== 'eraser' && currentTool !== 'highlighter') {
        if (isScribble(currentStroke.points)) {
          // Delete strokes underneath
          eraseScribbledStrokes(currentStroke.points);
          currentStroke = null;
          redrawStrokes();
          UI.showToast('✏️ Scribble erased!');
          return;
        }
      }

      // === SHAPE RECOGNITION ===
      if (shapeRecognitionEnabled && currentTool === 'pen' && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape, currentStroke.points);
          currentStroke.recognizedShape = shape.type;
          UI.showToast(`✨ Detected: ${shape.type}`);
        }
      }

      strokes.push(currentStroke);
      redoStack = [];
      redrawStrokes();
    }
    currentStroke = null;
  }

  // ========== SCRIBBLE DETECTION ==========
  function isScribble(points) {
    if (points.length < 20) return false;
    
    // Calculate direction changes
    let directionChanges = 0;
    let lastDx = 0;
    let lastDy = 0;
    
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      
      if (i > 1) {
        // Check if direction reversed significantly
        const dotProduct = dx * lastDx + dy * lastDy;
        if (dotProduct < 0) directionChanges++;
      }
      
      lastDx = dx;
      lastDy = dy;
    }
    
    // Calculate bounding box
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    
    // Calculate total path length
    let pathLength = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    
    const boxDiagonal = Math.sqrt(width * width + height * height);
    const compactness = pathLength / boxDiagonal;
    
    // Scribble: many direction changes AND high compactness (loops back)
    return directionChanges >= 5 && compactness > 3.5;
  }

  function eraseScribbledStrokes(scribblePoints) {
    // Get scribble bounding box
    const xs = scribblePoints.map(p => p.x);
    const ys = scribblePoints.map(p => p.y);
    const minX = Math.min(...xs) - 10;
    const maxX = Math.max(...xs) + 10;
    const minY = Math.min(...ys) - 10;
    const maxY = Math.max(...ys) + 10;
    
    // Remove strokes whose points fall within scribble area
    strokes = strokes.filter(stroke => {
      const overlap = stroke.points.some(p =>
        p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
      );
      return !overlap;
    });
  }

  // ========== SHAPE RECOGNITION ==========
  function detectShape(points) {
    if (points.length < 8) return null;
    
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    
    if (width < 20 || height < 20) return null;
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Check if closed shape (start and end are close)
    const first = points[0];
    const last = points[points.length - 1];
    const closeDistance = Math.sqrt(
      Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2)
    );
    const isClosed = closeDistance < Math.max(width, height) * 0.3;
    
    // Detect Line (straight)
    if (isStraightLine(points)) {
      return {
        type: 'Line',
        start: first,
        end: last
      };
    }
    
    if (isClosed) {
      // Detect Circle vs Rectangle
      const aspectRatio = width / height;
      
      // Test if points fit circle
      const radiusX = width / 2;
      const radiusY = height / 2;
      const avgRadius = (radiusX + radiusY) / 2;
      
      let circleScore = 0;
      let rectScore = 0;
      
      points.forEach(p => {
        // Distance from center
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Circle: distance close to radius
        if (Math.abs(dist - avgRadius) < avgRadius * 0.25) circleScore++;
        
        // Rectangle: point on any edge
        const onLeftEdge = Math.abs(p.x - minX) < width * 0.1;
        const onRightEdge = Math.abs(p.x - maxX) < width * 0.1;
        const onTopEdge = Math.abs(p.y - minY) < height * 0.1;
        const onBottomEdge = Math.abs(p.y - maxY) < height * 0.1;
        
        if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) rectScore++;
      });
      
      const circlePercent = circleScore / points.length;
      const rectPercent = rectScore / points.length;
      
      if (circlePercent > 0.6 && circlePercent > rectPercent) {
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.15 ? 'Circle' : 'Ellipse',
          centerX, centerY,
          radiusX: width / 2,
          radiusY: height / 2
        };
      }
      
      if (rectPercent > 0.55) {
        // Check if triangle (3 corners) or rectangle
        const corners = detectCorners(points);
        if (corners === 3) {
          return {
            type: 'Triangle',
            top: { x: centerX, y: minY },
            left: { x: minX, y: maxY },
            right: { x: maxX, y: maxY }
          };
        }
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.15 ? 'Square' : 'Rectangle',
          minX, minY, maxX, maxY
        };
      }
    }
    
    // Arrow detection (line with arrowhead)
    if (!isClosed && points.length > 10) {
      // Simple arrow: straight-ish line
      const straightness = calculateStraightness(points);
      if (straightness > 0.85) {
        return {
          type: 'Arrow',
          start: first,
          end: last
        };
      }
    }
    
    return null;
  }

  function isStraightLine(points) {
    if (points.length < 3) return false;
    const straightness = calculateStraightness(points);
    return straightness > 0.95;
  }

  function calculateStraightness(points) {
    const first = points[0];
    const last = points[points.length - 1];
    const totalDistance = Math.sqrt(
      Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2)
    );
    
    let pathLength = 0;
    for (let i = 1; i < points.length; i++) {
      pathLength += Math.sqrt(
        Math.pow(points[i].x - points[i-1].x, 2) +
        Math.pow(points[i].y - points[i-1].y, 2)
      );
    }
    
    return pathLength > 0 ? totalDistance / pathLength : 0;
  }

  function detectCorners(points) {
    // Simplified corner detection
    let corners = 0;
    const threshold = Math.PI / 3; // 60 degrees
    
    for (let i = 5; i < points.length - 5; i += 3) {
      const p1 = points[i - 5];
      const p2 = points[i];
      const p3 = points[i + 5];
      
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
      case 'Circle':
      case 'Ellipse': {
        for (let i = 0; i <= 60; i++) {
          const angle = (i / 60) * Math.PI * 2;
          pts.push({
            x: shape.centerX + Math.cos(angle) * shape.radiusX,
            y: shape.centerY + Math.sin(angle) * shape.radiusY,
            pressure: 0.7
          });
        }
        break;
      }
      case 'Rectangle':
      case 'Square': {
        // Corners in order
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        break;
      }
      case 'Triangle': {
        pts.push({ x: shape.top.x, y: shape.top.y, pressure: 0.7 });
        pts.push({ x: shape.right.x, y: shape.right.y, pressure: 0.7 });
        pts.push({ x: shape.left.x, y: shape.left.y, pressure: 0.7 });
        pts.push({ x: shape.top.x, y: shape.top.y, pressure: 0.7 });
        break;
      }
      case 'Line': {
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        break;
      }
      case 'Arrow': {
        // Line
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        // Arrowhead
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
      }
      default:
        return originalPoints;
    }
    
    return pts;
  }

  // ========== ERASING ==========
  function eraseAt(x, y, radius) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    
    // Also remove strokes hit by eraser
    strokes = strokes.filter(stroke => {
      return !stroke.points.some(p => {
        const dx = p.x - x;
        const dy = p.y - y;
        return Math.sqrt(dx * dx + dy * dy) < radius;
      });
    });
  }

  function undo() {
    if (strokes.length === 0) return;
    redoStack.push(strokes.pop());
    redrawStrokes();
    UI.showToast('↶ Undone');
  }

  function redo() {
    if (redoStack.length === 0) return;
    strokes.push(redoStack.pop());
    redrawStrokes();
    UI.showToast('↷ Redone');
  }

  function clearCanvas() {
    if (!confirm('Clear the entire drawing?')) return;
    strokes = [];
    redoStack = [];
    redrawStrokes();
    UI.showToast('Canvas cleared');
  }

  function redrawStrokes() {
    const w = drawingCanvas.width / window.devicePixelRatio;
    const h = drawingCanvas.height / window.devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    strokes.forEach(stroke => {
      if (stroke.points.length < 1) return;

      ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : (stroke.opacity || 1);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';

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
    const w = bgCanvas.width / window.devicePixelRatio;
    const h = bgCanvas.height / window.devicePixelRatio;
    bgCtx.clearRect(0, 0, w, h);

    if (bgType === 'dark') {
      bgCtx.fillStyle = '#0a0a0a';
      bgCtx.fillRect(0, 0, w, h);
    } else if (bgType === 'white') {
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, w, h);
    } else if (bgType === 'cream') {
      bgCtx.fillStyle = '#fff9e6';
      bgCtx.fillRect(0, 0, w, h);
    } else if (bgType === 'lined') {
      bgCtx.fillStyle = '#0a0a0a';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = 'rgba(255,255,255,0.1)';
      bgCtx.lineWidth = 1;
      for (let y = 32; y < h; y += 32) {
        bgCtx.beginPath();
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(w, y);
        bgCtx.stroke();
      }
    } else if (bgType === 'grid') {
      bgCtx.fillStyle = '#0a0a0a';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.strokeStyle = 'rgba(255,255,255,0.08)';
      bgCtx.lineWidth = 1;
      for (let x = 0; x < w; x += 28) {
        bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke();
      }
      for (let y = 0; y < h; y += 28) {
        bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke();
      }
    } else if (bgType === 'dotgrid') {
      bgCtx.fillStyle = '#0a0a0a';
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.fillStyle = 'rgba(255,255,255,0.2)';
      for (let x = 28; x < w; x += 28) {
        for (let y = 28; y < h; y += 28) {
          bgCtx.beginPath();
          bgCtx.arc(x, y, 1.5, 0, Math.PI * 2);
          bgCtx.fill();
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
    UI.showToast('Image saved!');
  }

  function getStrokes() { return strokes; }

  function loadStrokes(savedStrokes) {
    strokes = savedStrokes || [];
    redoStack = [];
    redrawStrokes();
  }

  return {
    init, undo, redo, clearCanvas, exportImage,
    getStrokes, loadStrokes, drawBackground
  };
})();