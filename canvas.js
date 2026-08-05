// ===== NoteMax Canvas - CLEAN REWRITE =====
const Canvas = (() => {
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let dpr = 1;
  
  // Drawing state
  let isDrawing = false;
  let currentPointerId = null;
  
  // Tool settings
  let currentTool = 'pen';
  let penColor = '#ffffff';
  let penSize = 5;
  let penOpacity = 1;
  
  // Stroke management
  let strokes = [];
  let redoStack = [];
  let currentStroke = null;
  
  // Background
  let bgType = 'dark';
  
  // Settings
  let scribbleEraseEnabled = false;
  let shapeRecognitionEnabled = false;
  let fingerDrawEnabled = false;
  let beautifyEnabled = false;
  let gesturesEnabled = true;
  let menuOpen = false;
  
  // Gestures
  let activeTouches = new Map();
  let gestureStartTime = 0;
  let lastGestureTime = 0;
  
  // Scribble-hold-to-erase
  let scribbleHoldTimer = null;
  let scribbleDetected = false;
  
  // Shape hold
  let shapeHoldTimer = null;
  let shapeHoldPos = null;

  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas || !bgCanvas) {
      console.error('Canvas not found');
      return;
    }
    
    ctx = drawingCanvas.getContext('2d');
    bgCtx = bgCanvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    
    resizeCanvases();
    window.addEventListener('resize', () => setTimeout(resizeCanvases, 50));
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvases, 300));
    
    // POINTER EVENTS - one clean set
    drawingCanvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    drawingCanvas.addEventListener('pointermove', handlePointerMove, { passive: false });
    drawingCanvas.addEventListener('pointerup', handlePointerUp, { passive: false });
    drawingCanvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
    drawingCanvas.addEventListener('pointerleave', handlePointerUp, { passive: false });
    
    // Prevent scrolling
    drawingCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    drawingCanvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    drawingCanvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    setupToolbar();
    setupOutsideClickForMenu();
    console.log('✅ Canvas ready');
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
    
    // Set canvas size
    drawingCanvas.width = rect.width * dpr;
    drawingCanvas.height = rect.height * dpr;
    drawingCanvas.style.width = rect.width + 'px';
    drawingCanvas.style.height = rect.height + 'px';
    
    bgCanvas.width = rect.width * dpr;
    bgCanvas.height = rect.height * dpr;
    bgCanvas.style.width = rect.width + 'px';
    bgCanvas.style.height = rect.height + 'px';
    
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    drawBackground();
    redrawStrokes();
  }

  // ========== TOUCH GESTURES ==========
  function handleTouchStart(e) {
    if (!gesturesEnabled) return;
    Array.from(e.touches).forEach(touch => {
      activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY, t: Date.now() });
    });
    if (e.touches.length >= 2) {
      gestureStartTime = Date.now();
      // Cancel any drawing
      if (isDrawing) {
        isDrawing = false;
        currentStroke = null;
        clearTimers();
        redrawStrokes();
      }
      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    if (!gesturesEnabled) return;
    const now = Date.now();
    const duration = now - gestureStartTime;
    const cooldown = now - lastGestureTime;
    
    if (duration < 300 && cooldown > 400 && activeTouches.size >= 2) {
      const count = activeTouches.size;
      if (count === 2) {
        lastGestureTime = now;
        undo();
        showToast('↶ Undo');
        e.preventDefault();
      } else if (count === 3) {
        lastGestureTime = now;
        redo();
        showToast('↷ Redo');
        e.preventDefault();
      }
    }
    
    Array.from(e.changedTouches).forEach(t => activeTouches.delete(t.identifier));
  }

  // ========== POINTER EVENTS (Simple & Reliable) ==========
  function handlePointerDown(e) {
    // Ignore if select/lasso tool
    if (currentTool === 'select' || currentTool === 'lasso') return;
    
    // Check input type
    if (e.pointerType === 'touch' && !fingerDrawEnabled) return;
    if (e.pointerType === 'touch' && activeTouches.size > 1) return;
    
    e.preventDefault();
    
    // Close menu if open
    if (menuOpen) closePenSettings();
    
    // Capture pointer for smooth drawing
    try { drawingCanvas.setPointerCapture(e.pointerId); } catch(err) {}
    
    currentPointerId = e.pointerId;
    isDrawing = true;
    clearTimers();
    scribbleDetected = false;
    shapeHoldPos = null;
    
    const pos = getPos(e);
    
    // Create new stroke
    currentStroke = {
      tool: currentTool,
      color: currentTool === 'highlighter' ? '#ffff00' : penColor,
      size: penSize,
      opacity: penOpacity,
      points: [pos]
    };
    
    // Draw initial dot
    if (currentTool !== 'eraser') {
      ctx.save();
      ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
      ctx.fillStyle = currentStroke.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, penSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      eraseAt(pos.x, pos.y, penSize * 4);
    }
  }

  function handlePointerMove(e) {
    if (!isDrawing) return;
    if (e.pointerId !== currentPointerId) return;
    if (e.pointerType === 'touch' && !fingerDrawEnabled) return;
    if (activeTouches.size > 1) return;
    
    e.preventDefault();
    
    const pos = getPos(e);
    if (!currentStroke || !currentStroke.points.length) return;
    
    const lastPt = currentStroke.points[currentStroke.points.length - 1];
    const dx = pos.x - lastPt.x;
    const dy = pos.y - lastPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Skip if too close (prevents duplicates)
    if (dist < 0.5) return;
    
    currentStroke.points.push(pos);
    
    if (currentTool === 'eraser') {
      eraseAt(pos.x, pos.y, penSize * 4);
    } else {
      // Draw simple line segment
      drawSegment(lastPt, pos, currentStroke);
      
      // Check for scribble erase pattern
      if (scribbleEraseEnabled && currentTool !== 'highlighter' && currentStroke.points.length > 20) {
        checkScribble(pos);
      }
      
      // Check for shape hold
      if (shapeRecognitionEnabled && currentTool === 'pen' && !scribbleDetected && currentStroke.points.length > 10) {
        checkShapeHold(pos);
      }
    }
  }

  function handlePointerUp(e) {
    if (!isDrawing) return;
    if (e.pointerId !== currentPointerId && currentPointerId !== null) return;
    
    isDrawing = false;
    currentPointerId = null;
    clearTimers();
    
    try { drawingCanvas.releasePointerCapture(e.pointerId); } catch(err) {}
    
    if (currentStroke && currentStroke.points.length > 0) {
      // Auto shape recognition on release
      if (shapeRecognitionEnabled && currentTool === 'pen' && !scribbleDetected && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape);
          currentStroke.recognizedShape = shape.type;
          showToast(`✨ ${shape.type}`);
        }
      }
      
      // Beautify
      if (beautifyEnabled && currentTool === 'pen' && !currentStroke.recognizedShape) {
        currentStroke = beautifyStroke(currentStroke);
      }
      
      strokes.push(currentStroke);
      redoStack = [];
      
      // Redraw for final smooth appearance
      redrawStrokes();
    }
    
    currentStroke = null;
    scribbleDetected = false;
  }

  function getPos(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure > 0 ? e.pressure : 0.5
    };
  }

  // ========== SIMPLE SEGMENT DRAWING ==========
  function drawSegment(p1, p2, stroke) {
    ctx.save();
    ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Pressure-sensitive width for pen only
    const width = stroke.tool === 'pen' 
      ? stroke.size * (0.7 + (p2.pressure || 0.5) * 0.5)
      : stroke.size;
    ctx.lineWidth = width;
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  // ========== TIMER MANAGEMENT ==========
  function clearTimers() {
    if (scribbleHoldTimer) { clearTimeout(scribbleHoldTimer); scribbleHoldTimer = null; }
    if (shapeHoldTimer) { clearTimeout(shapeHoldTimer); shapeHoldTimer = null; }
    hideIndicator('scribble');
    hideIndicator('shape');
  }

  // ========== SCRIBBLE CHECK ==========
  function checkScribble(pos) {
    if (scribbleDetected) return;
    if (!isScribble(currentStroke.points)) return;
    
    scribbleDetected = true;
    showIndicator(pos, 'scribble', 400);
    
    scribbleHoldTimer = setTimeout(() => {
      if (isDrawing && currentStroke && scribbleDetected) {
        eraseScribbledArea(currentStroke.points);
        currentStroke = null;
        isDrawing = false;
        redrawStrokes();
        showToast('⚡ Erased!');
        if (navigator.vibrate) navigator.vibrate(30);
      }
      hideIndicator('scribble');
      scribbleDetected = false;
    }, 400);
  }

  // ========== SHAPE HOLD CHECK ==========
  function checkShapeHold(pos) {
    if (shapeHoldPos) {
      const dx = pos.x - shapeHoldPos.x;
      const dy = pos.y - shapeHoldPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 12) {
        // Reset timer
        startShapeHold(pos);
      }
    } else {
      startShapeHold(pos);
    }
  }

  function startShapeHold(pos) {
    if (shapeHoldTimer) clearTimeout(shapeHoldTimer);
    hideIndicator('shape');
    shapeHoldPos = pos;
    
    shapeHoldTimer = setTimeout(() => {
      if (isDrawing && currentStroke && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape);
          currentStroke.recognizedShape = shape.type;
          strokes.push(currentStroke);
          redoStack = [];
          currentStroke = null;
          isDrawing = false;
          redrawStrokes();
          showToast(`✨ ${shape.type}`);
          if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
        }
      }
      hideIndicator('shape');
    }, 700);
    
    showIndicator(pos, 'shape', 700);
  }

  // ========== INDICATORS ==========
  function showIndicator(pos, type, duration) {
    const id = 'ind-' + type;
    const color = type === 'shape' ? '#ff9500' : '#ff453a';
    
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = `position:absolute;width:40px;height:40px;border:3px solid ${color};border-radius:50%;pointer-events:none;z-index:100;border-top-color:transparent;`;
      document.getElementById('canvasWrap').appendChild(el);
      
      if (!document.getElementById('ind-style')) {
        const s = document.createElement('style');
        s.id = 'ind-style';
        s.textContent = `@keyframes ind-spin{0%{transform:translate(-50%,-50%) scale(0.6) rotate(0);opacity:0.5}100%{transform:translate(-50%,-50%) scale(1.3) rotate(720deg);opacity:1}}`;
        document.head.appendChild(s);
      }
    }
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.display = 'block';
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = `ind-spin ${duration}ms linear`;
  }

  function hideIndicator(type) {
    const el = document.getElementById('ind-' + type);
    if (el) el.style.display = 'none';
  }

  // ========== SCRIBBLE DETECTION ==========
  function isScribble(points) {
    if (points.length < 20) return false;
    const recent = points.slice(-25);
    
    let changes = 0;
    let lastDx = 0, lastDy = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i-1].x;
      const dy = recent[i].y - recent[i-1].y;
      if (i > 1 && (dx * lastDx + dy * lastDy) < 0) changes++;
      lastDx = dx;
      lastDy = dy;
    }
    
    const xs = recent.map(p => p.x);
    const ys = recent.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    
    let len = 0;
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i-1].x;
      const dy = recent[i].y - recent[i-1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    
    const diag = Math.sqrt(w * w + h * h);
    if (diag < 20) return false;
    const compactness = len / diag;
    
    return changes >= 5 && compactness > 3;
  }

  function eraseScribbledArea(pts) {
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs) - 20;
    const maxX = Math.max(...xs) + 20;
    const minY = Math.min(...ys) - 20;
    const maxY = Math.max(...ys) + 20;
    strokes = strokes.filter(s => !s.points.some(p =>
      p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
    ));
  }

  // ========== SHAPE DETECTION ==========
  function detectShape(points) {
    if (points.length < 8) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    if (w < 25 || h < 25) {
      if (isLine(points)) return { type: 'Line', start: points[0], end: points[points.length - 1] };
      return null;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const first = points[0], last = points[points.length - 1];
    const closeDist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    const closed = closeDist < Math.max(w, h) * 0.35;
    
    if (isLine(points)) return { type: 'Line', start: first, end: last };
    
    if (closed) {
      const aspect = w / h;
      const dists = points.map(p => Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2)));
      const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
      const variance = dists.reduce((s, d) => s + Math.pow(d - avg, 2), 0) / dists.length;
      const cv = Math.sqrt(variance) / avg;
      
      if (cv < 0.2) {
        return {
          type: aspect > 0.85 && aspect < 1.18 ? 'Circle' : 'Ellipse',
          cx, cy, rx: w / 2, ry: h / 2
        };
      }
      
      // Rectangle check
      let rectScore = 0;
      points.forEach(p => {
        if (Math.abs(p.x - minX) < w * 0.12 || Math.abs(p.x - maxX) < w * 0.12 ||
            Math.abs(p.y - minY) < h * 0.12 || Math.abs(p.y - maxY) < h * 0.12) {
          rectScore++;
        }
      });
      if (rectScore / points.length > 0.55) {
        return {
          type: aspect > 0.85 && aspect < 1.18 ? 'Square' : 'Rectangle',
          minX, minY, maxX, maxY
        };
      }
    }
    return null;
  }

  function isLine(points) {
    if (points.length < 3) return false;
    const first = points[0], last = points[points.length - 1];
    const total = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    let path = 0;
    for (let i = 1; i < points.length; i++) {
      path += Math.sqrt(Math.pow(points[i].x - points[i-1].x, 2) + Math.pow(points[i].y - points[i-1].y, 2));
    }
    return path > 0 && total / path > 0.96;
  }

  function generateShapePoints(shape) {
    const pts = [];
    switch (shape.type) {
      case 'Circle':
      case 'Ellipse':
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          pts.push({ x: shape.cx + Math.cos(a) * shape.rx, y: shape.cy + Math.sin(a) * shape.ry, pressure: 0.7 });
        }
        break;
      case 'Rectangle':
      case 'Square':
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.minY, pressure: 0.7 });
        pts.push({ x: shape.maxX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.maxY, pressure: 0.7 });
        pts.push({ x: shape.minX, y: shape.minY, pressure: 0.7 });
        break;
      case 'Line':
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        break;
    }
    return pts;
  }

  // ========== BEAUTIFY ==========
  function beautifyStroke(stroke) {
    if (!stroke.points || stroke.points.length < 3) return stroke;
    let pts = simplify(stroke.points, 1.5);
    pts = chaikin(pts);
    pts = chaikin(pts);
    return { ...stroke, points: pts };
  }

  function simplify(points, tol) {
    if (points.length < 3) return points;
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const dx = points[i].x - prev.x;
      const dy = points[i].y - prev.y;
      if (Math.sqrt(dx * dx + dy * dy) >= tol) result.push(points[i]);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function chaikin(points) {
    if (points.length < 3) return points;
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i], p1 = points[i + 1];
      result.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y, pressure: p0.pressure });
      result.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y, pressure: p1.pressure });
    }
    result.push(points[points.length - 1]);
    return result;
  }

  // ========== ERASE ==========
  function eraseAt(x, y, radius) {
    let hit = false;
    strokes = strokes.filter(s => {
      const hits = s.points.some(p => {
        const dx = p.x - x;
        const dy = p.y - y;
        return Math.sqrt(dx * dx + dy * dy) < radius;
      });
      if (hits) hit = true;
      return !hits;
    });
    if (hit) redrawStrokes();
  }

  // ========== UNDO/REDO ==========
  function undo() {
    if (strokes.length === 0) return;
    redoStack.push(strokes.pop());
    redrawStrokes();
    showToast('↶ Undone');
  }

  function redo() {
    if (redoStack.length === 0) return;
    strokes.push(redoStack.pop());
    redrawStrokes();
    showToast('↷ Redone');
  }

  function clearCanvas() {
    if (!confirm('Clear drawing?')) return;
    strokes = [];
    redoStack = [];
    redrawStrokes();
  }

  // ========== REDRAW ==========
  function redrawStrokes() {
    if (!ctx) return;
    const w = drawingCanvas.width / dpr;
    const h = drawingCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    strokes.forEach(renderStroke);
  }

  function renderStroke(stroke) {
    if (!stroke.points || stroke.points.length < 1) return;
    
    ctx.save();
    ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.3 : (stroke.opacity || 1);
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    
    const pts = stroke.points;
    
    if (stroke.tool === 'pen') {
      // Pressure-sensitive with smooth curves
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const width = stroke.size * (0.7 + (p1.pressure || 0.5) * 0.5);
        ctx.lineWidth = width;
        
        ctx.beginPath();
        if (i === 1) {
          ctx.moveTo(p0.x, p0.y);
        } else {
          const pPrev = pts[i - 2];
          ctx.moveTo((pPrev.x + p0.x) / 2, (pPrev.y + p0.y) / 2);
        }
        
        if (i < pts.length - 1) {
          ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        } else {
          ctx.lineTo(p1.x, p1.y);
        }
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  // ========== BACKGROUND ==========
  function drawBackground() {
    if (!bgCtx) return;
    const w = bgCanvas.width / dpr;
    const h = bgCanvas.height / dpr;
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
        bgCtx.beginPath();
        bgCtx.moveTo(x, 0);
        bgCtx.lineTo(x, h);
        bgCtx.stroke();
      }
      for (let y = 0; y < h; y += 28) {
        bgCtx.beginPath();
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(w, y);
        bgCtx.stroke();
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

  // ========== TOOLBAR ==========
  function setupToolbar() {
    // Pen presets
    document.querySelectorAll('.pen-preset').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasActive = btn.classList.contains('active');
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = 'pen';
        penColor = btn.dataset.color;
        const picker = document.getElementById('penColorPicker');
        if (picker) picker.value = penColor;
        if (wasActive) togglePenSettings();
        else openPenSettings();
        updateCursor();
      });
    });
    
    // Other tools
    document.querySelectorAll('.pen-tool:not(.pen-preset)').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tool = btn.dataset.tool;
        if (!tool) return;
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = tool;
        if (tool === 'highlighter') openPenSettings();
        else closePenSettings();
        updateCursor();
      });
    });
    
    // Thickness
    document.querySelectorAll('.thickness-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penSize = parseInt(btn.dataset.size);
        const slider = document.getElementById('penSizeSlider');
        const val = document.getElementById('penSizeValue');
        if (slider) slider.value = penSize;
        if (val) val.textContent = penSize;
      });
    });
    
    // Auto shape button
    const autoShape = document.getElementById('autoShapeBtn');
    if (autoShape) {
      autoShape.addEventListener('click', e => {
        e.stopPropagation();
        shapeRecognitionEnabled = !shapeRecognitionEnabled;
        autoShape.classList.toggle('active', shapeRecognitionEnabled);
        showToast(shapeRecognitionEnabled ? '✨ Shapes ON' : 'Shapes OFF');
        const toggle = document.getElementById('shapeRecognitionToggle');
        if (toggle) toggle.checked = shapeRecognitionEnabled;
      });
    }
    
    // Pen settings controls
    document.getElementById('closePenSettings')?.addEventListener('click', e => {
      e.stopPropagation();
      closePenSettings();
    });
    
    document.getElementById('penColorPicker')?.addEventListener('input', e => {
      penColor = e.target.value;
      const active = document.querySelector('.pen-preset.active .pen-visual');
      if (active) active.style.background = penColor;
    });
    
    document.getElementById('penSizeSlider')?.addEventListener('input', e => {
      penSize = parseInt(e.target.value);
      const val = document.getElementById('penSizeValue');
      if (val) val.textContent = penSize;
      document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
    });
    
    document.getElementById('penOpacity')?.addEventListener('input', e => {
      penOpacity = parseFloat(e.target.value) / 100;
      const val = document.getElementById('opacityValue');
      if (val) val.textContent = Math.round(penOpacity * 100);
    });
    
    document.getElementById('canvasBgSelect')?.addEventListener('change', e => {
      bgType = e.target.value;
      drawBackground();
    });
    
    document.getElementById('scribbleEraseToggle')?.addEventListener('change', e => {
      scribbleEraseEnabled = e.target.checked;
      showToast(scribbleEraseEnabled ? '⚡ Scribble Erase ON' : 'Off');
    });
    
    document.getElementById('shapeRecognitionToggle')?.addEventListener('change', e => {
      shapeRecognitionEnabled = e.target.checked;
      const btn = document.getElementById('autoShapeBtn');
      if (btn) btn.classList.toggle('active', shapeRecognitionEnabled);
    });
    
    document.getElementById('fingerDrawToggle')?.addEventListener('change', e => {
      fingerDrawEnabled = e.target.checked;
      showToast(fingerDrawEnabled ? '👆 Finger ON' : '✏️ Pencil only');
    });
    
    document.getElementById('beautifyToggle')?.addEventListener('change', e => {
      beautifyEnabled = e.target.checked;
      if (beautifyEnabled) {
        strokes = strokes.map(beautifyStroke);
        redrawStrokes();
      }
    });
    
    document.getElementById('gesturesToggle')?.addEventListener('change', e => {
      gesturesEnabled = e.target.checked;
    });
    
    // Undo/Redo buttons
    document.getElementById('undoBtn')?.addEventListener('click', e => { e.stopPropagation(); undo(); });
    document.getElementById('redoBtn')?.addEventListener('click', e => { e.stopPropagation(); redo(); });
    
    // Prevent menu close on interact
    const settings = document.getElementById('penSettings');
    if (settings) {
      settings.addEventListener('pointerdown', e => e.stopPropagation());
      settings.addEventListener('click', e => e.stopPropagation());
    }
  }

  function openPenSettings() {
    const p = document.getElementById('penSettings');
    if (p) { p.classList.remove('hidden'); menuOpen = true; }
  }

  function closePenSettings() {
    const p = document.getElementById('penSettings');
    if (p) { p.classList.add('hidden'); menuOpen = false; }
  }

  function togglePenSettings() {
    if (menuOpen) closePenSettings();
    else openPenSettings();
  }

  function setupOutsideClickForMenu() {
    document.addEventListener('pointerdown', e => {
      if (!menuOpen) return;
      const panel = document.getElementById('penSettings');
      if (panel && panel.contains(e.target)) return;
      if (e.target.closest('.pen-preset')) return;
      closePenSettings();
    }, true);
  }

  function updateCursor() {
    if (!drawingCanvas) return;
    drawingCanvas.style.cursor = 
      currentTool === 'eraser' ? 'cell' :
      currentTool === 'select' || currentTool === 'lasso' ? 'default' :
      'crosshair';
  }

  function showToast(msg) {
    if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg);
  }

  // ========== EXPORT ==========
  function exportImage() {
    const merged = document.createElement('canvas');
    merged.width = drawingCanvas.width;
    merged.height = drawingCanvas.height;
    const mCtx = merged.getContext('2d');
    mCtx.drawImage(bgCanvas, 0, 0);
    mCtx.drawImage(drawingCanvas, 0, 0);
    const link = document.createElement('a');
    link.download = 'notemax.png';
    link.href = merged.toDataURL('image/png');
    link.click();
  }

  function getThumbnail(w = 150, h = 200) {
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    const tCtx = t.getContext('2d');
    tCtx.drawImage(bgCanvas, 0, 0, w, h);
    tCtx.drawImage(drawingCanvas, 0, 0, w, h);
    return t.toDataURL('image/png');
  }

  // ========== PUBLIC API ==========
  return {
    init,
    undo,
    redo,
    clearCanvas,
    exportImage,
    getStrokes: () => strokes,
    loadStrokes: s => { strokes = s || []; redoStack = []; redrawStrokes(); },
    drawBackground,
    getBgType: () => bgType,
    setBgType: t => {
      bgType = t;
      const sel = document.getElementById('canvasBgSelect');
      if (sel) sel.value = t;
      drawBackground();
    },
    getThumbnail
  };
})();
