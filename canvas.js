// ===== NoteMax Canvas - Ultimate Writing Experience =====
const Canvas = (() => {
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#ffffff';
  let penSize = 3;
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

  // Multi-touch
  let activeTouches = new Map();
  let gestureStartTime = 0;
  let lastGestureTime = 0;

  // Hold-to-erase
  let scribbleHoldTimer = null;
  let scribbleDetected = false;
  let scribbleHoldPos = null;
  const SCRIBBLE_HOLD_DURATION = 400;

  // Hold-to-shape
  let shapeHoldTimer = null;
  let shapeHoldPosition = null;
  let shapeHoldTriggered = false;
  const SHAPE_HOLD_DURATION = 700;
  const SHAPE_HOLD_MOVEMENT_THRESHOLD = 12;

  // ========== INIT ==========
  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas || !bgCanvas) return;

    ctx = drawingCanvas.getContext('2d', { desynchronized: true, alpha: true });
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

    drawingCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    drawingCanvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    drawingCanvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    setupToolbar();
    setupOutsideClick();
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
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

  // ========== GESTURES ==========
  function handleTouchStart(e) {
    if (!gesturesEnabled) return;
    Array.from(e.touches).forEach(touch => {
      activeTouches.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now()
      });
    });
    if (e.touches.length >= 2) {
      gestureStartTime = Date.now();
      if (isDrawing) {
        isDrawing = false;
        currentStroke = null;
        clearAllTimers();
        redrawStrokes();
      }
      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    if (!gesturesEnabled) return;
    const endTime = Date.now();
    const gestureDuration = endTime - gestureStartTime;
    const timeSinceLastGesture = endTime - lastGestureTime;

    if (gestureDuration < 300 && timeSinceLastGesture > 350) {
      const touchCount = activeTouches.size;
      if (touchCount === 2) {
        lastGestureTime = endTime;
        undo();
        showGestureHint('↶ Undo');
        e.preventDefault();
      } else if (touchCount === 3) {
        lastGestureTime = endTime;
        redo();
        showGestureHint('↷ Redo');
        e.preventDefault();
      }
    }
    Array.from(e.changedTouches).forEach(touch => activeTouches.delete(touch.identifier));
  }

  function showGestureHint(text) {
    const hint = document.getElementById('gestureHint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 500);
  }

  function setupOutsideClick() {
    document.addEventListener('pointerdown', (e) => {
      if (!menuOpen) return;
      const panel = document.getElementById('penSettings');
      const clickedInsidePanel = panel && panel.contains(e.target);
      const clickedPenTool = e.target.closest('.pen-preset');
      if (!clickedInsidePanel && !clickedPenTool) closePenSettings();
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

  // ========== TOOLBAR ==========
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
      });
    });

    document.querySelectorAll('.pen-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.pen-style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penStyle = btn.dataset.style;
      });
    });

    const autoShape = document.getElementById('autoShapeBtn');
    if (autoShape) {
      autoShape.addEventListener('click', (e) => {
        e.stopPropagation();
        shapeRecognitionEnabled = !shapeRecognitionEnabled;
        autoShape.classList.toggle('active', shapeRecognitionEnabled);
        if (typeof UI !== 'undefined') UI.showToast(shapeRecognitionEnabled ? '✨ Auto Shape ON' : 'Auto Shape OFF');
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

    document.getElementById('scribbleEraseToggle')?.addEventListener('change', e => {
      scribbleEraseEnabled = e.target.checked;
      if (typeof UI !== 'undefined') UI.showToast(scribbleEraseEnabled ? '⚡ Scribble+Hold Erase ON' : 'Scribble Erase OFF');
    });

    document.getElementById('shapeRecognitionToggle')?.addEventListener('change', e => {
      shapeRecognitionEnabled = e.target.checked;
      const btn = document.getElementById('autoShapeBtn');
      if (btn) btn.classList.toggle('active', shapeRecognitionEnabled);
    });

    document.getElementById('fingerDrawToggle')?.addEventListener('change', e => {
      fingerDrawEnabled = e.target.checked;
    });

    document.getElementById('beautifyToggle')?.addEventListener('change', e => {
      beautifyEnabled = e.target.checked;
      if (beautifyEnabled) {
        strokes = strokes.map(s => beautifyStroke(s));
        redrawStrokes();
      }
    });

    document.getElementById('gesturesToggle')?.addEventListener('change', e => {
      gesturesEnabled = e.target.checked;
    });

    document.getElementById('undoBtn')?.addEventListener('click', (e) => { e.stopPropagation(); undo(); });
    document.getElementById('redoBtn')?.addEventListener('click', (e) => { e.stopPropagation(); redo(); });

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

  // ========== TIMER MANAGEMENT ==========
  function clearAllTimers() {
    clearShapeHoldTimer();
    clearScribbleHoldTimer();
  }

  function clearShapeHoldTimer() {
    if (shapeHoldTimer) { clearTimeout(shapeHoldTimer); shapeHoldTimer = null; }
    hideHoldIndicator('shape');
  }

  function clearScribbleHoldTimer() {
    if (scribbleHoldTimer) { clearTimeout(scribbleHoldTimer); scribbleHoldTimer = null; }
    hideHoldIndicator('scribble');
    scribbleDetected = false;
    scribbleHoldPos = null;
  }

  // ========== SHAPE HOLD ==========
  function startShapeHoldTimer(pos) {
    clearShapeHoldTimer();
    shapeHoldPosition = { x: pos.x, y: pos.y };
    shapeHoldTriggered = false;
    shapeHoldTimer = setTimeout(() => {
      if (isDrawing && currentStroke && currentTool === 'pen' && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          shapeHoldTriggered = true;
          currentStroke.points = generateShapePoints(shape);
          currentStroke.recognizedShape = shape.type;
          currentStroke.style = 'solid';
          strokes.push(currentStroke);
          redoStack = [];
          currentStroke = null;
          isDrawing = false;
          lastPoint = null;
          redrawStrokes();
          showShapeSnapEffect(shape);
          if (typeof UI !== 'undefined') UI.showToast(`✨ ${shape.type} snapped!`);
          if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
        }
      }
      hideHoldIndicator('shape');
    }, SHAPE_HOLD_DURATION);
    showHoldIndicator(pos, 'shape', SHAPE_HOLD_DURATION);
  }

  // ========== SCRIBBLE HOLD ==========
  function startScribbleHoldTimer(pos) {
    clearScribbleHoldTimer();
    scribbleHoldPos = { x: pos.x, y: pos.y };
    scribbleDetected = true;
    scribbleHoldTimer = setTimeout(() => {
      if (isDrawing && currentStroke && scribbleDetected) {
        eraseScribbledStrokes(currentStroke.points);
        currentStroke = null;
        isDrawing = false;
        redrawStrokes();
        if (typeof UI !== 'undefined') UI.showToast('⚡ Scribble erased!');
        if (navigator.vibrate) navigator.vibrate(30);
      }
      hideHoldIndicator('scribble');
      scribbleDetected = false;
    }, SCRIBBLE_HOLD_DURATION);
    showHoldIndicator(pos, 'scribble', SCRIBBLE_HOLD_DURATION);
  }

  function showHoldIndicator(pos, type, duration) {
    const id = type === 'shape' ? 'shapeHoldIndicator' : 'scribbleHoldIndicator';
    const color = type === 'shape' ? 'var(--accent)' : '#ff453a';
    let indicator = document.getElementById(id);
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = id;
      indicator.style.cssText = `position:absolute;width:44px;height:44px;border:3px solid ${color};border-radius:50%;pointer-events:none;z-index:100;border-top-color:transparent;box-shadow:0 0 16px ${color === 'var(--accent)' ? 'rgba(255,149,0,0.4)' : 'rgba(255,69,58,0.4)'};`;
      document.getElementById('canvasWrap')?.appendChild(indicator);
    }
    if (!document.getElementById('holdIndicatorStyle')) {
      const style = document.createElement('style');
      style.id = 'holdIndicatorStyle';
      style.textContent = `@keyframes hold-spin{0%{transform:translate(-50%,-50%) scale(0.5) rotate(0deg);opacity:0.6}100%{transform:translate(-50%,-50%) scale(1.3) rotate(720deg);opacity:1}}`;
      document.head.appendChild(style);
    }
    indicator.style.left = pos.x + 'px';
    indicator.style.top = pos.y + 'px';
    indicator.style.display = 'block';
    indicator.style.animation = 'none';
    void indicator.offsetWidth;
    indicator.style.animation = `hold-spin ${duration}ms linear`;
  }

  function hideHoldIndicator(type) {
    const id = type === 'shape' ? 'shapeHoldIndicator' : 'scribbleHoldIndicator';
    const indicator = document.getElementById(id);
    if (indicator) indicator.style.display = 'none';
  }

  function showShapeSnapEffect(shape) {
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return;
    const flash = document.createElement('div');
    flash.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:14px 28px;background:rgba(255,149,0,0.95);color:white;font-size:22px;font-weight:800;border-radius:24px;z-index:200;pointer-events:none;animation:shapeFlash 0.9s ease-out forwards;box-shadow:0 8px 32px rgba(255,149,0,0.5);`;
    flash.textContent = `✨ ${shape.type}`;
    wrap.appendChild(flash);
    if (!document.getElementById('shapeFlashStyle')) {
      const style = document.createElement('style');
      style.id = 'shapeFlashStyle';
      style.textContent = `@keyframes shapeFlash{0%{transform:translate(-50%,-50%) scale(0.5);opacity:0}40%{transform:translate(-50%,-50%) scale(1.15);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}`;
      document.head.appendChild(style);
    }
    setTimeout(() => flash.remove(), 900);
  }

  // ========== POINTER EVENTS ==========
  function onPointerDown(e) {
    if (currentTool === 'select' || currentTool === 'lasso') return;
    if (!shouldAcceptInput(e)) return;
    if (e.pointerType === 'touch' && activeTouches.size > 1) return;
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen) closePenSettings();
    try { drawingCanvas.setPointerCapture(e.pointerId); } catch (err) {}

    isDrawing = true;
    const pos = getPos(e);
    lastPoint = pos;
    clearAllTimers();
    shapeHoldTriggered = false;
    shapeHoldPosition = null;
    scribbleDetected = false;
    scribbleHoldPos = null;

    currentStroke = {
      tool: currentTool,
      color: penColor,
      size: penSize,
      opacity: penOpacity,
      style: currentTool === 'pen' ? penStyle : 'solid',
      points: [pos]
    };

    // Full redraw shows the initial dot immediately
    redrawStrokes();
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    if (!shouldAcceptInput(e)) return;
    if (activeTouches.size > 1) return;
    e.preventDefault();
    e.stopPropagation();

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

    for (const evt of events) {
      const pos = getPos(evt);
      if (!currentStroke) return;
      currentStroke.points.push(pos);

      // ===== SCRIBBLE DETECTION =====
      if (scribbleEraseEnabled && currentTool !== 'eraser' && currentTool !== 'highlighter') {
        if (!scribbleDetected && currentStroke.points.length > 25) {
          if (isScribblePattern(currentStroke.points)) {
            startScribbleHoldTimer(pos);
          }
        } else if (scribbleDetected && scribbleHoldPos) {
          const dx = pos.x - scribbleHoldPos.x;
          const dy = pos.y - scribbleHoldPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 30) {
            if (isScribblePattern(currentStroke.points.slice(-20))) {
              startScribbleHoldTimer(pos);
            } else {
              clearScribbleHoldTimer();
            }
          }
        }
      }

      // ===== HOLD-TO-SHAPE =====
      if (!scribbleDetected && currentTool === 'pen' && penStyle === 'solid' &&
        currentStroke.points.length > 8) {
        if (shapeHoldPosition) {
          const dx = pos.x - shapeHoldPosition.x;
          const dy = pos.y - shapeHoldPosition.y;
          if (Math.sqrt(dx * dx + dy * dy) > SHAPE_HOLD_MOVEMENT_THRESHOLD) {
            startShapeHoldTimer(pos);
          }
        } else {
          startShapeHoldTimer(pos);
        }
      }

      if (currentTool === 'eraser') {
        eraseAt(pos.x, pos.y, penSize * 4);
      } else {
        // Always full redraw - guarantees currentStroke is always visible
        redrawStrokes();
      }

      lastPoint = pos;
    }
  }

  function onPointerUp(e) {
    clearAllTimers();
    if (!isDrawing) return;
    isDrawing = false;
    lastPoint = null;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);
    try { if (e && e.pointerId) drawingCanvas.releasePointerCapture(e.pointerId); } catch (err) {}

    if (currentStroke && currentStroke.points.length > 0) {
      // Auto shape recognition
      if (!shapeHoldTriggered && shapeRecognitionEnabled && currentTool === 'pen' && currentStroke.points.length > 8) {
        const shape = detectShape(currentStroke.points);
        if (shape) {
          currentStroke.points = generateShapePoints(shape);
          currentStroke.recognizedShape = shape.type;
          currentStroke.style = 'solid';
          if (typeof UI !== 'undefined') UI.showToast(`✨ ${shape.type}`);
        }
      }

      // Beautify
      if (beautifyEnabled && currentTool === 'pen' && !currentStroke.recognizedShape && currentStroke.style === 'solid') {
        currentStroke = beautifyStroke(currentStroke);
      }

      strokes.push(currentStroke);
      redoStack = [];
    }

    // Null first, then redraw so it's cleanly committed
    currentStroke = null;
    shapeHoldTriggered = false;
    redrawStrokes();
  }

  // ========== REDRAW - Always includes currentStroke ==========
  function redrawStrokes() {
    if (!ctx) return;
    const w = drawingCanvas.width / dpr;
    const h = drawingCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    // All committed strokes
    strokes.forEach(stroke => renderStroke(stroke));

    // Current in-progress stroke - always render so it's never lost
    if (currentStroke && currentStroke.points.length > 0) {
      renderStroke(currentStroke);
    }
  }

  // ========== STROKE RENDERING ==========
  function renderStroke(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 1) return;

    const isHighlighter = stroke.tool === 'highlighter';
    ctx.globalAlpha = isHighlighter ? 0.3 : (stroke.opacity || 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    // Single dot
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    const style = stroke.style || 'solid';
    switch (style) {
      case 'solid':  renderSolid(stroke);  break;
      case 'dashed': renderDashed(stroke); break;
      case 'dotted': renderDotted(stroke); break;
      case 'double': renderDouble(stroke); break;
      case 'curly':  renderWavy(stroke);   break;
      case 'zigzag': renderZigzag(stroke); break;
      default:       renderSolid(stroke);
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  function renderSolid(stroke) {
    const pts = stroke.points;
    const isHighlighter = stroke.tool === 'highlighter';
    if (pts.length < 2) return;

    if (stroke.tool === 'pen' && !isHighlighter) {
      // Pressure-sensitive smooth rendering
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const width = stroke.size * (0.6 + (p1.pressure || 0.5) * 0.6);
        ctx.lineWidth = width;

        if (i === 1) {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          if (pts.length > 2) {
            const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            ctx.lineTo(m.x, m.y);
          } else {
            ctx.lineTo(p1.x, p1.y);
          }
          ctx.stroke();
        } else if (i < pts.length - 1) {
          const pPrev = pts[i - 2];
          const m1 = { x: (pPrev.x + p0.x) / 2, y: (pPrev.y + p0.y) / 2 };
          const m2 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          ctx.beginPath();
          ctx.moveTo(m1.x, m1.y);
          ctx.quadraticCurveTo(p0.x, p0.y, m2.x, m2.y);
          ctx.stroke();
        } else {
          const pPrev = pts[i - 2];
          const m1 = { x: (pPrev.x + p0.x) / 2, y: (pPrev.y + p0.y) / 2 };
          ctx.beginPath();
          ctx.moveTo(m1.x, m1.y);
          ctx.quadraticCurveTo(p0.x, p0.y, p1.x, p1.y);
          ctx.stroke();
        }
      }
    } else {
      // Highlighter / other - simple smooth curve
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
  }

  function renderDashed(stroke) {
    const pts = stroke.points;
    ctx.lineWidth = stroke.size;
    ctx.setLineDash([stroke.size * 3, stroke.size * 2]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function renderDotted(stroke) {
    const pts = stroke.points;
    const spacing = stroke.size * 2.5;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    let lastX = pts[0].x, lastY = pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - lastX;
      const dy = pts[i].y - lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= spacing) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        lastX = pts[i].x;
        lastY = pts[i].y;
      }
    }
  }

  function renderDouble(stroke) {
    const pts = stroke.points;
    const offset = stroke.size * 0.9;
    ctx.lineWidth = Math.max(1, stroke.size / 3);
    const upper = [], lower = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let angle;
      if (i === 0) angle = Math.atan2(pts[1].y - p.y, pts[1].x - p.x);
      else if (i === pts.length - 1) angle = Math.atan2(p.y - pts[i - 1].y, p.x - pts[i - 1].x);
      else angle = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x);
      const px = Math.cos(angle + Math.PI / 2) * offset;
      const py = Math.sin(angle + Math.PI / 2) * offset;
      upper.push({ x: p.x + px, y: p.y + py });
      lower.push({ x: p.x - px, y: p.y - py });
    }
    [upper, lower].forEach(path => {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length - 1; i++) {
        const mx = (path[i].x + path[i + 1].x) / 2;
        const my = (path[i].y + path[i + 1].y) / 2;
        ctx.quadraticCurveTo(path[i].x, path[i].y, mx, my);
      }
      ctx.lineTo(path[path.length - 1].x, path[path.length - 1].y);
      ctx.stroke();
    });
  }

  function renderWavy(stroke) {
    const pts = stroke.points;
    const amplitude = stroke.size * 1.8;
    const frequency = stroke.size * 3.5;
    ctx.lineWidth = stroke.size;
    const cumDist = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalDist = cumDist[cumDist.length - 1];
    if (totalDist < 5) return;
    const numSteps = Math.max(30, Math.floor(totalDist / 2));
    ctx.beginPath();
    for (let step = 0; step <= numSteps; step++) {
      const targetDist = (step / numSteps) * totalDist;
      let segIdx = 1;
      while (segIdx < cumDist.length && cumDist[segIdx] < targetDist) segIdx++;
      if (segIdx >= pts.length) segIdx = pts.length - 1;
      const p1 = pts[segIdx - 1];
      const p2 = pts[segIdx];
      const segLen = cumDist[segIdx] - cumDist[segIdx - 1];
      const localT = segLen > 0 ? (targetDist - cumDist[segIdx - 1]) / segLen : 0;
      const x = p1.x + (p2.x - p1.x) * localT;
      const y = p1.y + (p2.y - p1.y) * localT;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const waveOffset = Math.sin((targetDist / frequency) * Math.PI * 2) * amplitude;
      const wx = x + Math.cos(angle + Math.PI / 2) * waveOffset;
      const wy = y + Math.sin(angle + Math.PI / 2) * waveOffset;
      if (step === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();
  }

  function renderZigzag(stroke) {
    const pts = stroke.points;
    const amplitude = stroke.size * 1.5;
    const spacing = stroke.size * 1.8;
    ctx.lineWidth = stroke.size;
    const cumDist = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalDist = cumDist[cumDist.length - 1];
    if (totalDist < 5) return;
    const numPeaks = Math.max(3, Math.floor(totalDist / spacing));
    ctx.beginPath();
    for (let step = 0; step <= numPeaks; step++) {
      const targetDist = (step / numPeaks) * totalDist;
      let segIdx = 1;
      while (segIdx < cumDist.length && cumDist[segIdx] < targetDist) segIdx++;
      if (segIdx >= pts.length) segIdx = pts.length - 1;
      const p1 = pts[segIdx - 1];
      const p2 = pts[segIdx];
      const segLen = cumDist[segIdx] - cumDist[segIdx - 1];
      const localT = segLen > 0 ? (targetDist - cumDist[segIdx - 1]) / segLen : 0;
      const x = p1.x + (p2.x - p1.x) * localT;
      const y = p1.y + (p2.y - p1.y) * localT;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const zigOffset = (step % 2 === 0 ? 1 : -1) * amplitude;
      const zx = x + Math.cos(angle + Math.PI / 2) * zigOffset;
      const zy = y + Math.sin(angle + Math.PI / 2) * zigOffset;
      if (step === 0) ctx.moveTo(zx, zy);
      else ctx.lineTo(zx, zy);
    }
    ctx.stroke();
  }

  // ========== SCRIBBLE DETECTION ==========
  function isScribblePattern(points) {
    if (points.length < 20) return false;
    const recent = points.slice(-Math.min(30, points.length));
    let directionChanges = 0;
    let lastDx = 0, lastDy = 0;
    let significantChanges = 0;

    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i - 1].x;
      const dy = recent[i].y - recent[i - 1].y;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (i > 1 && mag > 1) {
        const dotProduct = dx * lastDx + dy * lastDy;
        const magPrev = Math.sqrt(lastDx * lastDx + lastDy * lastDy);
        if (dotProduct < 0) directionChanges++;
        if (magPrev > 0) {
          const cosAngle = dotProduct / (mag * magPrev);
          if (cosAngle < -0.3) significantChanges++;
        }
      }
      lastDx = dx;
      lastDy = dy;
    }

    const xs = recent.map(p => p.x);
    const ys = recent.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    let pathLength = 0;
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i - 1].x;
      const dy = recent[i].y - recent[i - 1].y;
      pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    const boxDiagonal = Math.sqrt(width * width + height * height);
    if (boxDiagonal < 20) return false;
    const compactness = pathLength / boxDiagonal;
    return significantChanges >= 4 && compactness > 3 && directionChanges >= 5;
  }

  function eraseScribbledStrokes(scribblePoints) {
    const xs = scribblePoints.map(p => p.x);
    const ys = scribblePoints.map(p => p.y);
    const minX = Math.min(...xs) - 20;
    const maxX = Math.max(...xs) + 20;
    const minY = Math.min(...ys) - 20;
    const maxY = Math.max(...ys) + 20;
    strokes = strokes.filter(stroke =>
      !stroke.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
    );
  }

  // ========== BEAUTIFY ==========
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
    const smoothed = points.map(p => ({ ...p }));
    for (let i = windowSize; i < points.length - windowSize; i++) {
      let sum = 0;
      for (let j = i - windowSize; j <= i + windowSize; j++) sum += points[j].pressure || 0.5;
      smoothed[i].pressure = sum / (windowSize * 2 + 1);
    }
    return smoothed;
  }

  // ========== SHAPE RECOGNITION ==========
  function detectShape(points) {
    if (points.length < 8) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX, height = maxY - minY;

    if (width < 25 || height < 25) {
      if (isStraightLine(points)) return { type: 'Line', start: points[0], end: points[points.length - 1] };
      return null;
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const first = points[0];
    const last = points[points.length - 1];
    const closeDistance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    const maxDim = Math.max(width, height);
    const isClosed = closeDistance < maxDim * 0.35;

    if (isStraightLine(points)) return { type: 'Line', start: first, end: last };

    if (!isClosed && points.length > 15 && calculateStraightness(points) > 0.82) {
      return { type: 'Arrow', start: first, end: last };
    }

    if (isClosed) {
      const aspectRatio = width / height;
      const distances = points.map(p =>
        Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2))
      );
      const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDist, 2), 0) / distances.length;
      const cv = Math.sqrt(variance) / avgDist;

      if (cv < 0.18) {
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.18 ? 'Circle' : 'Ellipse',
          centerX, centerY, radiusX: width / 2, radiusY: height / 2
        };
      }

      const corners = countCorners(points);
      if (corners === 3) return { type: 'Triangle', vertices: findTriangleVertices(points) };

      if (corners === 4) {
        let rectScore = 0;
        points.forEach(p => {
          const nearEdge =
            Math.abs(p.x - minX) < width * 0.12 ||
            Math.abs(p.x - maxX) < width * 0.12 ||
            Math.abs(p.y - minY) < height * 0.12 ||
            Math.abs(p.y - maxY) < height * 0.12;
          if (nearEdge) rectScore++;
        });
        if (rectScore / points.length > 0.5) {
          return {
            type: aspectRatio > 0.85 && aspectRatio < 1.18 ? 'Square' : 'Rectangle',
            minX, minY, maxX, maxY
          };
        }
      }

      if (corners === 5) return { type: 'Pentagon', vertices: findPolygonVertices(points, 5) };
      if (corners === 6) return { type: 'Hexagon', vertices: findPolygonVertices(points, 6) };

      if (corners >= 8 && corners <= 12) {
        const starInfo = detectStar(points, centerX, centerY);
        if (starInfo) return starInfo;
      }

      if (cv < 0.28) {
        return {
          type: aspectRatio > 0.85 && aspectRatio < 1.18 ? 'Circle' : 'Ellipse',
          centerX, centerY, radiusX: width / 2, radiusY: height / 2
        };
      }
    }
    return null;
  }

  function detectStar(points, cx, cy) {
    const distances = points.map(p => Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2)));
    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
    let peaks = 0;
    for (let i = 2; i < distances.length - 2; i++) {
      if (distances[i] > avg * 1.15 && distances[i] > distances[i - 2] && distances[i] > distances[i + 2]) peaks++;
    }
    if (peaks >= 4 && peaks <= 6) {
      return {
        type: 'Star', centerX: cx, centerY: cy,
        outerRadius: Math.max(...distances),
        innerRadius: Math.min(...distances),
        points: peaks
      };
    }
    return null;
  }

  function findTriangleVertices(points) {
    const ys = points.map(p => p.y);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    let top = points[0], bottomLeft = points[0], bottomRight = points[0];
    points.forEach(p => {
      if (p.y < top.y) top = p;
      if (p.y > minY + (maxY - minY) * 0.7) {
        if (p.x < bottomLeft.x) bottomLeft = p;
        if (p.x > bottomRight.x) bottomRight = p;
      }
    });
    return [top, bottomRight, bottomLeft];
  }

  function findPolygonVertices(points, n) {
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const maxR = Math.max(...points.map(p => Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2))));
    const vertices = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      vertices.push({ x: cx + Math.cos(angle) * maxR, y: cy + Math.sin(angle) * maxR });
    }
    return vertices;
  }

  function isStraightLine(points) {
    if (points.length < 3) return false;
    return calculateStraightness(points) > 0.96;
  }

  function calculateStraightness(points) {
    const first = points[0], last = points[points.length - 1];
    const totalDist = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));
    let pathLen = 0;
    for (let i = 1; i < points.length; i++) {
      pathLen += Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2));
    }
    return pathLen > 0 ? totalDist / pathLen : 0;
  }

  function countCorners(points) {
    const simplified = simplifyPoints(points, 3);
    let corners = 0;
    for (let i = 2; i < simplified.length - 2; i++) {
      const p1 = simplified[i - 2];
      const p2 = simplified[i];
      const p3 = simplified[i + 2];
      const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
      let diff = Math.abs(angle2 - angle1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > Math.PI / 4) corners++;
    }
    if (corners <= 3) return 3;
    if (corners <= 4) return 4;
    if (corners <= 5) return 5;
    if (corners <= 6) return 6;
    return corners;
  }

  function generateShapePoints(shape) {
    const pts = [];
    switch (shape.type) {
      case 'Circle':
      case 'Ellipse':
        for (let i = 0; i <= 80; i++) {
          const a = (i / 80) * Math.PI * 2;
          pts.push({ x: shape.centerX + Math.cos(a) * shape.radiusX, y: shape.centerY + Math.sin(a) * shape.radiusY, pressure: 0.7 });
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
      case 'Triangle':
        shape.vertices.forEach(v => pts.push({ x: v.x, y: v.y, pressure: 0.7 }));
        pts.push({ x: shape.vertices[0].x, y: shape.vertices[0].y, pressure: 0.7 });
        break;
      case 'Pentagon':
      case 'Hexagon':
        shape.vertices.forEach(v => pts.push({ x: v.x, y: v.y, pressure: 0.7 }));
        pts.push({ x: shape.vertices[0].x, y: shape.vertices[0].y, pressure: 0.7 });
        break;
      case 'Star': {
        const numPoints = shape.points || 5;
        for (let i = 0; i <= numPoints * 2; i++) {
          const angle = (i / (numPoints * 2)) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
          pts.push({ x: shape.centerX + Math.cos(angle) * r, y: shape.centerY + Math.sin(angle) * r, pressure: 0.7 });
        }
        break;
      }
      case 'Line':
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        break;
      case 'Arrow': {
        pts.push({ x: shape.start.x, y: shape.start.y, pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        const arrowLen = 20;
        const arrowAngle = Math.PI / 6;
        pts.push({ x: shape.end.x - arrowLen * Math.cos(angle - arrowAngle), y: shape.end.y - arrowLen * Math.sin(angle - arrowAngle), pressure: 0.7 });
        pts.push({ x: shape.end.x, y: shape.end.y, pressure: 0.7 });
        pts.push({ x: shape.end.x - arrowLen * Math.cos(angle + arrowAngle), y: shape.end.y - arrowLen * Math.sin(angle + arrowAngle), pressure: 0.7 });
        break;
      }
      default: return [];
    }
    return pts;
  }

  // ========== ERASER ==========
  function eraseAt(x, y, radius) {
    let hit = false;
    strokes = strokes.filter(stroke => {
      const hits = stroke.points.some(p =>
        Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2)) < radius
      );
      if (hits) hit = true;
      return !hits;
    });
    if (hit) redrawStrokes();
  }

  // ========== UNDO / REDO ==========
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
        bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke();
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

  // ========== EXPORT ==========
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

  // ========== PUBLIC API ==========
  function getStrokes() { return strokes; }
  function loadStrokes(s) { strokes = s || []; redoStack = []; redrawStrokes(); }
  function getBgType() { return bgType; }
  function setBgType(type) {
    bgType = type;
    const sel = document.getElementById('canvasBgSelect');
    if (sel) sel.value = type;
    drawBackground();
  }

  return {
    init,
    undo,
    redo,
    clearCanvas,
    exportImage,
    getStrokes,
    loadStrokes,
    drawBackground,
    getThumbnail,
    getBgType,
    setBgType
  };
})();
