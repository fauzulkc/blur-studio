import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Move, Eye, EyeOff, Grid,
  Trash2, Plus, Sparkles, Shield, CircleDot, RefreshCw,
  MousePointer, Sliders, Contrast, Columns, Layers
} from 'lucide-react';
import { computeGridDimensions } from '../utils/gridBlur.js';

export default function CanvasStudio({
  activeImage,
  targets,
  setTargets,
  exclusions,
  setExclusions,
  gridDensity,
  gridOverlayVisible,
  setGridOverlayVisible,
  gridBlurEnabled,
  setGridBlurEnabled,
  selectedGridCells,
  setSelectedGridCells,
  activeTool, // 'grid-toggle' | 'ellipse' | 'vip-box' | 'select' | 'pan'
  viewMode, // 'blur-applied' | 'original' | 'side-by-side' | 'mask'
  setViewMode,
  blurRadius,
  featherRadius,
  selectedTargetIndex,
  setSelectedTargetIndex,
  selectedExclusionIndex,
  setSelectedExclusionIndex,
  isPeekingOriginal,
  setIsPeekingOriginal,
  setActiveTool,
  setBlurRadius,
  setFeatherRadius,
  setGridDensity,
  onConvertGridToTargets
}) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const blurCanvasRef = useRef(null);
  const sideBlurCanvasRef = useRef(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Grid interaction state
  const [hoveredCell, setHoveredCell] = useState(null);
  const [isDraggingGrid, setIsDraggingGrid] = useState(false);
  const [dragPaintMode, setDragPaintMode] = useState('paint'); // 'paint' | 'erase'

  // Dragging / Resizing targets state
  const [draggingTarget, setDraggingTarget] = useState(null);
  const [draggingExclusion, setDraggingExclusion] = useState(null);
  const [creatingTarget, setCreatingTarget] = useState(null);

  // Calculate grid dimensions based on image aspect ratio
  const { cols, rows } = computeGridDimensions(gridDensity, activeImage);

  // Reset viewport (not grid/target data — that's per-image and loads via props) when active image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedTargetIndex(null);
    setSelectedExclusionIndex(null);
  }, [activeImage?.id]);

  // Real-time Canvas Rendering for Selective Privacy Blur. Mirrors
  // blur_processor.py's approach exactly: targets are grouped by their
  // EFFECTIVE (blurRadius, featherRadius) — the global default, unless a
  // target opts out via useGlobalBlur: false — and each group is masked,
  // feathered, blurred, and composited as its own pass. Without this
  // grouping, the live preview would always show the global blur radius even
  // for a region with its own custom override, mismatching what Apply
  // Active/Batch actually produce.
  const renderBlurCanvas = useCallback((canvas) => {
    if (!activeImage || !imageRef.current || !canvas) return;

    const img = imageRef.current;
    if (!img.complete || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d');
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    canvas.width = w;
    canvas.height = h;

    // Draw 100% sharp original image first
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const hasGridCells = gridBlurEnabled && selectedGridCells.size > 0;
    const hasTargets = targets.length > 0;

    // If no blur regions are defined, nothing more to draw
    if (!hasTargets && !hasGridCells) {
      return;
    }

    // Punch-out mask for VIP exclusion boxes, built once and reused by every group.
    let exclusionCanvas = null;
    if (exclusions.length > 0) {
      exclusionCanvas = document.createElement('canvas');
      exclusionCanvas.width = w;
      exclusionCanvas.height = h;
      const eCtx = exclusionCanvas.getContext('2d');
      eCtx.fillStyle = '#ffffff';
      exclusions.forEach((box) => {
        const x1 = Math.min(box.x1, box.x2) * w;
        const y1 = Math.min(box.y1, box.y2) * h;
        const bxW = Math.abs(box.x2 - box.x1) * w;
        const bxH = Math.abs(box.y2 - box.y1) * h;
        eCtx.fillRect(x1, y1, bxW, bxH);
      });
    }

    const drawTargetsOnMask = (maskCtx, list) => {
      maskCtx.fillStyle = '#ffffff';
      list.forEach((t) => {
        const cx = t.cx * w;
        const cy = t.cy * h;
        const rx = Math.max(2, t.rx * w);
        const ry = Math.max(2, t.ry * h);
        maskCtx.beginPath();
        maskCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        maskCtx.fill();
      });
    };

    const drawGridCellsOnMask = (maskCtx) => {
      const cellW = w / cols;
      const cellH = h / rows;
      maskCtx.fillStyle = '#ffffff';
      selectedGridCells.forEach((cellKey) => {
        const [c, r] = cellKey.split('_').map(Number);
        maskCtx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
      });
    };

    const punchExclusions = (maskCtx, maskCanvasEl) => {
      if (!exclusionCanvas) return;
      maskCtx.globalCompositeOperation = 'destination-out';
      maskCtx.drawImage(exclusionCanvas, 0, 0);
      maskCtx.globalCompositeOperation = 'source-over';
    };

    if (viewMode === 'mask') {
      // Combined union of every group's regions — a structural preview, not a
      // per-region-accurate one, so it uses the global feather radius only.
      const combined = document.createElement('canvas');
      combined.width = w;
      combined.height = h;
      const cCtx = combined.getContext('2d');
      drawTargetsOnMask(cCtx, targets);
      if (hasGridCells) drawGridCellsOnMask(cCtx);
      punchExclusions(cCtx, combined);

      let finalCombined = combined;
      if (featherRadius > 0) {
        const feathered = document.createElement('canvas');
        feathered.width = w;
        feathered.height = h;
        const fCtx = feathered.getContext('2d');
        fCtx.filter = `blur(${featherRadius}px)`;
        fCtx.drawImage(combined, 0, 0);
        finalCombined = feathered;
      }

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(finalCombined, 0, 0);
      return;
    }

    // Group ellipse targets by their effective (blurRadius, featherRadius).
    // Grid-cell tiles have no per-tile override, so they always join the
    // global-radius group.
    const groups = new Map();
    const groupFor = (blur, feather) => {
      const key = `${blur}|${feather}`;
      if (!groups.has(key)) groups.set(key, { blur, feather, targets: [], cells: false });
      return groups.get(key);
    };
    targets.forEach((t) => {
      const useOwn = t.useGlobalBlur === false;
      const blur = useOwn ? (t.blurRadius ?? blurRadius) : blurRadius;
      const feather = useOwn ? (t.featherRadius ?? featherRadius) : featherRadius;
      groupFor(blur, feather).targets.push(t);
    });
    if (hasGridCells) {
      groupFor(blurRadius, featherRadius).cells = true;
    }

    groups.forEach((group) => {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const maskCtx = maskCanvas.getContext('2d');
      drawTargetsOnMask(maskCtx, group.targets);
      if (group.cells) drawGridCellsOnMask(maskCtx);
      punchExclusions(maskCtx, maskCanvas);

      let finalMaskCanvas = maskCanvas;
      if (group.feather > 0) {
        const featheredCanvas = document.createElement('canvas');
        featheredCanvas.width = w;
        featheredCanvas.height = h;
        const fCtx = featheredCanvas.getContext('2d');
        fCtx.filter = `blur(${group.feather}px)`;
        fCtx.drawImage(maskCanvas, 0, 0);
        finalMaskCanvas = featheredCanvas;
      }

      const blurredCanvas = document.createElement('canvas');
      blurredCanvas.width = w;
      blurredCanvas.height = h;
      const bCtx = blurredCanvas.getContext('2d');
      bCtx.filter = `blur(${group.blur}px)`;
      bCtx.drawImage(img, 0, 0, w, h);

      const maskedBlurCanvas = document.createElement('canvas');
      maskedBlurCanvas.width = w;
      maskedBlurCanvas.height = h;
      const mbCtx = maskedBlurCanvas.getContext('2d');
      mbCtx.drawImage(finalMaskCanvas, 0, 0);
      mbCtx.globalCompositeOperation = 'source-in';
      mbCtx.drawImage(blurredCanvas, 0, 0);

      ctx.drawImage(maskedBlurCanvas, 0, 0);
    });
  }, [activeImage, targets, exclusions, selectedGridCells, gridBlurEnabled, blurRadius, featherRadius, viewMode, cols, rows]);

  useEffect(() => {
    if (blurCanvasRef.current) {
      renderBlurCanvas(blurCanvasRef.current);
    }
    if (sideBlurCanvasRef.current && viewMode === 'side-by-side') {
      renderBlurCanvas(sideBlurCanvasRef.current);
    }
  }, [renderBlurCanvas, viewMode]);

  // Coordinate conversion helper — clamps to [0,1] so an in-progress drag stays
  // well-behaved even if the cursor briefly overshoots the image edge.
  const getImageCoords = (e) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  // Unlike getImageCoords, this does NOT clamp. The floating capsule is the
  // only overlay that's actually nested inside this mousedown-handled
  // container (Header and Dock are DOM siblings in App.jsx, not descendants),
  // so a click on a capsule control (checkbox, button, number field) still
  // bubbles up here — without this guard, getImageCoords' clamping silently
  // turned that click into a valid-looking in-image coordinate pinned to
  // whichever edge it was nearest, and handleMouseDown would create a real
  // (if tiny) stray target at that clamped position. Gate the START of any
  // new paint/create interaction on the pointer genuinely being over the
  // image. (The capsule also stops propagation on its own onMouseDown as a
  // second, independent layer of protection — see its root div below.)
  const isPointerOnImage = (e) => {
    if (!imageRef.current) return false;
    const rect = imageRef.current.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  };

  // Mouse Down handler
  const handleMouseDown = (e) => {
    if (e.button === 1 || e.altKey || activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (e.button !== 0) return;
    if (!isPointerOnImage(e)) return;

    const coords = getImageCoords(e);
    if (!coords) return;

    if (activeTool === 'grid-toggle') {
      setIsDraggingGrid(true);
      const col = Math.floor(coords.x * cols);
      const row = Math.floor(coords.y * rows);
      const key = `${col}_${row}`;
      
      const isAlreadySelected = selectedGridCells.has(key);
      const mode = isAlreadySelected ? 'erase' : 'paint';
      setDragPaintMode(mode);

      setSelectedGridCells((prev) => {
        const next = new Set(prev);
        if (mode === 'paint') {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
      return;
    }

    if (activeTool === 'ellipse') {
      setCreatingTarget({
        type: 'ellipse',
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y
      });
      return;
    }

    if (activeTool === 'vip-box') {
      setCreatingTarget({
        type: 'vip-box',
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y
      });
      return;
    }
  };

  // Mouse Move handler
  const handleMouseMove = (e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    const coords = getImageCoords(e);
    if (!coords) {
      setHoveredCell(null);
      return;
    }

    const col = Math.floor(coords.x * cols);
    const row = Math.floor(coords.y * rows);
    setHoveredCell({ col, row, x: coords.x, y: coords.y });

    // Drag paint / toggle grid tiles
    if (isDraggingGrid) {
      const key = `${col}_${row}`;
      setSelectedGridCells((prev) => {
        const next = new Set(prev);
        if (dragPaintMode === 'paint') {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
      return;
    }

    // Creating new target drag preview
    if (creatingTarget) {
      setCreatingTarget((prev) => ({
        ...prev,
        currentX: coords.x,
        currentY: coords.y
      }));
      return;
    }

    // Dragging ellipse target
    if (draggingTarget !== null) {
      const { index, type, startX, startY, origCx, origCy, origRx, origRy } = draggingTarget;
      const dx = coords.x - startX;
      const dy = coords.y - startY;

      setTargets((prev) => {
        const next = [...prev];
        if (type === 'move') {
          next[index] = {
            ...next[index],
            cx: Math.max(0, Math.min(1, origCx + dx)),
            cy: Math.max(0, Math.min(1, origCy + dy))
          };
        } else if (type === 'resize-rx') {
          next[index] = {
            ...next[index],
            rx: Math.max(0.005, Math.min(0.5, origRx + dx))
          };
        } else if (type === 'resize-ry') {
          next[index] = {
            ...next[index],
            ry: Math.max(0.005, Math.min(0.5, origRy + dy))
          };
        }
        return next;
      });
      return;
    }

    // Dragging VIP box
    if (draggingExclusion !== null) {
      const { index, handle, startX, startY, origBox } = draggingExclusion;
      const dx = coords.x - startX;
      const dy = coords.y - startY;

      setExclusions((prev) => {
        const next = [...prev];
        if (handle === 'move') {
          const w = origBox.x2 - origBox.x1;
          const h = origBox.y2 - origBox.y1;
          const nx1 = Math.max(0, Math.min(1 - w, origBox.x1 + dx));
          const ny1 = Math.max(0, Math.min(1 - h, origBox.y1 + dy));
          next[index] = {
            ...next[index],
            x1: nx1,
            y1: ny1,
            x2: nx1 + w,
            y2: ny1 + h
          };
        } else if (handle === 'resize-br') {
          const minSize = 0.02;
          next[index] = {
            ...next[index],
            x2: Math.max(origBox.x1 + minSize, Math.min(1, origBox.x2 + dx)),
            y2: Math.max(origBox.y1 + minSize, Math.min(1, origBox.y2 + dy))
          };
        }
        return next;
      });
      return;
    }
  };

  // Mouse Up handler
  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDraggingGrid(false);
    setDraggingTarget(null);
    setDraggingExclusion(null);

    if (creatingTarget) {
      const { startX, startY, currentX, currentY, type } = creatingTarget;
      const rx = Math.max(0.015, Math.abs(currentX - startX) / 2);
      const ry = Math.max(0.02, Math.abs(currentY - startY) / 2);
      const cx = (startX + currentX) / 2;
      const cy = (startY + currentY) / 2;

      if (type === 'vip-box') {
        const newBox = {
          x1: Math.min(startX, currentX),
          y1: Math.min(startY, currentY),
          x2: Math.max(startX, currentX),
          y2: Math.max(startY, currentY),
          label: 'VIP Protected'
        };
        if (Math.abs(newBox.x2 - newBox.x1) > 0.02 && Math.abs(newBox.y2 - newBox.y1) > 0.02) {
          setExclusions((prev) => [...prev, newBox]);
          setSelectedExclusionIndex(exclusions.length);
          setSelectedTargetIndex(null);
        }
      } else {
        const newTarget = {
          cx,
          cy,
          rx: rx < 0.02 ? 0.035 : rx,
          ry: ry < 0.025 ? 0.045 : ry,
          label: `Target ${targets.length + 1}`
        };
        setTargets((prev) => [...prev, newTarget]);
        setSelectedTargetIndex(targets.length);
      }
      setCreatingTarget(null);
    }
  };

  // Wheel Zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.max(0.3, Math.min(5, prev * zoomFactor)));
  };

  // Determine which visual state to show on the main canvas
  const isShowingOriginal = isPeekingOriginal || viewMode === 'original';

  const selectedTarget = selectedTargetIndex !== null ? targets[selectedTargetIndex] : null;
  const selectedExclusion = selectedExclusionIndex !== null ? exclusions[selectedExclusionIndex] : null;

  // Explicit "add" affordances (in addition to drag-to-create), reachable whether
  // or not another region/VIP area is currently selected.
  const handleAddRegion = () => {
    const newIndex = targets.length;
    setTargets((prev) => [
      ...prev,
      { cx: 0.5, cy: 0.5, rx: 0.08, ry: 0.1, label: `Target ${newIndex + 1}` }
    ]);
    setSelectedTargetIndex(newIndex);
    setSelectedExclusionIndex(null);
  };

  const handleAddVipArea = () => {
    const newIndex = exclusions.length;
    setExclusions((prev) => [...prev, { x1: 0.42, y1: 0.4, x2: 0.58, y2: 0.6, label: 'VIP Protected' }]);
    setSelectedExclusionIndex(newIndex);
    setSelectedTargetIndex(null);
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className="flex-1 h-full bg-surface-canvas relative overflow-hidden flex items-center justify-center select-none canvas-bg-checker cursor-crosshair"
    >
      {!activeImage ? (
        <div className="text-center text-slate-500">
          <CircleDot className="w-12 h-12 mx-auto mb-3 text-slate-600 animate-pulse" />
          <p className="text-sm font-medium">Select an image from the sidebar to start blurring</p>
        </div>
      ) : viewMode === 'side-by-side' ? (
        /* Side-by-Side Dual Viewport Mode */
        <div 
          className="flex items-center gap-6 p-4 max-w-full max-h-full transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center'
          }}
        >
          {/* Left: Original Image */}
          <div className="relative flex flex-col items-center">
            <span className="text-xs font-bold text-slate-400 mb-2 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-800">
              Original Sharp Photo
            </span>
            <img
              src={activeImage.streamUrl}
              alt="Original"
              className="max-h-[72vh] max-w-[34vw] object-contain rounded-xl shadow-2xl border border-slate-800"
            />
          </div>

          {/* Right: Blur Applied */}
          <div className="relative flex flex-col items-center">
            <span className="text-xs font-bold text-amber-400 mb-2 px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              Selective Blur Applied
            </span>
            <canvas
              ref={sideBlurCanvasRef}
              className="max-h-[72vh] max-w-[34vw] object-contain rounded-xl shadow-2xl border border-amber-500/40"
            />
          </div>
        </div>
      ) : (
        /* Standard Viewport Mode (Selective Blur Applied vs Original) */
        <div
          className="relative transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center'
          }}
        >
          {/* Base Sharp Image (Reference for dimensions) */}
          <img
            ref={imageRef}
            src={activeImage.streamUrl}
            alt={activeImage.filename}
            crossOrigin="anonymous"
            className="max-h-[82vh] max-w-[70vw] object-contain rounded shadow-2xl block select-none pointer-events-none opacity-0"
            onLoad={() => {
              if (blurCanvasRef.current) renderBlurCanvas(blurCanvasRef.current);
            }}
          />

          {/* Original Image Layer (Shown when Peeking / Original mode) */}
          <img
            src={activeImage.streamUrl}
            alt="Original Sharp"
            className={`absolute inset-0 w-full h-full object-contain rounded select-none pointer-events-none shadow-2xl transition-opacity duration-150 ${
              isShowingOriginal ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {/* Selective Blur Applied Canvas Layer */}
          {!isShowingOriginal && (
            <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
              <canvas
                ref={blurCanvasRef}
                className="w-full h-full object-contain rounded shadow-2xl"
              />
            </div>
          )}

          {/* Interactive SVG Grid Overlay */}
          {gridOverlayVisible && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              viewBox={`0 0 ${cols} ${rows}`}
              preserveAspectRatio="none"
            >
              {/* Grid Mesh Pattern */}
              <defs>
                <pattern id="gridPattern" width="1" height="1" patternUnits="userSpaceOnUse">
                  <path
                    d="M 1 0 L 0 0 0 1"
                    fill="none"
                    strokeWidth="0.035"
                    style={{ stroke: 'color-mix(in oklab, var(--color-accent) 16%, transparent)' }}
                  />
                </pattern>
              </defs>
              <rect width={cols} height={rows} fill="url(#gridPattern)" />

              {/* Selected / Painted Grid Cells */}
              {Array.from(selectedGridCells).map((cellKey) => {
                const [c, r] = cellKey.split('_').map(Number);
                return (
                  <rect
                    key={cellKey}
                    x={c}
                    y={r}
                    width="1"
                    height="1"
                    strokeWidth="0.04"
                    className="cell-selected"
                    style={{
                      fill: 'color-mix(in oklab, var(--color-accent) 26%, transparent)',
                      stroke: 'color-mix(in oklab, var(--color-accent) 70%, transparent)'
                    }}
                  />
                );
              })}

              {/* Hovered Cell Preview */}
              {hoveredCell && activeTool === 'grid-toggle' && (
                <rect
                  x={hoveredCell.col}
                  y={hoveredCell.row}
                  width="1"
                  height="1"
                  strokeWidth="0.06"
                  style={
                    selectedGridCells.has(`${hoveredCell.col}_${hoveredCell.row}`)
                      ? {
                          fill: 'color-mix(in oklab, var(--color-state-danger) 38%, transparent)',
                          stroke: 'var(--color-state-danger)'
                        }
                      : {
                          fill: 'color-mix(in oklab, var(--color-accent) 42%, transparent)',
                          stroke: 'var(--color-accent-strong)'
                        }
                  }
                />
              )}
            </svg>
          )}

          {/* Ellipse Targets & VIP Exclusion Interactive Handles Layer */}
          <svg
            className="absolute inset-0 w-full h-full z-20 pointer-events-auto"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            {targets.map((t, idx) => {
              const isSelected = selectedTargetIndex === idx;
              return (
                <g key={idx} className="cursor-move">
                  <ellipse
                    cx={t.cx}
                    cy={t.cy}
                    rx={t.rx}
                    ry={t.ry}
                    strokeWidth={isSelected ? '0.004' : '0.002'}
                    strokeDasharray={isSelected ? 'none' : '0.008 0.004'}
                    style={
                      isSelected
                        ? {
                            fill: 'color-mix(in oklab, var(--color-accent) 20%, transparent)',
                            stroke: 'var(--color-accent-strong)'
                          }
                        : {
                            fill: 'color-mix(in oklab, var(--color-accent) 8%, transparent)',
                            stroke: 'color-mix(in oklab, var(--color-accent) 65%, transparent)'
                          }
                    }
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedTargetIndex(idx);
                      setSelectedExclusionIndex(null);
                      setActiveTool('ellipse');
                      const coords = getImageCoords(e);
                      if (coords) {
                        setDraggingTarget({
                          index: idx,
                          type: 'move',
                          startX: coords.x,
                          startY: coords.y,
                          origCx: t.cx,
                          origCy: t.cy,
                          origRx: t.rx,
                          origRy: t.ry
                        });
                      }
                    }}
                  />

                  {/* Center Target Pin */}
                  <circle
                    cx={t.cx}
                    cy={t.cy}
                    r="0.006"
                    strokeWidth="0.002"
                    style={{ fill: 'var(--color-accent-strong)', stroke: 'var(--color-surface-canvas)' }}
                  />

                  {/* Resize Horizontal Handle */}
                  {isSelected && (
                    <circle
                      cx={t.cx + t.rx}
                      cy={t.cy}
                      r="0.007"
                      strokeWidth="0.002"
                      className="cursor-ew-resize"
                      style={{ fill: 'var(--color-text-primary)', stroke: 'var(--color-accent-strong)' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const coords = getImageCoords(e);
                        if (coords) {
                          setDraggingTarget({
                            index: idx,
                            type: 'resize-rx',
                            startX: coords.x,
                            startY: coords.y,
                            origCx: t.cx,
                            origCy: t.cy,
                            origRx: t.rx,
                            origRy: t.ry
                          });
                        }
                      }}
                    />
                  )}

                  {/* Resize Vertical Handle */}
                  {isSelected && (
                    <circle
                      cx={t.cx}
                      cy={t.cy + t.ry}
                      r="0.007"
                      strokeWidth="0.002"
                      className="cursor-ns-resize"
                      style={{ fill: 'var(--color-text-primary)', stroke: 'var(--color-accent-strong)' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const coords = getImageCoords(e);
                        if (coords) {
                          setDraggingTarget({
                            index: idx,
                            type: 'resize-ry',
                            startX: coords.x,
                            startY: coords.y,
                            origCx: t.cx,
                            origCy: t.cy,
                            origRx: t.rx,
                            origRy: t.ry
                          });
                        }
                      }}
                    />
                  )}
                </g>
              );
            })}

            {/* VIP Exclusion Boxes (Green - 100% sharp subject punchout) */}
            {exclusions.map((box, idx) => {
              const isSelected = selectedExclusionIndex === idx;
              const bx = Math.min(box.x1, box.x2);
              const by = Math.min(box.y1, box.y2);
              const bw = Math.abs(box.x2 - box.x1);
              const bh = Math.abs(box.y2 - box.y1);
              return (
                <g key={`vip-${idx}`}>
                  <rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    strokeWidth={isSelected ? '0.005' : '0.004'}
                    strokeDasharray={isSelected ? 'none' : '0.01 0.005'}
                    className="cursor-move"
                    style={{
                      fill: `color-mix(in oklab, var(--color-state-success) ${isSelected ? 32 : 20}%, transparent)`,
                      stroke: 'var(--color-state-success)'
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedExclusionIndex(idx);
                      setSelectedTargetIndex(null);
                      setActiveTool('vip-box');
                      const coords = getImageCoords(e);
                      if (coords) {
                        setDraggingExclusion({
                          index: idx,
                          handle: 'move',
                          startX: coords.x,
                          startY: coords.y,
                          origBox: box
                        });
                      }
                    }}
                  />

                  {/* Resize Handle (bottom-right corner) */}
                  {isSelected && (
                    <circle
                      cx={bx + bw}
                      cy={by + bh}
                      r="0.007"
                      strokeWidth="0.002"
                      className="cursor-nwse-resize"
                      style={{ fill: 'var(--color-text-primary)', stroke: 'var(--color-state-success)' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const coords = getImageCoords(e);
                        if (coords) {
                          setDraggingExclusion({
                            index: idx,
                            handle: 'resize-br',
                            startX: coords.x,
                            startY: coords.y,
                            origBox: box
                          });
                        }
                      }}
                    />
                  )}
                </g>
              );
            })}

            {/* Drag-creation preview */}
            {creatingTarget && (
              <ellipse
                cx={(creatingTarget.startX + creatingTarget.currentX) / 2}
                cy={(creatingTarget.startY + creatingTarget.currentY) / 2}
                rx={Math.abs(creatingTarget.currentX - creatingTarget.startX) / 2}
                ry={Math.abs(creatingTarget.currentY - creatingTarget.startY) / 2}
                strokeWidth="0.004"
                style={{
                  fill: 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
                  stroke: 'var(--color-accent-strong)'
                }}
              />
            )}
          </svg>
        </div>
      )}

      {/* Floating Canvas Contextual Capsule (Bottom Center) */}
      {/* The capsule is an overlay that visually sits ON TOP of the image, so its
          screen position is still geometrically within the image's own bounding
          rect — a coordinate-bounds check alone can't tell a capsule click from an
          image click. Stop propagation here so clicks on any capsule control
          (checkbox, button, input) never reach the container's onMouseDown and get
          misread as the start of a new paint/create interaction. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 glass-capsule rounded-panel shadow-2xl px-3 py-2.5 flex items-center gap-2.5 z-30 max-w-[92vw] overflow-x-auto">
        {/* TOOL CLUSTER */}
        <div className="control-group flex items-center gap-1 shrink-0 p-1">
          <button
            onClick={() => setActiveTool('grid-toggle')}
            className={`tool-pill p-2 ${activeTool === 'grid-toggle' ? 'on' : ''}`}
            title="Grid Tool"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTool('ellipse')}
            className={`tool-pill p-2 ${activeTool === 'ellipse' ? 'on' : ''}`}
            title="Ellipse Tool"
          >
            <CircleDot className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTool('vip-box')}
            className={`tool-pill p-2 ${activeTool === 'vip-box' ? 'on' : ''}`}
            title="VIP Protect Tool"
          >
            <Shield className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActiveTool('pan')}
            className={`tool-pill p-2 ${activeTool === 'pan' ? 'on' : ''}`}
            title="Pan Tool"
          >
            <Move className="w-4 h-4" />
          </button>
        </div>

        {/* CONTEXTUAL SECTION */}
        <div className="control-group flex items-center gap-2.5 shrink-0 px-2.5 py-1.5">
          {activeTool === 'ellipse' && selectedTarget ? (
            <>
              <input
                type="text"
                value={selectedTarget.label}
                onChange={(e) =>
                  setTargets((prev) =>
                    prev.map((t, i) => (i === selectedTargetIndex ? { ...t, label: e.target.value } : t))
                  )
                }
                className="glass-input px-2 py-1 text-xs w-28"
                placeholder="Label"
              />
              {['cx', 'cy', 'rx'].map((field) => (
                <div key={field} className="flex items-center gap-1">
                  <span className="text-[10px] uppercase text-text-muted">{field}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={(selectedTarget[field] * 100).toFixed(1)}
                    onChange={(e) => {
                      const raw = Number(e.target.value) / 100;
                      let value = raw;
                      if (field === 'cx' || field === 'cy') {
                        value = Math.max(0, Math.min(1, raw));
                      } else if (field === 'rx') {
                        value = Math.max(0.005, Math.min(0.5, raw));
                      }
                      setTargets((prev) =>
                        prev.map((t, i) => (i === selectedTargetIndex ? { ...t, [field]: value } : t))
                      );
                    }}
                    className="glass-input px-1.5 py-1 text-xs w-14"
                  />
                </div>
              ))}

              {/* Per-segment blur override — ticked (default) means this region uses the
                  global Blur/Feather sliders; unticking reveals its own values instead. */}
              <label
                className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer select-none whitespace-nowrap"
                title="Use the global Blur/Feather sliders for this region"
              >
                <input
                  type="checkbox"
                  checked={selectedTarget.useGlobalBlur !== false}
                  onChange={(e) => {
                    const useGlobal = e.target.checked;
                    setTargets((prev) =>
                      prev.map((t, i) => {
                        if (i !== selectedTargetIndex) return t;
                        if (useGlobal) return { ...t, useGlobalBlur: true };
                        return {
                          ...t,
                          useGlobalBlur: false,
                          blurRadius: t.blurRadius ?? blurRadius,
                          featherRadius: t.featherRadius ?? featherRadius
                        };
                      })
                    );
                  }}
                  style={{ accentColor: 'var(--color-accent)' }}
                  className="w-3.5 h-3.5 cursor-pointer"
                />
                Global
              </label>
              {selectedTarget.useGlobalBlur === false && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase text-text-muted">Blur</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={selectedTarget.blurRadius ?? blurRadius}
                      onChange={(e) => {
                        const value = Math.max(0, Number(e.target.value));
                        setTargets((prev) =>
                          prev.map((t, i) => (i === selectedTargetIndex ? { ...t, blurRadius: value } : t))
                        );
                      }}
                      title="Blur radius for this region only"
                      className="glass-input px-1.5 py-1 text-xs w-12"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase text-text-muted">Feather</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={selectedTarget.featherRadius ?? featherRadius}
                      onChange={(e) => {
                        const value = Math.max(0, Number(e.target.value));
                        setTargets((prev) =>
                          prev.map((t, i) => (i === selectedTargetIndex ? { ...t, featherRadius: value } : t))
                        );
                      }}
                      title="Feather radius for this region only"
                      className="glass-input px-1.5 py-1 text-xs w-12"
                    />
                  </div>
                </>
              )}

              <button
                onClick={handleAddRegion}
                className="glass-btn p-1.5"
                title="Add Another Region"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setTargets((prev) => prev.filter((_, i) => i !== selectedTargetIndex));
                  setSelectedTargetIndex(null);
                }}
                className="glass-btn p-1.5"
                title="Delete Region"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : activeTool === 'ellipse' ? (
            <>
              <span className="text-xs text-text-muted whitespace-nowrap">Drag on the photo to create a region</span>
              <button
                onClick={handleAddRegion}
                className="glass-btn pri flex items-center gap-1 px-2.5 py-1 text-xs whitespace-nowrap"
                title="Add Ellipse Region"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Region</span>
              </button>
            </>
          ) : activeTool === 'grid-toggle' ? (
            <>
              <span className="text-[10px] uppercase text-text-muted">Density</span>
              <input
                type="range"
                min="6"
                max="40"
                step="2"
                value={gridDensity}
                onChange={(e) => setGridDensity(Number(e.target.value))}
                className="w-24"
              />
              <span className="mono-font text-xs text-accent-strong w-6 text-center">{gridDensity}</span>
              <span className="text-xs text-text-muted whitespace-nowrap">
                {selectedGridCells.size} tiles painted
              </span>
              <button
                onClick={onConvertGridToTargets}
                disabled={selectedGridCells.size === 0}
                title="Turn every painted tile into its own ellipse blur region"
                className="glass-btn pri px-2.5 py-1 text-xs whitespace-nowrap"
              >
                Convert to regions
              </button>
              <button
                onClick={() => setSelectedGridCells(new Set())}
                disabled={selectedGridCells.size === 0}
                title="Unpaint all grid tiles without deleting any regions"
                className="glass-btn px-2.5 py-1 text-xs whitespace-nowrap"
              >
                Clear tiles
              </button>
            </>
          ) : activeTool === 'vip-box' && selectedExclusion ? (
            <>
              <input
                type="text"
                value={selectedExclusion.label || ''}
                onChange={(e) =>
                  setExclusions((prev) =>
                    prev.map((b, i) => (i === selectedExclusionIndex ? { ...b, label: e.target.value } : b))
                  )
                }
                className="glass-input px-2 py-1 text-xs w-28"
                placeholder="Label"
              />
              {['x1', 'y1', 'x2', 'y2'].map((field) => (
                <div key={field} className="flex items-center gap-1">
                  <span className="text-[10px] uppercase text-text-muted">{field}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={(selectedExclusion[field] * 100).toFixed(1)}
                    onChange={(e) => {
                      const value = Math.max(0, Math.min(1, Number(e.target.value) / 100));
                      setExclusions((prev) =>
                        prev.map((b, i) => (i === selectedExclusionIndex ? { ...b, [field]: value } : b))
                      );
                    }}
                    className="glass-input px-1.5 py-1 text-xs w-14"
                  />
                </div>
              ))}
              <button
                onClick={handleAddVipArea}
                className="glass-btn p-1.5"
                title="Add Another VIP Area"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setExclusions((prev) => prev.filter((_, i) => i !== selectedExclusionIndex));
                  setSelectedExclusionIndex(null);
                }}
                className="glass-btn p-1.5"
                title="Delete VIP Area"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : activeTool === 'vip-box' ? (
            <>
              <span className="text-xs text-text-muted whitespace-nowrap">
                Drag on the photo to protect a subject
                {exclusions.length > 0 && (
                  <span className="text-accent-strong font-semibold"> · {exclusions.length} protected</span>
                )}
              </span>
              <button
                onClick={handleAddVipArea}
                className="glass-btn pri flex items-center gap-1 px-2.5 py-1 text-xs whitespace-nowrap"
                title="Add VIP Area"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add VIP Area</span>
              </button>
            </>
          ) : (
            /* activeTool === 'pan' : Zoom Controls (relocated, unchanged logic) */
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
                className="p-1.5 hover:bg-surface-raised text-text-secondary hover:text-text-primary rounded-control transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <span className="mono-font text-xs font-semibold text-accent-strong min-w-[45px] text-center">
                {Math.round(zoom * 100)}%
              </span>

              <button
                onClick={() => setZoom((z) => Math.min(4, z + 0.2))}
                className="p-1.5 hover:bg-surface-raised text-text-secondary hover:text-text-primary rounded-control transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="px-2.5 py-1 hover:bg-surface-raised text-text-secondary hover:text-text-primary rounded-control text-xs font-medium transition-colors"
                title="Reset Zoom & Pan"
              >
                Fit
              </button>
            </div>
          )}
        </div>

        {/* ALWAYS-VISIBLE RIGHT SECTION */}
        <div className="control-group flex items-center gap-2.5 shrink-0 px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-text-muted">Blur</span>
            <input
              type="range"
              min="2"
              max="35"
              value={blurRadius}
              onChange={(e) => setBlurRadius(Number(e.target.value))}
              className="w-16"
            />
            <span className="mono-font text-xs text-accent-strong w-6 text-center">{blurRadius}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-text-muted">Feather</span>
            <input
              type="range"
              min="0"
              max="25"
              value={featherRadius}
              onChange={(e) => setFeatherRadius(Number(e.target.value))}
              className="w-16"
            />
            <span className="mono-font text-xs text-accent-strong w-6 text-center">{featherRadius}</span>
          </div>

          {/* Instant Peek Original Button (Hold or Click) */}
          <button
            onMouseDown={() => setIsPeekingOriginal(true)}
            onMouseUp={() => setIsPeekingOriginal(false)}
            onMouseLeave={() => setIsPeekingOriginal(false)}
            onClick={() => setViewMode(viewMode === 'original' ? 'blur-applied' : 'original')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-xs font-medium transition-all ${
              isShowingOriginal
                ? 'bg-accent text-surface-canvas font-bold shadow-sm'
                : 'bg-surface-raised/80 hover:bg-surface-raised text-text-secondary hover:text-text-primary'
            }`}
            title="Hold Spacebar or Click to Peek Original Sharp Photo"
          >
            {isShowingOriginal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{isShowingOriginal ? 'Original Photo' : 'Peek Original (Space)'}</span>
          </button>

          {/* Grid Overlay Quick Toggle */}
          <button
            onClick={() => setGridOverlayVisible(!gridOverlayVisible)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-xs font-medium transition-all ${
              gridOverlayVisible
                ? 'bg-accent/15 text-accent-strong border border-accent/40'
                : 'bg-surface-raised/60 hover:bg-surface-raised text-text-muted hover:text-text-secondary'
            }`}
            title="Toggle Grid Lines (G)"
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Grid {gridOverlayVisible ? 'ON' : 'OFF'}</span>
          </button>

          {/* View Mode Segmented Control */}
          <div className="ios-segment">
            {[
              { key: 'blur-applied', label: 'Blurred', title: 'Preview with all blur regions applied' },
              { key: 'original', label: 'Original', title: 'Show the untouched source photo' },
              { key: 'side-by-side', label: 'Split', title: 'Show original and blurred side by side' },
              { key: 'mask', label: 'Mask', title: 'Show the raw blur mask (white = blurred area)' }
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setViewMode(opt.key)}
                title={opt.title}
                className={`ios-segment-btn text-[11px] ${viewMode === opt.key ? 'on' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hover-coordinate readout — always mounted with a fixed min-width and
            toggled via opacity (not conditional rendering) so the capsule's own
            width never shifts as the mouse moves or coordinates change digits.
            An unstable capsule width was racing clicks on adjacent buttons
            (e.g. Delete Region) against the capsule's backdrop-filter reflow. */}
        <div className="w-px h-6 bg-border-default shrink-0" />
        <div
          className={`text-[11px] mono-font text-text-muted flex items-center gap-2 whitespace-nowrap shrink-0 min-w-[180px] transition-opacity ${
            hoveredCell ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="text-accent-strong font-semibold">
            [{hoveredCell ? hoveredCell.col : 0}, {hoveredCell ? hoveredCell.row : 0}]
          </span>
          <span>
            X: {hoveredCell ? (hoveredCell.x * 100).toFixed(1) : '0.0'}% Y: {hoveredCell ? (hoveredCell.y * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>
    </div>
  );
}
