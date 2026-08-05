/**
 * FreenotesEngine - Complete Pure JavaScript iPad Canvas Writing Engine
 * Features:
 * - 120Hz Coalesced Apple Pencil Input & Low-Latency Desynchronized Context
 * - Pen Physics Engine (Fountain, Ballpoint, Highlighter, Calligraphy Brush)
 * - Palm Rejection (Stylus-Only mode)
 * - Smart Hold-to-Shape Auto-Snapping (Lines, Circles, Rectangles)
 * - Scribble-to-Erase Detection
 * - 2-Finger Tap Undo & 3-Finger Tap Redo Gestures
 * - Full Undo / Redo History Stack
 */
class FreenotesEngine {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d', {
      desynchronized: true,
      alpha: false,
      willReadFrequently: false
    });

    this.options = Object.assign({
      bgColor: '#1c1c1e',
      penType: 'fountain', // 'fountain' | 'ballpoint' | 'highlighter' | 'brush'
      penColor: '#ffffff',
      baseWidth: 3.5,
      stylusOnly: true,         // Ignore touch drawings when Pencil is active
      shapeHoldDelay: 450,      // Delay in ms to trigger hold-to-shape
      enableTapGestures: true   // 2-finger undo / 3-finger redo
    }, options);

    // Ink History & State
    this.strokes = [];
    this.undoStack = [];
    this.currentStroke = null;
    this.activePointerId = null;
    this.isStylusActive = false;

    // Multi-touch Gesture Tracking
    this.activePointers = new Map();
    this.gestureState = {
      maxPointers: 0,
      startTime: 0,
      hasMoved: false
    };

    // Hold-to-Shape Timers
    this.holdTimer = null;
    this.lastPoint = null;

    this.init();
  }

  init() {
    this.resize();
    this.bindEvents();
    this.render();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', e => this.onPointerUp(e));
  }

  // ==========================================
  // INPUT HANDLING, PALM REJECTION & GESTURES
  // ==========================================

  onPointerDown(e) {
    if (e.pointerType === 'pen') this.isStylusActive = true;
    if (this.options.stylusOnly && this.isStylusActive && e.pointerType === 'touch') return;

    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      time: performance.now()
    });

    // Handle Multi-Touch Tap Gestures (2-Finger / 3-Finger)
    if (this.options.enableTapGestures && this.activePointers.size > 1) {
      // Abort active stroke drawing if a second finger lands
      this.clearHoldTimer();
      this.currentStroke = null;

      if (this.activePointers.size > this.gestureState.maxPointers) {
        this.gestureState.maxPointers = this.activePointers.size;
      }
      this.render();
      return;
    }

    // Single-pointer start
    this.gestureState = {
      maxPointers: 1,
      startTime: performance.now(),
      hasMoved: false
    };

    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointerId = e.pointerId;

    const point = this.extractPoint(e);

    this.currentStroke = {
      type: this.options.penType,
      color: this.options.penColor,
      baseWidth: this.options.baseWidth,
      points: [point],
      isSnappedShape: false
    };

    this.startHoldTimer(point);
  }

  onPointerMove(e) {
    if (!this.activePointers.has(e.pointerId)) return;

    // Movement tracking for tap gesture invalidation
    const ptr = this.activePointers.get(e.pointerId);
    if (Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 8) {
      this.gestureState.hasMoved = true;
    }

    if (!this.currentStroke || e.pointerId !== this.activePointerId) return;
    e.preventDefault();

    // 120Hz/240Hz Apple Pencil coalesced input batching
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

    for (const evt of events) {
      const point = this.extractPoint(evt);
      const prev = this.currentStroke.points[this.currentStroke.points.length - 1];

      // Jitter filter
      if (Math.hypot(point.x - prev.x, point.y - prev.y) < 1.0) continue;

      this.currentStroke.points.push(point);
      this.resetHoldTimer(point);
    }

    this.render();
  }

  onPointerUp(e) {
    const duration = performance.now() - (this.gestureState.startTime || 0);
    const maxPointers = this.gestureState.maxPointers;
    const hasMoved = this.gestureState.hasMoved;

    this.activePointers.delete(e.pointerId);

    // Evaluate 2-Finger Undo / 3-Finger Redo Gesture
    if (this.options.enableTapGestures && maxPointers > 1) {
      if (this.activePointers.size === 0) {
        if (duration < 350 && !hasMoved) {
          if (maxPointers === 2) this.undo();
          if (maxPointers === 3) this.redo();
        }
        this.gestureState.maxPointers = 0;
      }
      return;
    }

    if (!this.currentStroke || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.clearHoldTimer();

    const pts = this.currentStroke.points;

    // Gesture & Ink Commit Processing
    if (this.detectScribble(pts)) {
      this.eraseStrokesInBounds(this.getBoundingBox(pts));
    } else {
      this.strokes.push(this.currentStroke);
      this.undoStack = []; // Clear redo stack on new action
    }

    this.currentStroke = null;
    this.activePointerId = null;
    this.render();
  }

  extractPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const now = performance.now();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let velocity = 0;
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      const prev = this.currentStroke.points[this.currentStroke.points.length - 1];
      const dist = Math.hypot(x - prev.x, y - prev.y);
      const dt = Math.max(1, now - prev.time);
      velocity = dist / dt;
    }

    return {
      x,
      y,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      velocity,
      time: now
    };
  }

  // ==========================================
  // REALISTIC INK & SMOOTHING ENGINE
  // ==========================================

  render() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = this.options.bgColor;
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    for (const stroke of this.strokes) {
      this.drawStroke(stroke);
    }

    if (this.currentStroke) {
      this.drawStroke(this.currentStroke);
    }
  }

  drawStroke(stroke) {
    const pts = stroke.points;
    if (pts.length === 0) return;

    this.ctx.save();

    if (stroke.type === 'highlighter') {
      this.ctx.globalAlpha = 0.35;
      this.ctx.lineCap = 'square';
      this.ctx.lineJoin = 'miter';
      this.ctx.strokeStyle = stroke.color;
      this.ctx.lineWidth = stroke.baseWidth * 6;
      this.drawSmoothCurve(pts);
    } 
    else if (stroke.type === 'ballpoint') {
      this.ctx.globalAlpha = 1.0;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = stroke.color;

      for (let i = 1; i < pts.length; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        this.ctx.lineTo(pts[i].x, pts[i].y);
        this.ctx.lineWidth = stroke.baseWidth * (0.85 + pts[i].pressure * 0.3);
        this.ctx.stroke();
      }
    } 
    else if (stroke.type === 'fountain') {
      this.ctx.globalAlpha = 1.0;
      this.ctx.fillStyle = stroke.color;

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const speedFactor = Math.max(0.35, 1.25 - p1.velocity * 0.22);
        const pressureFactor = 0.3 + p1.pressure * 0.9;
        const width = stroke.baseWidth * speedFactor * pressureFactor;

        this.drawVariableSegment(p0, p1, width);
      }
    } 
    else if (stroke.type === 'brush') {
      this.ctx.globalAlpha = 0.95;
      this.ctx.fillStyle = stroke.color;

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const tiltFactor = (Math.abs(p1.tiltX) + Math.abs(p1.tiltY)) / 90;
        const width = stroke.baseWidth * (0.4 + p1.pressure * 1.8 + tiltFactor);

        this.drawVariableSegment(p0, p1, width);
      }
    }

    this.ctx.restore();
  }

  drawSmoothCurve(pts) {
    if (pts.length < 2) return;
    this.ctx.beginPath();
    this.ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      this.ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }

    this.ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    this.ctx.stroke();
  }

  drawVariableSegment(p0, p1, width) {
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const perp = angle + Math.PI / 2;
    const offsetX = Math.cos(perp) * (width / 2);
    const offsetY = Math.sin(perp) * (width / 2);

    this.ctx.beginPath();
    this.ctx.arc(p0.x, p0.y, width / 2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.moveTo(p0.x - offsetX, p0.y - offsetY);
    this.ctx.lineTo(p0.x + offsetX, p0.y + offsetY);
    this.ctx.lineTo(p1.x + offsetX, p1.y + offsetY);
    this.ctx.lineTo(p1.x - offsetX, p1.y - offsetY);
    this.ctx.closePath();
    this.ctx.fill();
  }

  // ==========================================
  // SMART GESTURES (HOLD-TO-SHAPE & SCRIBBLE)
  // ==========================================

  startHoldTimer(point) {
    this.clearHoldTimer();
    this.lastPoint = point;

    this.holdTimer = setTimeout(() => {
      if (this.currentStroke && this.currentStroke.points.length > 8) {
        this.snapToShape(this.currentStroke);
      }
    }, this.options.shapeHoldDelay);
  }

  resetHoldTimer(currentPoint) {
    if (!this.lastPoint) return;
    const moveDist = Math.hypot(currentPoint.x - this.lastPoint.x, currentPoint.y - this.lastPoint.y);

    if (moveDist > 3.0) {
      this.startHoldTimer(currentPoint);
    }
  }

  clearHoldTimer() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  snapToShape(stroke) {
    const pts = stroke.points;
    const start = pts[0];
    const end = pts[pts.length - 1];
    const bbox = this.getBoundingBox(pts);
    const isClosed = Math.hypot(end.x - start.x, end.y - start.y) < Math.max(bbox.w, bbox.h) * 0.35;

    if (!isClosed) {
      stroke.points = [
        { x: start.x, y: start.y, pressure: 0.5, velocity: 0, time: start.time },
        { x: end.x, y: end.y, pressure: 0.5, velocity: 0, time: end.time }
      ];
    } else {
      const aspectRatio = bbox.w / (bbox.h || 1);

      if (aspectRatio >= 0.75 && aspectRatio <= 1.25) {
        const centerX = bbox.x + bbox.w / 2;
        const centerY = bbox.y + bbox.h / 2;
        const radius = (bbox.w + bbox.h) / 4;
        const circlePts = [];

        for (let i = 0; i <= 32; i++) {
          const rad = (i / 32) * Math.PI * 2;
          circlePts.push({
            x: centerX + radius * Math.cos(rad),
            y: centerY + radius * Math.sin(rad),
            pressure: 0.5, velocity: 0, time: performance.now()
          });
        }
        stroke.points = circlePts;
      } else {
        stroke.points = [
          { x: bbox.x, y: bbox.y, pressure: 0.5, velocity: 0, time: performance.now() },
          { x: bbox.x + bbox.w, y: bbox.y, pressure: 0.5, velocity: 0, time: performance.now() },
          { x: bbox.x + bbox.w, y: bbox.y + bbox.h, pressure: 0.5, velocity: 0, time: performance.now() },
          { x: bbox.x, y: bbox.y + bbox.h, pressure: 0.5, velocity: 0, time: performance.now() },
          { x: bbox.x, y: bbox.y, pressure: 0.5, velocity: 0, time: performance.now() }
        ];
      }
    }

    stroke.isSnappedShape = true;
    this.render();
  }

  detectScribble(points) {
    if (points.length < 16) return false;

    let reversals = 0;
    let pathLength = 0;

    for (let i = 1; i < points.length; i++) {
      pathLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);

      if (i > 1) {
        const dx1 = points[i - 1].x - points[i - 2].x;
        const dy1 = points[i - 1].y - points[i - 2].y;
        const dx2 = points[i].x - points[i - 1].x;
        const dy2 = points[i].y - points[i - 1].y;

        const dotProduct = dx1 * dx2 + dy1 * dy2;
        const mag1 = Math.hypot(dx1, dy1);
        const mag2 = Math.hypot(dx2, dy2);

        if (mag1 > 0 && mag2 > 0 && (dotProduct / (mag1 * mag2)) < -0.4) {
          reversals++;
        }
      }
    }

    const bbox = this.getBoundingBox(points);
    const diagonal = Math.hypot(bbox.w, bbox.h);

    return reversals >= 5 && (pathLength / (diagonal || 1)) > 3.5;
  }

  eraseStrokesInBounds(box) {
    this.strokes = this.strokes.filter(stroke => {
      return !stroke.points.some(p =>
        p.x >= box.x && p.x <= box.x + box.w &&
        p.y >= box.y && p.y <= box.y + box.h
      );
    });
  }

  getBoundingBox(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ==========================================
  // PUBLIC CONTROLS & UTILITIES
  // ==========================================

  undo() {
    if (this.strokes.length === 0) return;
    this.undoStack.push(this.strokes.pop());
    this.render();
  }

  redo() {
    if (this.undoStack.length === 0) return;
    this.strokes.push(this.undoStack.pop());
    this.render();
  }

  clear() {
    this.strokes = [];
    this.undoStack = [];
    this.render();
  }

  setPenType(type) { this.options.penType = type; }
  setPenColor(color) { this.options.penColor = color; }
  setBaseWidth(width) { this.options.baseWidth = width; }
}
