// ===== CANVAS - Multi-page + Gestures + Pen Styles + Fast Erase =====
const Canvas = (() => {
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#ffffff';
  let penSize = 5;
  let penOpacity = 1;
  let penStyle = 'solid';
  let strokes = [];
  let redoStack = [];
  let currentStroke = null;
  let bgType = 'dark';
  let lastPoint = null;
  let scribbleEraseEnabled = true;
  let shapeRecognitionEnabled = false;
  let fingerDrawEnabled = false;
  let beautifyEnabled = false;
  let gesturesEnabled = true;
  let menuOpen = false;
  let dpr = 1;
  
  // Live scribble
  let liveDirectionChanges = 0;
  let liveLastDx = 0, liveLastDy = 0;
  let liveScribbleTriggered = false;
  
  // Multi-touch gestures
  let activeTouches = new Map();
  let gestureStartTime = 0;
  let lastGestureTime = 0;

  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas || !bgCanvas) return;
    ctx = drawingCanvas.getContext('2d');
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
    
    // Multi-touch gestures
    drawingCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    drawingCanvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    drawingCanvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    setupToolbar();
    setupOutsideClick();
  }

  function debounce(fn, wait) {
    let t;
    return function(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
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

  // ========== MULTI-TOUCH GESTURES ==========
  function handleTouchStart(e) {
    if (!gesturesEnabled) return;
    
    // Store all active touches
    Array.from(e.touches).forEach(touch => {
      activeTouches.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now()
      });
    });
    
    if (e.touches.length >= 2) {
      gestureStartTime = Date.now();
      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    if (!gesturesEnabled) return;
    
    const endTime = Date.now();
    const gestureDuration = endTime - gestureStartTime;
    const timeSinceLastGesture = endTime - lastGestureTime;
    
    // Only trigger if it was a quick tap (< 300ms) and enough time has passed
    if (gestureDuration < 300 && timeSinceLastGesture > 300) {
      const touchCount = activeTouches.size;
      
      if (touchCount === 2) {
        // 2-finger tap = Undo
        lastGestureTime = endTime;
        performUndo();
        showGestureHint('↶ Undo');
        e.preventDefault();
      } else if (touchCount === 3) {
        // 3-finger tap = Redo
        lastGestureTime = endTime;
        performRedo();
        showGestureHint('↷ Redo');
        e.preventDefault();
      }
    }
    
    // Clear ended touches
    Array.from(e.changedTouches).forEach(touch => {
      activeTouches.delete(touch.identifier);
    });
  }

  function performUndo() {
    if (isDrawing) {
      isDrawing = false;
      currentStroke = null;
      redrawStrokes();
    }
    undo();
  }

  function performRedo() {
    redo();
  }

  function showGestureHint(text) {
    const hint = document.getElementById('gestureHint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 600);
  }

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
        if (wasActive) togglePenSettings();
        else openPenSettings();
        updateCursor();
      });
    });

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

    // Thickness quick buttons
    document.querySelectorAll('.thickness-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penSize = parseInt(btn.dataset.size);
        const sizeSlider = document.getElementById('penSizeSlider');
        const sizeValue = document.getElementById('penSizeValue');
        if (sizeSlider) sizeSlider.value = penSize;
        if (sizeValue) sizeValue.textContent = penSize;
        if (typeof UI !== 'undefined') UI.showToast(`Size: ${penSize}px`);
      });
    });

    // Pen style buttons
    document.querySelectorAll('.pen-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.pen-style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penStyle = btn.dataset.style;
        if (typeof UI !== 'undefined') UI.showToast(`Style: ${penStyle}`);
      });
    });

    const autoShape = document.getElementById('autoShapeBtn');
    if (autoShape) {
      autoShape.addEventListener('click', (e) => {
        e.stopPropagation();
        shapeRecognitionEnabled = !shapeRecognitionEnabled;
        autoShape.classList.toggle('active', shapeRecognitionEnabled);
        if (typeof UI !== 'undefined') {
          UI.showToast(shapeRecognitionEnabled ? '✨ Shape ON' : 'Shape OFF');
        }
        const toggle = document.getElementById('shapeRecognitionToggle');
        if (toggle) toggle.checked = shapeRecognitionEnabled;
      });
    }

    document.getElementById('closePenSettings')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closePenSettings();
    });

    const colorPicker = document.getElementById('penColorPicker');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => {
        penColor = e.target.value;
        const activePreset = document.querySelector('.pen-preset.active .pen-visual');
        if (activePreset) activePreset.style.background = penColor;
      });
    }

    const sizeSlider = document.getElementById('penSizeSlider');
    const sizeValue = document.getElementById('penSizeValue');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', e => {
        penSize = parseInt(e.target.value);
        if (sizeValue) sizeValue.textContent = penSize;
        document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
      });
    }

    const opacitySlider = document.getElementById('penOpacity');
    const opacityValue = document.getElementById('opacityValue');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', e => {
        penOpacity = parseFloat(e.target.value) / 100;
        if (opacityValue) opacityValue.textContent = Math.round(penOpacity * 100);
      });
    }

    const bgSelect = document.getElementById('canvasBgSelect');
    if (bgSelect) {
      bgSelect.addEventListener('change', e => {
        bgType = e.target.value;
        drawBackground();
      });
    }

    const scribbleToggle = document.getElementById('scribbleEraseToggle');
    if (scribbleToggle) {
      scribbleToggle.addEventListener('change', e => {
        scribbleEraseEnabled = e.target.checked;
        if (typeof UI !== 'undefined') UI.showToast(scribbleEraseEnabled ? '⚡ Fast Erase ON' : 'Fast Erase OFF');
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

    const fingerToggle = document.getElementById('fingerDrawToggle');
    if (fingerToggle) {
      fingerToggle.addEventListener('change', e => {
        fingerDrawEnabled = e.target.checked;
        if (typeof UI !== 'undefined') UI.showToast(fingerDrawEnabled ? '👆 Finger ON' : '✏️ Pencil only');
      });
    }

    const beautifyToggle = document.getElementById('beautifyToggle');
    if (beautifyToggle) {
      beautifyToggle.addEventListener('change', e => {
        beautifyEnabled = e.target.checked;
        if (typeof UI !== 'undefined') UI.showToast(beautifyEnabled ? '✨ Beautify ON' : 'Beautify OFF');
        if (beautifyEnabled) {
          strokes = strokes.map(s => beautifyStroke(s));
          redrawStrokes();
        }
      });
    }

    const gesturesToggle = document.getElementById('gesturesToggle');
    if (gesturesToggle) {
      gesturesToggle.addEventListener('change', e => {
        gesturesEnabled = e.target.checked;
        if (typeof UI !== 'undefined') UI.showToast(gesturesEnabled ? '✌️ Gestures ON' : 'Gestures OFF');
      });
    }

    document.getElementById('undoBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      undo();
    });
    document.getElementById('redoBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      redo();
    });

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

  function shouldAcceptInput(e) {
    if (e.pointerType === 'mouse') return true;
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'touch') return fingerDrawEnabled;
    return true;
  }

  function onPointerDown(e) {
    if (currentTool === 'select' || currentTool === 'lasso') return;
    if (!shouldAcceptInput(e)) return;
    if (e.pointerType === 'touch' && activeTouches.size > 1) return; // Multi-touch = gesture
    
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen) closePenSettings();
    
    try { drawingCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    
    isDrawing = true;
    const pos = getPos(e);
    lastPoint = pos;
    liveDirectionChanges = 0;
    liveLastDx = 0;
    liveLastDy = 0;
    liveScribbleTriggered = false;

    currentStroke = {
      tool: currentTool,
      color: penColor,
      size: penSize,
      opacity: penOpacity,
      style: penStyle,
      points: [pos]
    };

    if (currentTool !== 'eraser') {
      drawStrokeStart(pos);
    }
  }

  function drawStrokeStart(pos) {
    ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
    ctx.fillStyle = penColor;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, penSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    if (!shouldAcceptInput(e)) return;
    if (activeTouches.size > 1) return;
    
    e.preventDefault();
    e.stopPropagation();

    const pos = getPos(e);
    if (!currentStroke) return;
    currentStroke.points.push(pos);

    // Fast scribble detection
    if (scribbleEraseEnabled && !liveScribbleTriggered && 
        currentTool !== 'eraser' && currentTool !== 'highlighter' &&
        currentStroke.points.length > 12) {
      const dx = pos.x - lastPoint.x;
      const dy = pos.y - lastPoint.y;
      if (dx * liveLastDx + dy * liveLastDy < 0) {
        liveDirectionChanges++;
      }
      liveLastDx = dx;
      liveLastDy = dy;
      if (liveDirectionChanges >= 4 && isLiveScribble(currentStroke.points)) {
        liveScribbleTriggered = true;
        eraseScribbledStrokes(currentStroke.points);
        currentStroke = null;
        isDrawing = false;
        redrawStrokes();
        if (typeof UI !== 'undefined') UI.showToast('⚡ Erased!');
        try { drawingCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
        return;
      }
    }

    if (currentTool === 'eraser') {
      eraseAt(pos.x, pos.y, penSize * 3);
    } else {
      drawSegment(lastPoint, pos);
    }
    lastPoint = pos;
  }

  function drawSegment(p1, p2) {
    const dynamicSize = currentTool === 'pen'
      ? penSize * (0.5 + p2.pressure * 0.8)
      : penSize;
    
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = currentTool === 'highlighter' ? 0.3 : penOpacity;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = dynamicSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (penStyle === 'dashed') {
      ctx.setLineDash([dynamicSize * 2, dynamicSize * 1.5]);
    } else if (penStyle === 'dotted') {
      ctx.setLineDash([1, dynamicSize * 1.5]);
    } else {
      ctx.setLineDash([]);
    }

    if (penStyle === 'double') {
      // Draw two parallel lines
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const offset = dynamicSize;
      const dx = Math.cos(angle + Math.PI / 2) * offset;
      const dy = Math.sin(angle + Math.PI / 2) * offset;
      
      ctx.lineWidth = dynamicSize / 3;
      ctx.beginPath();
      ctx.moveTo(p1.x + dx, p1.y + dy);
      ctx.lineTo(p2.x + dx, p2.y + dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p1.x - dx, p1.y - dy);
      ctx.lineTo(p2.x - dx, p2.y - dy);
      ctx.stroke();
    } else if (penStyle === 'curly') {
      // Wavy line
      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const amplitude = dynamicSize * 1.5;
      const wavelength = dynamicSize * 3;
      const numWaves = Math.max(1, Math.floor(dist / wavelength));
      
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      for (let i = 1; i <= numWaves * 4; i++) {
        const t = i / (numWaves * 4);
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        const waveOffset = Math.sin(t * numWaves * Math.PI * 2) * amplitude;
        const offsetX = Math.cos(angle + Math.PI / 2) * waveOffset;
        const offsetY = Math.sin(angle + Math.PI / 2) * waveOffset;
        ctx.lineTo(x + offsetX, y + offsetY);
      }
      ctx.stroke();
    } else if (penStyle === 'zigzag') {
      // Zigzag line
      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const amplitude = dynamicSize * 1.5;
      const wavelength = dynamicSize * 2;
      const numZigs = Math.max(1, Math.floor(dist / wavelength));
      
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      for (let i = 1; i <= numZigs * 2; i++) {
        const t = i / (numZigs * 2);
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        const zigOffset = (i % 2 === 0 ? 1 : -1) * amplitude;
        const offsetX = Math.cos(angle + Math.PI / 2) * zigOffset;
        const offsetY = Math.sin(angle + Math.PI / 2) * zigOffset;
        ctx.lineTo(x + offsetX, y + offsetY);
      }
      ctx.stroke();
    } else {
      // Solid, dashed, or dotted
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
      ctx.stroke();
    }
    
    ctx.setLineDash([]);
  }

  function onPointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);
    try { if (e && e.pointerId) drawingCanvas.releasePointerCapture(e.pointerId); } catch (err) {}

    if (currentStroke && currentStroke.points.length > 0) {
      if (shapeRecognitionEnabled && currentTool === 'pen' && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape, currentStroke.points);
          currentStroke.recognizedShape = shape.type;
          if (typeof UI !== 'undefined') UI.showToast(`✨ ${shape.type}`);
        }
      }
      if (beautifyEnabled && currentTool !== 'eraser' && !currentStroke.recognizedShape) {
        currentStroke = beautifyStroke(currentStroke);
      }
      strokes.push(currentStroke);
      redoStack = [];
      redrawStrokes();
    }
    currentStroke = null;
  }

  function isLiveScribble(points) {
    if (points.length < 12) return false;
    const recentPoints = points.slice(-Math.min(20, points.length));
    let directionChanges = 0;
    let lastDx = 0, lastDy = 0;
    for (let i = 1; i < recentPoints.length; i++) {
      const dx = recentPoints[i].x - recentPoints[i-1].x;
      const dy = recentPoints[i].y - recentPoints[i-1].y;
      if (i > 1) { if (dx * lastDx + dy * lastDy < 0) directionChanges++; }
      lastDx = dx; lastDy = dy;
    }
    const xs = recentPoints.map(p => p.x);
    const ys = recentPoints.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    let pathLength = 0;
    for (let i = 1; i < recentPoints.length; i++) {
      const dx = recentPoints[i].x - recentPoints[i-1].x;
      const dy = recentPoints[i].y - recentPoints[i-1].y;
      pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    const boxDiagonal = Math.sqrt(width * width + height * height);
    const compactness = boxDiagonal > 0 ? pathLength / boxDiagonal : 0;
    return directionChanges >= 3 && compactness > 2.5;
  }

  function eraseScribbledStrokes(scribblePoints) {
    const xs = scribblePoints.map(p => p.x);
    const ys = scribblePoints.map(p => p.y);
    const minX = Math.min(...xs) - 15;
    const maxX = Math.max(...xs) + 15;
    const minY = Math.min(...ys) - 15;
    const maxY = Math.max(...ys) + 15;
    strokes = strokes.filter(stroke => {
      return !stroke.points.some(p =>
        p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
      );
    });
  }

  function beautifyStroke(stroke) {
    if (!stroke.points || stroke.points.length < 3) return stroke;
    const simplified = simplifyPoints(stroke.points, 1.5);
    let smoothed = chaikinSmooth(simplified);
    smoothed = chaikinSmooth(smoothed);
    smoothed = smoothPressure(smoothed);
    return { ...stroke, points: smoothed, beautified: true };
  }

  function simplifyPoints(points, tolerance) {
    if (points.length < 3) return points;
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const dist = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
      if (dist >= tolerance) result.push(curr);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function chaikinSmooth(points) {
    if (points.length < 3) return points;
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i], p1 = points[i + 1];
      result.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
        pressure: 0.75 * (p0.pressure || 0.5) + 0.25 * (p1.pressure || 0.5)
      });
      result.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
        pressure: 0.25 * (p0.pressure || 0.5) + 0.75 * (p1.pressure || 0.5)
      });
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function smoothPressure(points) {
    if (points.length < 5) return points;
    const windowSize = 5;
    const smoothed = points.map(p => ({...p}));
    for (let i = windowSize; i < points.length - windowSize; i++) {
      let sum = 0;
      for (let j = i - windowSize; j <= i + windowSize; j++) sum += points[j].pressure || 0.5;
      smoothed[i].pressure = sum / (windowSize * 2 + 1);
    }
    return smoothed;
  }

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
        const nearEdge = Math.abs(p.x - minX) < width * 0.1 || Math.abs(p.x - maxX) < width * 0.1 ||
                          Math.abs(p.y - minY) < height * 0.1 || Math.abs(p.y - maxY) < height * 0.1;
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
          pts.push({ x: shape.centerX + Math.cos(a) * shape.radiusX, y: shape.centerY + Math.sin(a) * shape.radiusY, pressure: 0.7 });
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
        pts.push({ x: shape.end.x - arrowLen * Math.cos(angle - Math.PI / 6), y: shape.end.y - arrowLen * Math.sin(angle - Math.PI / 6), pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        pts.push({ x: shape.end.x - arrowLen * Math.cos(angle + Math.PI / 6), y: shape.end.y - arrowLen * Math.sin(angle + Math.PI / 6), pressure: 0.7 });
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
      const savedTool = currentTool;
      const savedColor = penColor;
      const savedSize = penSize;
      const savedOpacity = penOpacity;
      const savedStyle = penStyle;
      currentTool = stroke.tool;
      penColor = stroke.color;
      penSize = stroke.size;
      penOpacity = stroke.opacity || 1;
      penStyle = stroke.style || 'solid';
      
      if (stroke.points.length === 1) {
        drawStrokeStart(stroke.points[0]);
      } else {
        for (let i = 1; i < stroke.points.length; i++) {
          drawSegment(stroke.points[i-1], stroke.points[i]);
        }
      }
      
      currentTool = savedTool;
      penColor = savedColor;
      penSize = savedSize;
      penOpacity = savedOpacity;
      penStyle = savedStyle;
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
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
    link.download = 'notemax-page.png';
    link.href = merged.toDataURL('image/png');
    link.click();
    if (typeof UI !== 'undefined') UI.showToast('Saved!');
  }

  function getThumbnail(width = 150, height = 200) {
    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = height;
    const tCtx = thumb.getContext('2d');
    tCtx.drawImage(bgCanvas, 0, 0, width, height);
    tCtx.drawImage(drawingCanvas, 0, 0, width, height);
    return thumb.toDataURL('image/png');
  }

  function getStrokes() { return strokes; }
  function loadStrokes(s) { strokes = s || []; redoStack = []; redrawStrokes(); }
  function getBgType() { return bgType; }
  function setBgType(type) {
    bgType = type;
    const sel = document.getElementById('canvasBgSelect');
    if (sel) sel.value = type;
    drawBackground();
  }

  return { init, undo, redo, clearCanvas, exportImage, getStrokes, loadStrokes, drawBackground, getThumbnail, getBgType, setBgType };
})();
