// ===== NoteMax Canvas - Apple Notes Style Writing =====
const Canvas = (() => {
  // Core state
  let drawingCanvas, bgCanvas, ctx, bgCtx;
  let dpr = 1;
  let canvasWidth = 0;
  let canvasHeight = 0;

  // Drawing state
  let isDrawing = false;
  let currentTool = 'pen';
  let penColor = '#ffffff';
  let penSize = 3;
  let penOpacity = 1;
  let penStyle = 'solid';

  // Stroke storage
  let strokes = [];
  let redoStack = [];
  let currentPoints = [];
  let currentPressures = [];

  // Background
  let bgType = 'dark';

  // Settings
  let fingerDrawEnabled = false;
  let beautifyEnabled = false;
  let shapeRecognitionEnabled = false;
  let scribbleEraseEnabled = true;
  let gesturesEnabled = true;
  let menuOpen = false;

  // Gesture tracking
  let activeTouchCount = 0;
  let gestureStartTime = 0;
  let lastGestureTime = 0;

  // Animation frame for smooth rendering
  let needsRender = false;
  let rafId = null;

  // ==========================================
  // INIT
  // ==========================================
  function init() {
    drawingCanvas = document.getElementById('drawingCanvas');
    bgCanvas = document.getElementById('bgCanvas');
    if (!drawingCanvas || !bgCanvas) return;

    ctx = drawingCanvas.getContext('2d');
    bgCtx = bgCanvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 300));

    // Pointer events for drawing
    drawingCanvas.addEventListener('pointerdown', pointerDown, { passive: false });
    drawingCanvas.addEventListener('pointermove', pointerMove, { passive: false });
    drawingCanvas.addEventListener('pointerup', pointerUp, { passive: false });
    drawingCanvas.addEventListener('pointercancel', pointerUp, { passive: false });
    drawingCanvas.addEventListener('pointerleave', pointerUp, { passive: false });

    // Touch events for gestures only
    drawingCanvas.addEventListener('touchstart', touchStart, { passive: false });
    drawingCanvas.addEventListener('touchend', touchEnd, { passive: false });
    drawingCanvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // Prevent context menu
    drawingCanvas.addEventListener('contextmenu', e => e.preventDefault());

    setupUI();
    startRenderLoop();
  }

  // ==========================================
  // CANVAS SIZING
  // ==========================================
  function resize() {
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    dpr = window.devicePixelRatio || 1;
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    [drawingCanvas, bgCanvas].forEach(c => {
      c.width = canvasWidth * dpr;
      c.height = canvasHeight * dpr;
      c.style.width = canvasWidth + 'px';
      c.style.height = canvasHeight + 'px';
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    paintBackground();
    fullRedraw();
  }

  // ==========================================
  // RENDER LOOP (requestAnimationFrame)
  // ==========================================
  function startRenderLoop() {
    function loop() {
      if (needsRender) {
        needsRender = false;
        fullRedraw();
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function requestRender() {
    needsRender = true;
  }

  // ==========================================
  // COORDINATE HELPERS
  // ==========================================
  function getXY(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure != null ? e.pressure : 0.5
    };
  }

  function acceptsInput(e) {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') return true;
    if (e.pointerType === 'touch') return fingerDrawEnabled;
    return true;
  }

  // ==========================================
  // POINTER HANDLERS
  // ==========================================
  function pointerDown(e) {
    if (currentTool === 'select' || currentTool === 'lasso') return;
    if (!acceptsInput(e)) return;
    if (activeTouchCount > 1) return;

    e.preventDefault();
    try { drawingCanvas.setPointerCapture(e.pointerId); } catch (_) {}

    if (menuOpen) closePenSettings();

    const pt = getXY(e);
    isDrawing = true;
    currentPoints = [pt.x, pt.y];
    currentPressures = [pt.pressure];

    // Draw initial dot immediately on screen
    if (currentTool !== 'eraser') {
      drawDot(pt.x, pt.y, pt.pressure);
    }
  }

  function pointerMove(e) {
    if (!isDrawing) return;
    if (!acceptsInput(e)) return;
    if (activeTouchCount > 1) {
      cancelStroke(e);
      return;
    }

    e.preventDefault();

    // Use coalesced events for smoothness
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const evt of evts) {
      const pt = getXY(evt);
      const len = currentPoints.length;
      const prevX = currentPoints[len - 2];
      const prevY = currentPoints[len - 1];

      // Skip if barely moved
      const dx = pt.x - prevX;
      const dy = pt.y - prevY;
      if (dx * dx + dy * dy < 1) continue;

      currentPoints.push(pt.x, pt.y);
      currentPressures.push(pt.pressure);

      if (currentTool === 'eraser') {
        eraseAtPoint(pt.x, pt.y, penSize * 4);
      } else {
        // Draw latest segment immediately for zero-lag feel
        drawLatestSegment();
      }
    }
  }

  function pointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;

    try { if (e && e.pointerId != null) drawingCanvas.releasePointerCapture(e.pointerId); } catch (_) {}

    if (currentPoints.length >= 2 && currentTool !== 'eraser') {
      // Build stroke object
      let stroke = buildStroke();

      // Auto shape recognition on lift
      if (shapeRecognitionEnabled && currentTool === 'pen' && pointCount(stroke) > 8) {
        const shape = detectShape(stroke);
        if (shape) {
          stroke = shapeToStroke(shape, stroke);
          toast(`✨ ${shape.type}`);
        }
      }

      // Beautify
      if (beautifyEnabled && currentTool === 'pen' && !stroke.shape) {
        stroke = beautify(stroke);
      }

      // Scribble erase check
      if (scribbleEraseEnabled && currentTool === 'pen' && pointCount(stroke) > 25) {
        if (isScribble(stroke)) {
          eraseUnderScribble(stroke);
          currentPoints = [];
          currentPressures = [];
          requestRender();
          return;
        }
      }

      strokes.push(stroke);
      redoStack = [];
    }

    currentPoints = [];
    currentPressures = [];
    requestRender();
  }

  function cancelStroke(e) {
    isDrawing = false;
    currentPoints = [];
    currentPressures = [];
    try { if (e && e.pointerId != null) drawingCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    requestRender();
  }

  // ==========================================
  // BUILD STROKE FROM FLAT ARRAYS
  // ==========================================
  function buildStroke() {
    return {
      tool: currentTool,
      color: penColor,
      size: penSize,
      opacity: penOpacity,
      style: currentTool === 'pen' ? penStyle : 'solid',
      xs: Float32Array.from(currentPoints.filter((_, i) => i % 2 === 0)),
      ys: Float32Array.from(currentPoints.filter((_, i) => i % 2 === 1)),
      ps: Float32Array.from(currentPressures)
    };
  }

  function pointCount(stroke) {
    return stroke.xs ? stroke.xs.length : 0;
  }

  // ==========================================
  // IMMEDIATE DRAWING (zero lag)
  // ==========================================
  function drawDot(x, y, pressure) {
    const isHL = currentTool === 'highlighter';
    ctx.save();
    ctx.globalAlpha = isHL ? 0.3 : penOpacity;
    ctx.fillStyle = penColor;
    ctx.beginPath();
    const r = isHL ? penSize / 2 : penSize * (0.5 + pressure * 0.4);
    ctx.arc(x, y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLatestSegment() {
    const len = currentPoints.length / 2;
    if (len < 2) return;

    const isHL = currentTool === 'highlighter';

    ctx.save();
    ctx.globalAlpha = isHL ? 0.3 : penOpacity;
    ctx.strokeStyle = penColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (len === 2) {
      // Only 2 points - draw simple line
      const x0 = currentPoints[0], y0 = currentPoints[1];
      const x1 = currentPoints[2], y1 = currentPoints[3];
      const p = currentPressures[1] || 0.5;
      ctx.lineWidth = isHL ? penSize : penSize * (0.5 + p * 0.5);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (len === 3) {
      // 3 points - quadratic from start to midpoint
      const i = (len - 3) * 2;
      const x0 = currentPoints[i], y0 = currentPoints[i + 1];
      const x1 = currentPoints[i + 2], y1 = currentPoints[i + 3];
      const x2 = currentPoints[i + 4], y2 = currentPoints[i + 5];
      const p = currentPressures[len - 1] || 0.5;
      ctx.lineWidth = isHL ? penSize : penSize * (0.5 + p * 0.5);

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x1, y1, mx, my);
      ctx.stroke();
    } else {
      // 4+ points - draw last smooth segment
      const i = (len - 3) * 2;
      const ax = currentPoints[i], ay = currentPoints[i + 1];
      const bx = currentPoints[i + 2], by = currentPoints[i + 3];
      const cx = currentPoints[i + 4], cy = currentPoints[i + 5];

      const p = currentPressures[len - 1] || 0.5;
      ctx.lineWidth = isHL ? penSize : penSize * (0.5 + p * 0.5);

      const m1x = (ax + bx) / 2, m1y = (ay + by) / 2;
      const m2x = (bx + cx) / 2, m2y = (by + cy) / 2;

      ctx.beginPath();
      ctx.moveTo(m1x, m1y);
      ctx.quadraticCurveTo(bx, by, m2x, m2y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ==========================================
  // FULL REDRAW
  // ==========================================
  function fullRedraw() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw all saved strokes
    for (let i = 0; i < strokes.length; i++) {
      paintStroke(strokes[i]);
    }

    // Draw current in-progress stroke
    if (currentPoints.length >= 4) {
      paintCurrentStroke();
    } else if (currentPoints.length === 2) {
      const isHL = currentTool === 'highlighter';
      ctx.save();
      ctx.globalAlpha = isHL ? 0.3 : penOpacity;
      ctx.fillStyle = penColor;
      ctx.beginPath();
      const r = penSize * (0.5 + (currentPressures[0] || 0.5) * 0.4);
      ctx.arc(currentPoints[0], currentPoints[1], Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ==========================================
  // PAINT SAVED STROKE
  // ==========================================
  function paintStroke(s) {
    if (!s.xs || s.xs.length < 1) return;
    const n = s.xs.length;
    const isHL = s.tool === 'highlighter';

    ctx.save();
    ctx.globalAlpha = isHL ? 0.3 : (s.opacity || 1);
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Single dot
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(s.xs[0], s.ys[0], s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const style = s.style || 'solid';
    switch (style) {
      case 'dashed':
        paintDashed(s);
        break;
      case 'dotted':
        paintDotted(s);
        break;
      case 'double':
        paintDouble(s);
        break;
      case 'curly':
        paintWavy(s);
        break;
      case 'zigzag':
        paintZigzag(s);
        break;
      default:
        paintSolid(s);
        break;
    }

    ctx.restore();
  }

  function paintSolid(s) {
    const n = s.xs.length;
    const isHL = s.tool === 'highlighter';

    if (isHL) {
      // Highlighter: uniform width, single path
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.xs[0], s.ys[0]);
      for (let i = 1; i < n - 1; i++) {
        const mx = (s.xs[i] + s.xs[i + 1]) / 2;
        const my = (s.ys[i] + s.ys[i + 1]) / 2;
        ctx.quadraticCurveTo(s.xs[i], s.ys[i], mx, my);
      }
      ctx.lineTo(s.xs[n - 1], s.ys[n - 1]);
      ctx.stroke();
    } else {
      // Pen: pressure-sensitive, segment by segment
      for (let i = 1; i < n; i++) {
        const p = s.ps ? (s.ps[i] || 0.5) : 0.5;
        ctx.lineWidth = s.size * (0.5 + p * 0.5);

        if (n === 2) {
          ctx.beginPath();
          ctx.moveTo(s.xs[0], s.ys[0]);
          ctx.lineTo(s.xs[1], s.ys[1]);
          ctx.stroke();
          break;
        }

        if (i === 1) {
          const mx = (s.xs[0] + s.xs[1]) / 2;
          const my = (s.ys[0] + s.ys[1]) / 2;
          ctx.beginPath();
          ctx.moveTo(s.xs[0], s.ys[0]);
          ctx.lineTo(mx, my);
          ctx.stroke();
        } else if (i < n - 1) {
          const ax = s.xs[i - 2], ay = s.ys[i - 2];
          const bx = s.xs[i - 1], by = s.ys[i - 1];
          const cx = s.xs[i], cy = s.ys[i];
          const m1x = (ax + bx) / 2, m1y = (ay + by) / 2;
          const m2x = (bx + cx) / 2, m2y = (by + cy) / 2;
          ctx.beginPath();
          ctx.moveTo(m1x, m1y);
          ctx.quadraticCurveTo(bx, by, m2x, m2y);
          ctx.stroke();
        } else {
          const ax = s.xs[i - 2], ay = s.ys[i - 2];
          const bx = s.xs[i - 1], by = s.ys[i - 1];
          const cx = s.xs[i], cy = s.ys[i];
          const m1x = (ax + bx) / 2, m1y = (ay + by) / 2;
          ctx.beginPath();
          ctx.moveTo(m1x, m1y);
          ctx.quadraticCurveTo(bx, by, cx, cy);
          ctx.stroke();
        }
      }
    }
  }

  function paintDashed(s) {
    const n = s.xs.length;
    ctx.lineWidth = s.size;
    ctx.setLineDash([s.size * 3, s.size * 2]);
    ctx.beginPath();
    ctx.moveTo(s.xs[0], s.ys[0]);
    for (let i = 1; i < n - 1; i++) {
      const mx = (s.xs[i] + s.xs[i + 1]) / 2;
      const my = (s.ys[i] + s.ys[i + 1]) / 2;
      ctx.quadraticCurveTo(s.xs[i], s.ys[i], mx, my);
    }
    ctx.lineTo(s.xs[n - 1], s.ys[n - 1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function paintDotted(s) {
    const n = s.xs.length;
    const spacing = s.size * 2.5;
    ctx.beginPath();
    ctx.arc(s.xs[0], s.ys[0], s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    let lx = s.xs[0], ly = s.ys[0];
    for (let i = 1; i < n; i++) {
      const dx = s.xs[i] - lx, dy = s.ys[i] - ly;
      if (dx * dx + dy * dy >= spacing * spacing) {
        ctx.beginPath();
        ctx.arc(s.xs[i], s.ys[i], s.size / 2, 0, Math.PI * 2);
        ctx.fill();
        lx = s.xs[i]; ly = s.ys[i];
      }
    }
  }

  function paintDouble(s) {
    const n = s.xs.length;
    if (n < 2) return;
    const off = s.size * 0.9;
    ctx.lineWidth = Math.max(1, s.size / 3);

    const u1 = [], u2 = [], l1 = [], l2 = [];
    for (let i = 0; i < n; i++) {
      let angle;
      if (i === 0) angle = Math.atan2(s.ys[1] - s.ys[0], s.xs[1] - s.xs[0]);
      else if (i === n - 1) angle = Math.atan2(s.ys[n - 1] - s.ys[n - 2], s.xs[n - 1] - s.xs[n - 2]);
      else angle = Math.atan2(s.ys[i + 1] - s.ys[i - 1], s.xs[i + 1] - s.xs[i - 1]);
      const nx = Math.cos(angle + Math.PI / 2) * off;
      const ny = Math.sin(angle + Math.PI / 2) * off;
      u1.push(s.xs[i] + nx); u2.push(s.ys[i] + ny);
      l1.push(s.xs[i] - nx); l2.push(s.ys[i] - ny);
    }

    [{ x: u1, y: u2 }, { x: l1, y: l2 }].forEach(p => {
      ctx.beginPath();
      ctx.moveTo(p.x[0], p.y[0]);
      for (let i = 1; i < n - 1; i++) {
        const mx = (p.x[i] + p.x[i + 1]) / 2;
        const my = (p.y[i] + p.y[i + 1]) / 2;
        ctx.quadraticCurveTo(p.x[i], p.y[i], mx, my);
      }
      ctx.lineTo(p.x[n - 1], p.y[n - 1]);
      ctx.stroke();
    });
  }

  function paintWavy(s) {
    const n = s.xs.length;
    if (n < 2) return;
    const amp = s.size * 1.8;
    const freq = s.size * 3.5;
    ctx.lineWidth = s.size;

    const cd = [0];
    for (let i = 1; i < n; i++) {
      const dx = s.xs[i] - s.xs[i - 1], dy = s.ys[i] - s.ys[i - 1];
      cd.push(cd[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cd[n - 1];
    if (total < 5) return;

    const steps = Math.max(30, Math.floor(total / 2));
    ctx.beginPath();
    for (let st = 0; st <= steps; st++) {
      const td = (st / steps) * total;
      let si = 1;
      while (si < n && cd[si] < td) si++;
      if (si >= n) si = n - 1;
      const sl = cd[si] - cd[si - 1];
      const t = sl > 0 ? (td - cd[si - 1]) / sl : 0;
      const x = s.xs[si - 1] + (s.xs[si] - s.xs[si - 1]) * t;
      const y = s.ys[si - 1] + (s.ys[si] - s.ys[si - 1]) * t;
      const a = Math.atan2(s.ys[si] - s.ys[si - 1], s.xs[si] - s.xs[si - 1]);
      const w = Math.sin((td / freq) * Math.PI * 2) * amp;
      const wx = x + Math.cos(a + Math.PI / 2) * w;
      const wy = y + Math.sin(a + Math.PI / 2) * w;
      st === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
    }
    ctx.stroke();
  }

  function paintZigzag(s) {
    const n = s.xs.length;
    if (n < 2) return;
    const amp = s.size * 1.5;
    const sp = s.size * 1.8;
    ctx.lineWidth = s.size;

    const cd = [0];
    for (let i = 1; i < n; i++) {
      const dx = s.xs[i] - s.xs[i - 1], dy = s.ys[i] - s.ys[i - 1];
      cd.push(cd[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cd[n - 1];
    if (total < 5) return;

    const peaks = Math.max(3, Math.floor(total / sp));
    ctx.beginPath();
    for (let st = 0; st <= peaks; st++) {
      const td = (st / peaks) * total;
      let si = 1;
      while (si < n && cd[si] < td) si++;
      if (si >= n) si = n - 1;
      const sl = cd[si] - cd[si - 1];
      const t = sl > 0 ? (td - cd[si - 1]) / sl : 0;
      const x = s.xs[si - 1] + (s.xs[si] - s.xs[si - 1]) * t;
      const y = s.ys[si - 1] + (s.ys[si] - s.ys[si - 1]) * t;
      const a = Math.atan2(s.ys[si] - s.ys[si - 1], s.xs[si] - s.xs[si - 1]);
      const zo = (st % 2 === 0 ? 1 : -1) * amp;
      const zx = x + Math.cos(a + Math.PI / 2) * zo;
      const zy = y + Math.sin(a + Math.PI / 2) * zo;
      st === 0 ? ctx.moveTo(zx, zy) : ctx.lineTo(zx, zy);
    }
    ctx.stroke();
  }

  // ==========================================
  // PAINT CURRENT (in-progress) STROKE
  // ==========================================
  function paintCurrentStroke() {
    if (currentTool === 'eraser') return;
    const n = currentPoints.length / 2;
    if (n < 2) return;

    const isHL = currentTool === 'highlighter';

    ctx.save();
    ctx.globalAlpha = isHL ? 0.3 : penOpacity;
    ctx.strokeStyle = penColor;
    ctx.fillStyle = penColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const style = currentTool === 'pen' ? penStyle : 'solid';

    if (style !== 'solid') {
      // For non-solid styles, build temp stroke and paint
      const tmp = buildStroke();
      ctx.restore();
      paintStroke(tmp);
      return;
    }

    // Solid - smooth pressure-sensitive drawing
    if (isHL) {
      ctx.lineWidth = penSize;
      ctx.beginPath();
      ctx.moveTo(currentPoints[0], currentPoints[1]);
      for (let i = 1; i < n - 1; i++) {
        const x1 = currentPoints[i * 2], y1 = currentPoints[i * 2 + 1];
        const x2 = currentPoints[(i + 1) * 2], y2 = currentPoints[(i + 1) * 2 + 1];
        ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
      }
      ctx.lineTo(currentPoints[(n - 1) * 2], currentPoints[(n - 1) * 2 + 1]);
      ctx.stroke();
    } else {
      // Pressure-sensitive segments
      for (let i = 1; i < n; i++) {
        const p = currentPressures[i] || 0.5;
        ctx.lineWidth = penSize * (0.5 + p * 0.5);

        if (n === 2) {
          ctx.beginPath();
          ctx.moveTo(currentPoints[0], currentPoints[1]);
          ctx.lineTo(currentPoints[2], currentPoints[3]);
          ctx.stroke();
          break;
        }

        const idx = i * 2;
        if (i === 1) {
          const mx = (currentPoints[0] + currentPoints[2]) / 2;
          const my = (currentPoints[1] + currentPoints[3]) / 2;
          ctx.beginPath();
          ctx.moveTo(currentPoints[0], currentPoints[1]);
          ctx.lineTo(mx, my);
          ctx.stroke();
        } else if (i < n - 1) {
          const ax = currentPoints[idx - 4], ay = currentPoints[idx - 3];
          const bx = currentPoints[idx - 2], by = currentPoints[idx - 1];
          const cx = currentPoints[idx], cy = currentPoints[idx + 1];
          const m1x = (ax + bx) / 2, m1y = (ay + by) / 2;
          const m2x = (bx + cx) / 2, m2y = (by + cy) / 2;
          ctx.beginPath();
          ctx.moveTo(m1x, m1y);
          ctx.quadraticCurveTo(bx, by, m2x, m2y);
          ctx.stroke();
        } else {
          const ax = currentPoints[idx - 4], ay = currentPoints[idx - 3];
          const bx = currentPoints[idx - 2], by = currentPoints[idx - 1];
          const cx = currentPoints[idx], cy = currentPoints[idx + 1];
          const m1x = (ax + bx) / 2, m1y = (ay + by) / 2;
          ctx.beginPath();
          ctx.moveTo(m1x, m1y);
          ctx.quadraticCurveTo(bx, by, cx, cy);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  // ==========================================
  // ERASER
  // ==========================================
  function eraseAtPoint(x, y, radius) {
    const r2 = radius * radius;
    let hit = false;
    strokes = strokes.filter(s => {
      for (let i = 0; i < s.xs.length; i++) {
        const dx = s.xs[i] - x, dy = s.ys[i] - y;
        if (dx * dx + dy * dy < r2) { hit = true; return false; }
      }
      return true;
    });
    if (hit) requestRender();
  }

  // ==========================================
  // SCRIBBLE ERASE
  // ==========================================
  function isScribble(stroke) {
    const n = stroke.xs.length;
    if (n < 20) return false;

    const start = Math.max(0, n - 30);
    let dirChanges = 0, sigChanges = 0;
    let ldx = 0, ldy = 0;

    for (let i = start + 1; i < n; i++) {
      const dx = stroke.xs[i] - stroke.xs[i - 1];
      const dy = stroke.ys[i] - stroke.ys[i - 1];
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (i > start + 1 && mag > 1) {
        const dot = dx * ldx + dy * ldy;
        if (dot < 0) dirChanges++;
        const mp = Math.sqrt(ldx * ldx + ldy * ldy);
        if (mp > 0 && dot / (mag * mp) < -0.3) sigChanges++;
      }
      ldx = dx; ldy = dy;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let pathLen = 0;
    for (let i = start; i < n; i++) {
      if (stroke.xs[i] < minX) minX = stroke.xs[i];
      if (stroke.xs[i] > maxX) maxX = stroke.xs[i];
      if (stroke.ys[i] < minY) minY = stroke.ys[i];
      if (stroke.ys[i] > maxY) maxY = stroke.ys[i];
      if (i > start) {
        const dx = stroke.xs[i] - stroke.xs[i - 1];
        const dy = stroke.ys[i] - stroke.ys[i - 1];
        pathLen += Math.sqrt(dx * dx + dy * dy);
      }
    }

    const w = maxX - minX, h = maxY - minY;
    const diag = Math.sqrt(w * w + h * h);
    if (diag < 20) return false;

    return sigChanges >= 4 && pathLen / diag > 3 && dirChanges >= 5;
  }

  function eraseUnderScribble(stroke) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < stroke.xs.length; i++) {
      if (stroke.xs[i] < minX) minX = stroke.xs[i];
      if (stroke.xs[i] > maxX) maxX = stroke.xs[i];
      if (stroke.ys[i] < minY) minY = stroke.ys[i];
      if (stroke.ys[i] > maxY) maxY = stroke.ys[i];
    }
    minX -= 20; maxX += 20; minY -= 20; maxY += 20;

    strokes = strokes.filter(s => {
      for (let i = 0; i < s.xs.length; i++) {
        if (s.xs[i] >= minX && s.xs[i] <= maxX && s.ys[i] >= minY && s.ys[i] <= maxY) return false;
      }
      return true;
    });
    toast('⚡ Scribble erased!');
  }

  // ==========================================
  // SHAPE RECOGNITION
  // ==========================================
  function detectShape(stroke) {
    const n = stroke.xs.length;
    if (n < 8) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (stroke.xs[i] < minX) minX = stroke.xs[i];
      if (stroke.xs[i] > maxX) maxX = stroke.xs[i];
      if (stroke.ys[i] < minY) minY = stroke.ys[i];
      if (stroke.ys[i] > maxY) maxY = stroke.ys[i];
    }

    const w = maxX - minX, h = maxY - minY;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const dx = stroke.xs[n - 1] - stroke.xs[0];
    const dy = stroke.ys[n - 1] - stroke.ys[0];
    const closeDist = Math.sqrt(dx * dx + dy * dy);
    const maxDim = Math.max(w, h);

    // Check straight line
    let pathLen = 0;
    for (let i = 1; i < n; i++) {
      const ddx = stroke.xs[i] - stroke.xs[i - 1];
      const ddy = stroke.ys[i] - stroke.ys[i - 1];
      pathLen += Math.sqrt(ddx * ddx + ddy * ddy);
    }
    const endDist = Math.sqrt(Math.pow(stroke.xs[n - 1] - stroke.xs[0], 2) + Math.pow(stroke.ys[n - 1] - stroke.ys[0], 2));
    const straightness = pathLen > 0 ? endDist / pathLen : 0;

    if (straightness > 0.96 && endDist > 25) {
      return { type: 'Line', x1: stroke.xs[0], y1: stroke.ys[0], x2: stroke.xs[n - 1], y2: stroke.ys[n - 1] };
    }

    if (w < 25 || h < 25) return null;

    const isClosed = closeDist < maxDim * 0.35;
    if (!isClosed) {
      if (straightness > 0.82 && n > 15) {
        return { type: 'Arrow', x1: stroke.xs[0], y1: stroke.ys[0], x2: stroke.xs[n - 1], y2: stroke.ys[n - 1] };
      }
      return null;
    }

    // Closed shape analysis
    const ar = w / h;
    let distSum = 0, distSqSum = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(Math.pow(stroke.xs[i] - cx, 2) + Math.pow(stroke.ys[i] - cy, 2));
      distSum += d;
      distSqSum += d * d;
    }
    const avgDist = distSum / n;
    const variance = distSqSum / n - avgDist * avgDist;
    const cv = Math.sqrt(Math.max(0, variance)) / avgDist;

    if (cv < 0.18) {
      return {
        type: (ar > 0.85 && ar < 1.18) ? 'Circle' : 'Ellipse',
        cx, cy, rx: w / 2, ry: h / 2
      };
    }

    // Count corners
    const corners = countCornersFlat(stroke);
    if (corners === 3) return { type: 'Triangle', cx, cy, w, h, minX, minY, maxX, maxY, stroke };
    if (corners === 4) {
      let edgeScore = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(stroke.xs[i] - minX) < w * 0.12 || Math.abs(stroke.xs[i] - maxX) < w * 0.12 ||
            Math.abs(stroke.ys[i] - minY) < h * 0.12 || Math.abs(stroke.ys[i] - maxY) < h * 0.12) edgeScore++;
      }
      if (edgeScore / n > 0.5) {
        return {
          type: (ar > 0.85 && ar < 1.18) ? 'Square' : 'Rectangle',
          minX, minY, maxX, maxY
        };
      }
    }

    if (cv < 0.28) {
      return {
        type: (ar > 0.85 && ar < 1.18) ? 'Circle' : 'Ellipse',
        cx, cy, rx: w / 2, ry: h / 2
      };
    }

    return null;
  }

  function countCornersFlat(stroke) {
    const n = stroke.xs.length;
    if (n < 8) return 0;
    let corners = 0;
    const step = Math.max(2, Math.floor(n / 30));
    for (let i = step * 2; i < n - step * 2; i += step) {
      const a1 = Math.atan2(stroke.ys[i] - stroke.ys[i - step * 2], stroke.xs[i] - stroke.xs[i - step * 2]);
      const a2 = Math.atan2(stroke.ys[i + step * 2] - stroke.ys[i], stroke.xs[i + step * 2] - stroke.xs[i]);
      let diff = Math.abs(a2 - a1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > Math.PI / 4) corners++;
    }
    return Math.min(corners, 6);
  }

  function shapeToStroke(shape, original) {
    const xs = [], ys = [], ps = [];
    const p = 0.7;

    switch (shape.type) {
      case 'Circle':
      case 'Ellipse':
        for (let i = 0; i <= 80; i++) {
          const a = (i / 80) * Math.PI * 2;
          xs.push(shape.cx + Math.cos(a) * shape.rx);
          ys.push(shape.cy + Math.sin(a) * shape.ry);
          ps.push(p);
        }
        break;
      case 'Rectangle':
      case 'Square':
        [[shape.minX, shape.minY], [shape.maxX, shape.minY],
         [shape.maxX, shape.maxY], [shape.minX, shape.maxY],
         [shape.minX, shape.minY]].forEach(([x, y]) => { xs.push(x); ys.push(y); ps.push(p); });
        break;
      case 'Triangle': {
        const s = shape;
        // Find actual triangle vertices from the stroke
        let topIdx = 0;
        for (let i = 1; i < s.stroke.xs.length; i++) {
          if (s.stroke.ys[i] < s.stroke.ys[topIdx]) topIdx = i;
        }
        const top = { x: s.stroke.xs[topIdx], y: s.stroke.ys[topIdx] };
        const bl = { x: s.minX, y: s.maxY };
        const br = { x: s.maxX, y: s.maxY };
        [top, br, bl, top].forEach(v => { xs.push(v.x); ys.push(v.y); ps.push(p); });
        break;
      }
      case 'Line':
        xs.push(shape.x1, shape.x2); ys.push(shape.y1, shape.y2); ps.push(p, p);
        break;
      case 'Arrow': {
        xs.push(shape.x1, shape.x2); ys.push(shape.y1, shape.y2); ps.push(p, p);
        const ang = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const al = 20, aa = Math.PI / 6;
        xs.push(shape.x2 - al * Math.cos(ang - aa)); ys.push(shape.y2 - al * Math.sin(ang - aa)); ps.push(p);
        xs.push(shape.x2); ys.push(shape.y2); ps.push(p);
        xs.push(shape.x2 - al * Math.cos(ang + aa)); ys.push(shape.y2 - al * Math.sin(ang + aa)); ps.push(p);
        break;
      }
      default: return original;
    }

    return {
      ...original,
      xs: Float32Array.from(xs),
      ys: Float32Array.from(ys),
      ps: Float32Array.from(ps),
      style: 'solid',
      shape: shape.type
    };
  }

  // ==========================================
  // BEAUTIFY
  // ==========================================
  function beautify(stroke) {
    const n = stroke.xs.length;
    if (n < 4) return stroke;

    // Simplify
    const sx = [stroke.xs[0]], sy = [stroke.ys[0]], sp = [stroke.ps[0]];
    for (let i = 1; i < n - 1; i++) {
      const dx = stroke.xs[i] - sx[sx.length - 1];
      const dy = stroke.ys[i] - sy[sy.length - 1];
      if (dx * dx + dy * dy >= 2.25) { // 1.5^2
        sx.push(stroke.xs[i]); sy.push(stroke.ys[i]); sp.push(stroke.ps[i]);
      }
    }
    sx.push(stroke.xs[n - 1]); sy.push(stroke.ys[n - 1]); sp.push(stroke.ps[n - 1]);

    // Chaikin smooth x2
    let rx = sx, ry = sy, rp = sp;
    for (let pass = 0; pass < 2; pass++) {
      const nx = [rx[0]], ny = [ry[0]], np = [rp[0]];
      for (let i = 0; i < rx.length - 1; i++) {
        nx.push(0.75 * rx[i] + 0.25 * rx[i + 1]);
        ny.push(0.75 * ry[i] + 0.25 * ry[i + 1]);
        np.push(0.75 * rp[i] + 0.25 * rp[i + 1]);
        nx.push(0.25 * rx[i] + 0.75 * rx[i + 1]);
        ny.push(0.25 * ry[i] + 0.75 * ry[i + 1]);
        np.push(0.25 * rp[i] + 0.75 * rp[i + 1]);
      }
      nx.push(rx[rx.length - 1]); ny.push(ry[ry.length - 1]); np.push(rp[rp.length - 1]);
      rx = nx; ry = ny; rp = np;
    }

    return {
      ...stroke,
      xs: Float32Array.from(rx),
      ys: Float32Array.from(ry),
      ps: Float32Array.from(rp),
      beautified: true
    };
  }

  // ==========================================
  // TOUCH GESTURES (undo/redo)
  // ==========================================
  function touchStart(e) {
    activeTouchCount = e.touches.length;
    if (activeTouchCount >= 2) {
      gestureStartTime = Date.now();
      e.preventDefault();
    }
  }

  function touchEnd(e) {
    if (!gesturesEnabled) { activeTouchCount = e.touches.length; return; }
    const now = Date.now();
    const dur = now - gestureStartTime;
    const since = now - lastGestureTime;

    if (dur < 300 && since > 350) {
      if (activeTouchCount === 2) { lastGestureTime = now; undo(); showHint('↶ Undo'); e.preventDefault(); }
      else if (activeTouchCount === 3) { lastGestureTime = now; redo(); showHint('↷ Redo'); e.preventDefault(); }
    }
    activeTouchCount = e.touches.length;
  }

  function showHint(text) {
    const el = document.getElementById('gestureHint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 500);
  }

  // ==========================================
  // UNDO / REDO / CLEAR
  // ==========================================
  function undo() {
    if (!strokes.length) return;
    redoStack.push(strokes.pop());
    requestRender();
    toast('↶ Undone');
  }

  function redo() {
    if (!redoStack.length) return;
    strokes.push(redoStack.pop());
    requestRender();
    toast('↷ Redone');
  }

  function clearCanvas() {
    if (!confirm('Clear drawing?')) return;
    strokes = [];
    redoStack = [];
    requestRender();
  }

  function toast(msg) {
    if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(msg);
  }

  // ==========================================
  // BACKGROUND
  // ==========================================
  function paintBackground() {
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    const w = canvasWidth, h = canvasHeight;

    switch (bgType) {
      case 'dark':
        bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h); break;
      case 'white':
        bgCtx.fillStyle = '#ffffff'; bgCtx.fillRect(0, 0, w, h); break;
      case 'cream':
        bgCtx.fillStyle = '#fff9e6'; bgCtx.fillRect(0, 0, w, h); break;
      case 'lined':
        bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
        bgCtx.strokeStyle = 'rgba(255,255,255,0.1)'; bgCtx.lineWidth = 1;
        for (let y = 32; y < h; y += 32) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
        break;
      case 'grid':
        bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
        bgCtx.strokeStyle = 'rgba(255,255,255,0.08)'; bgCtx.lineWidth = 1;
        for (let x = 0; x < w; x += 28) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke(); }
        for (let y = 0; y < h; y += 28) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
        break;
      case 'dotgrid':
        bgCtx.fillStyle = '#0a0a0a'; bgCtx.fillRect(0, 0, w, h);
        bgCtx.fillStyle = 'rgba(255,255,255,0.2)';
        for (let x = 28; x < w; x += 28) {
          for (let y = 28; y < h; y += 28) {
            bgCtx.beginPath(); bgCtx.arc(x, y, 1.5, 0, Math.PI * 2); bgCtx.fill();
          }
        }
        break;
    }
  }

  // ==========================================
  // PEN SETTINGS UI
  // ==========================================
  function openPenSettings() {
    const p = document.getElementById('penSettings');
    if (p) { p.classList.remove('hidden'); menuOpen = true; }
  }

  function closePenSettings() {
    const p = document.getElementById('penSettings');
    if (p) { p.classList.add('hidden'); menuOpen = false; }
  }

  function setupUI() {
    // Outside click to close
    document.addEventListener('pointerdown', (e) => {
      if (!menuOpen) return;
      const panel = document.getElementById('penSettings');
      if (panel && !panel.contains(e.target) && !e.target.closest('.pen-preset')) closePenSettings();
    }, true);

    // Pen presets
    document.querySelectorAll('.pen-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = btn.classList.contains('active');
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = 'pen';
        penColor = btn.dataset.color;
        const cp = document.getElementById('penColorPicker');
        if (cp) cp.value = penColor;
        wasActive ? (menuOpen ? closePenSettings() : openPenSettings()) : openPenSettings();
        updateCursor();
      });
    });

    // Other tools
    document.querySelectorAll('.pen-tool:not(.pen-preset)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tool = btn.dataset.tool;
        if (!tool) return;
        document.querySelectorAll('.pen-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = tool;
        if (tool === 'highlighter') { penColor = '#ffff00'; openPenSettings(); }
        else closePenSettings();
        updateCursor();
      });
    });

    // Thickness
    document.querySelectorAll('.thickness-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penSize = parseInt(btn.dataset.size);
        const sl = document.getElementById('penSizeSlider');
        const sv = document.getElementById('penSizeValue');
        if (sl) sl.value = penSize;
        if (sv) sv.textContent = penSize;
      });
    });

    // Pen styles
    document.querySelectorAll('.pen-style-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.pen-style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        penStyle = btn.dataset.style;
      });
    });

    // Auto shape button
    const asb = document.getElementById('autoShapeBtn');
    if (asb) asb.addEventListener('click', (e) => {
      e.stopPropagation();
      shapeRecognitionEnabled = !shapeRecognitionEnabled;
      asb.classList.toggle('active', shapeRecognitionEnabled);
      toast(shapeRecognitionEnabled ? '✨ Auto Shape ON' : 'Auto Shape OFF');
      const t = document.getElementById('shapeRecognitionToggle');
      if (t) t.checked = shapeRecognitionEnabled;
    });

    // Close button
    document.getElementById('closePenSettings')?.addEventListener('click', (e) => { e.stopPropagation(); closePenSettings(); });

    // Color picker
    const cp = document.getElementById('penColorPicker');
    if (cp) cp.addEventListener('input', e => {
      penColor = e.target.value;
      const vis = document.querySelector('.pen-preset.active .pen-visual');
      if (vis) vis.style.background = penColor;
    });

    // Size slider
    const ss = document.getElementById('penSizeSlider');
    const sv = document.getElementById('penSizeValue');
    if (ss) ss.addEventListener('input', e => {
      penSize = parseInt(e.target.value);
      if (sv) sv.textContent = penSize;
      document.querySelectorAll('.thickness-btn').forEach(b => b.classList.remove('active'));
    });

    // Opacity slider
    const os = document.getElementById('penOpacity');
    const ov = document.getElementById('opacityValue');
    if (os) os.addEventListener('input', e => {
      penOpacity = parseFloat(e.target.value) / 100;
      if (ov) ov.textContent = Math.round(penOpacity * 100);
    });

    // Background select
    const bg = document.getElementById('canvasBgSelect');
    if (bg) bg.addEventListener('change', e => { bgType = e.target.value; paintBackground(); });

    // Toggles
    document.getElementById('scribbleEraseToggle')?.addEventListener('change', e => { scribbleEraseEnabled = e.target.checked; });
    document.getElementById('shapeRecognitionToggle')?.addEventListener('change', e => {
      shapeRecognitionEnabled = e.target.checked;
      const b = document.getElementById('autoShapeBtn');
      if (b) b.classList.toggle('active', shapeRecognitionEnabled);
    });
    document.getElementById('fingerDrawToggle')?.addEventListener('change', e => { fingerDrawEnabled = e.target.checked; });
    document.getElementById('beautifyToggle')?.addEventListener('change', e => {
      beautifyEnabled = e.target.checked;
      if (beautifyEnabled) { strokes = strokes.map(s => s.beautified ? s : beautify(s)); requestRender(); }
    });
    document.getElementById('gesturesToggle')?.addEventListener('change', e => { gesturesEnabled = e.target.checked; });

    // Undo/Redo buttons
    document.getElementById('undoBtn')?.addEventListener('click', (e) => { e.stopPropagation(); undo(); });
    document.getElementById('redoBtn')?.addEventListener('click', (e) => { e.stopPropagation(); redo(); });

    // Stop propagation on settings panel
    const ps = document.getElementById('penSettings');
    if (ps) { ps.addEventListener('pointerdown', e => e.stopPropagation()); ps.addEventListener('click', e => e.stopPropagation()); }
  }

  function updateCursor() {
    if (!drawingCanvas) return;
    drawingCanvas.style.cursor = currentTool === 'eraser' ? 'cell' : (currentTool === 'select' || currentTool === 'lasso') ? 'default' : 'crosshair';
  }

  // ==========================================
  // EXPORT / THUMBNAIL
  // ==========================================
  function exportImage() {
    const m = document.createElement('canvas');
    m.width = drawingCanvas.width; m.height = drawingCanvas.height;
    const mc = m.getContext('2d');
    mc.drawImage(bgCanvas, 0, 0);
    mc.drawImage(drawingCanvas, 0, 0);
    const a = document.createElement('a');
    a.download = 'notemax-page.png';
    a.href = m.toDataURL('image/png');
    a.click();
  }

  function getThumbnail(w = 150, h = 200) {
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const tc = t.getContext('2d');
    tc.drawImage(bgCanvas, 0, 0, w, h);
    tc.drawImage(drawingCanvas, 0, 0, w, h);
    return t.toDataURL('image/png');
  }

  // ==========================================
  // STROKE SERIALIZATION
  // ==========================================
  function getStrokes() {
    return strokes.map(s => ({
      ...s,
      xs: Array.from(s.xs),
      ys: Array.from(s.ys),
      ps: Array.from(s.ps)
    }));
  }

  function loadStrokes(data) {
    strokes = (data || []).map(s => ({
      ...s,
      xs: Float32Array.from(s.xs),
      ys: Float32Array.from(s.ys),
      ps: Float32Array.from(s.ps)
    }));
    redoStack = [];
    requestRender();
  }

  function getBgType() { return bgType; }
  function setBgType(type) {
    bgType = type;
    const sel = document.getElementById('canvasBgSelect');
    if (sel) sel.value = type;
    paintBackground();
  }

  // ==========================================
  // PUBLIC API
  // ==========================================
  return {
    init,
    undo,
    redo,
    clearCanvas,
    exportImage,
    getStrokes,
    loadStrokes,
    drawBackground: paintBackground,
    getThumbnail,
    getBgType,
    setBgType
  };
})();
