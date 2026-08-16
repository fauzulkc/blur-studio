import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header.jsx';
import CanvasStudio from './components/CanvasStudio.jsx';
import Dock from './components/Dock.jsx';
import PythonExportModal from './components/PythonExportModal.jsx';
import BatchModal from './components/BatchModal.jsx';
import { defaultGridSettings, buildCombinedTargets, computeGridDimensions } from './utils/gridBlur.js';

export default function App() {
  // Folder & destination state
  const [sourceFolder, setSourceFolder] = useState('./sample-photos');
  const [destinationMode, setDestinationMode] = useState('separate_folder'); // 'replace' | 'separate_folder'
  const [destinationFolder, setDestinationFolder] = useState('./sample-photos-blurred');
  const [presets, setPresets] = useState([]);

  // Images state
  const [images, setImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  // Targets & exclusions database maps
  const [targetsMap, setTargetsMap] = useState({});
  const [exclusionsMap, setExclusionsMap] = useState({});

  // Tool & Canvas state
  const [activeTool, setActiveTool] = useState('grid-toggle'); // 'grid-toggle' | 'ellipse' | 'vip-box' | 'pan'
  const [viewMode, setViewMode] = useState('blur-applied'); // 'blur-applied' | 'original' | 'side-by-side' | 'mask'
  const [isPeekingOriginal, setIsPeekingOriginal] = useState(false);

  // Grid states — gridOverlayVisible is a view preference (global); density, blur-enabled
  // and painted cells are per-image data, keyed by filename, so each image keeps its own grid.
  const [gridOverlayVisible, setGridOverlayVisible] = useState(true);
  const [gridSettingsMap, setGridSettingsMap] = useState({});
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(null);
  const [selectedExclusionIndex, setSelectedExclusionIndex] = useState(null);

  // Blur parameters
  const [blurRadius, setBlurRadius] = useState(13.0);
  const [featherRadius, setFeatherRadius] = useState(14.0);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  // { filename, path } of the most recently blurred output — powers the single-file
  // Download button, which only shows once the *currently active* image matches it.
  const [lastAppliedOutput, setLastAppliedOutput] = useState(null);

  // Modals
  const [isPythonModalOpen, setIsPythonModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

  // Undo/redo history — snapshots of the editable document (targets, exclusions, grid
  // paint) across all images. isMutationBurstRef coalesces a drag or a multi-step action
  // (e.g. Convert Grid to Ellipses) into a single history entry instead of one per tick.
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const isMutationBurstRef = useRef(false);

  const activeImage = images[selectedIndex] || null;
  const currentTargets = activeImage ? (targetsMap[activeImage.filename] || []) : [];
  const currentExclusions = activeImage ? (exclusionsMap[activeImage.filename] || []) : [];
  const activeGridSettings = activeImage ? (gridSettingsMap[activeImage.filename] || defaultGridSettings()) : defaultGridSettings();
  const { density: gridDensity, blurEnabled: gridBlurEnabled, cells: selectedGridCells } = activeGridSettings;

  // Fetch presets on mount
  useEffect(() => {
    fetch('/api/presets')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.presets)) {
          setPresets(data.presets);
        }
      })
      .catch((e) => console.error(e));

    // Load initial default folder
    handleScanFolder(sourceFolder);
  }, []);

  // Scan folder function
  const handleScanFolder = async (folderPath) => {
    setIsLoadingImages(true);
    setStatusMessage({ type: 'info', text: `Scanning ${folderPath}...` });

    try {
      const res = await fetch('/api/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.images)) {
        setSourceFolder(data.folderPath);
        setImages(data.images);
        setSelectedIndex(0);

        // Load targets maps
        const newTargets = {};
        const newExclusions = {};
        data.images.forEach((img) => {
          if (img.targets) newTargets[img.filename] = img.targets;
          if (img.exclusions) newExclusions[img.filename] = img.exclusions;
        });
        setTargetsMap((prev) => ({ ...prev, ...newTargets }));
        setExclusionsMap((prev) => ({ ...prev, ...newExclusions }));
        setPast([]);
        setFuture([]);
        isMutationBurstRef.current = false;

        if (data.config) {
          if (data.config.blurRadius) setBlurRadius(data.config.blurRadius);
          if (data.config.featherRadius) setFeatherRadius(data.config.featherRadius);
          if (data.config.destinationMode) setDestinationMode(data.config.destinationMode);
          if (data.config.lastDestinationFolder) setDestinationFolder(data.config.lastDestinationFolder);
        }

        setStatusMessage({ type: 'success', text: `Loaded ${data.images.length} images from folder` });
      } else {
        alert(data.error || 'Failed to scan directory');
      }
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Error connecting to server' });
    } finally {
      setIsLoadingImages(false);
    }
  };

  // Snapshot the document (targets/exclusions/grid, all images) once per edit "burst" —
  // a drag or a multi-setter action is one undo step, not one per intermediate update.
  const recordHistoryIfNeeded = () => {
    if (isMutationBurstRef.current) return;
    isMutationBurstRef.current = true;
    setPast((p) => [...p, { targetsMap, exclusionsMap, gridSettingsMap }]);
    setFuture([]);
  };

  // Update current targets
  const setCurrentTargets = (updater) => {
    if (!activeImage) return;
    recordHistoryIfNeeded();
    setTargetsMap((prev) => {
      const current = prev[activeImage.filename] || [];
      const updated = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeImage.filename]: updated };
    });
  };

  // Update current exclusions
  const setCurrentExclusions = (updater) => {
    if (!activeImage) return;
    recordHistoryIfNeeded();
    setExclusionsMap((prev) => {
      const current = prev[activeImage.filename] || [];
      const updated = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeImage.filename]: updated };
    });
  };

  // Update the active image's grid settings (density / blur-enabled / painted cells)
  const patchActiveGridSettings = (patcher) => {
    if (!activeImage) return;
    recordHistoryIfNeeded();
    setGridSettingsMap((prev) => {
      const current = prev[activeImage.filename] || defaultGridSettings();
      const patch = typeof patcher === 'function' ? patcher(current) : patcher;
      return { ...prev, [activeImage.filename]: { ...current, ...patch } };
    });
  };

  // Undo/redo — restore a full document snapshot; view state (zoom, selection, tool) is untouched
  const undo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture((f) => [{ targetsMap, exclusionsMap, gridSettingsMap }, ...f]);
    setPast((p) => p.slice(0, -1));
    setTargetsMap(previous.targetsMap);
    setExclusionsMap(previous.exclusionsMap);
    setGridSettingsMap(previous.gridSettingsMap);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p, { targetsMap, exclusionsMap, gridSettingsMap }]);
    setFuture((f) => f.slice(1));
    setTargetsMap(next.targetsMap);
    setExclusionsMap(next.exclusionsMap);
    setGridSettingsMap(next.gridSettingsMap);
  };

  // Remove the currently-selected ellipse target (Delete/Backspace shortcut)
  const handleDeleteSelectedTarget = () => {
    if (selectedTargetIndex === null) return;
    setCurrentTargets((prev) => prev.filter((_, i) => i !== selectedTargetIndex));
    setSelectedTargetIndex(null);
  };

  // Remove the currently-selected VIP exclusion box (Delete/Backspace shortcut)
  const handleDeleteSelectedExclusion = () => {
    if (selectedExclusionIndex === null) return;
    setCurrentExclusions((prev) => prev.filter((_, i) => i !== selectedExclusionIndex));
    setSelectedExclusionIndex(null);
  };

  const setGridDensity = (updater) => {
    const resolved = typeof updater === 'function' ? updater(gridDensity) : updater;
    patchActiveGridSettings({ density: resolved });
  };

  const setGridBlurEnabled = (updater) => {
    const resolved = typeof updater === 'function' ? updater(gridBlurEnabled) : updater;
    patchActiveGridSettings({ blurEnabled: resolved });
  };

  const setSelectedGridCells = (updater) => {
    patchActiveGridSettings((current) => ({
      cells: typeof updater === 'function' ? updater(current.cells) : updater
    }));
  };

  // Helper to compile painted grid tiles into ellipse targets
  const handleConvertGridToTargets = () => {
    if (!activeImage || selectedGridCells.size === 0) return;

    const { cols, rows } = computeGridDimensions(gridDensity, activeImage);

    // Convert each connected component / tile cluster or individual tile to ellipse
    const newTargets = [];
    selectedGridCells.forEach((cellKey) => {
      const [c, r] = cellKey.split('_').map(Number);
      const cx = (c + 0.5) / cols;
      const cy = (r + 0.5) / rows;
      const rx = 0.55 / cols;
      const ry = 0.55 / rows;

      newTargets.push({
        cx,
        cy,
        rx: Math.max(0.015, rx),
        ry: Math.max(0.02, ry),
        label: `Grid Tile [${c},${r}]`
      });
    });

    setCurrentTargets((prev) => [...prev, ...newTargets]);
    setSelectedGridCells(new Set());
    setStatusMessage({ type: 'success', text: `Converted ${newTargets.length} painted tiles to face ellipse targets` });
  };

  // Apply blur to active image
  const handleApplyActive = async () => {
    if (!activeImage) return;

    setIsProcessing(true);
    setStatusMessage({ type: 'info', text: `Processing ${activeImage.filename}...` });

    // Combine ellipse targets + this image's own painted grid cells
    const combinedTargets = buildCombinedTargets(activeImage, currentTargets, activeGridSettings);

    try {
      const res = await fetch('/api/apply-blur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              inputPath: activeImage.fullPath,
              targets: combinedTargets,
              exclusions: currentExclusions
            }
          ],
          blurRadius,
          featherRadius,
          destinationMode,
          destinationFolder,
          makeBackup: true
        })
      });

      const data = await res.json();
      if (data.success) {
        const outputPath = data.processed?.[0]?.output;
        setLastAppliedOutput(outputPath ? { filename: activeImage.filename, path: outputPath } : null);

        // Save this image's own targets/exclusions (server keys per-file config by `filename`)
        await fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: activeImage.filename,
            targets: currentTargets,
            exclusions: currentExclusions,
            blurRadius,
            featherRadius,
            destinationMode,
            lastDestinationFolder: destinationFolder
          })
        });

        // In-place mode overwrites the source file on disk — cache-bust just this image's
        // preview so it reflects the new bytes, without touching any other app state.
        if (destinationMode === 'replace') {
          const cacheBust = Date.now();
          setImages((prev) => prev.map((img) =>
            img.filename === activeImage.filename
              ? { ...img, streamUrl: `/raw-image?path=${encodeURIComponent(img.fullPath)}&v=${cacheBust}` }
              : img
          ));
        }

        setStatusMessage({
          type: 'success',
          text: `Successfully processed ${activeImage.filename} (${combinedTargets.length} blurred)`
        });
      } else {
        alert('Failed to process image: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      setStatusMessage({ type: 'error', text: 'Error applying blur' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard navigation & Shortcuts.
  // No dependency array: re-attaches every render so undo/redo/delete/nav always close
  // over current state (past, future, selectedTargetIndex, images) instead of a stale render.
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if inside input field
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const key = e.key.toLowerCase();
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z';
      const isRedo = (e.ctrlKey || e.metaKey) && ((e.shiftKey && key === 'z') || key === 'y');

      if (isUndo) {
        e.preventDefault();
        undo();
      } else if (isRedo) {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTargetIndex !== null) {
        e.preventDefault();
        handleDeleteSelectedTarget();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedExclusionIndex !== null) {
        e.preventDefault();
        handleDeleteSelectedExclusion();
      } else if (e.key === 'ArrowLeft') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setSelectedIndex((prev) => Math.min(images.length - 1, prev + 1));
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPeekingOriginal(true);
      } else if (e.key === 'g' || e.key === 'G') {
        setGridOverlayVisible((prev) => !prev);
      } else if (e.key === '1') {
        setActiveTool('grid-toggle');
      } else if (e.key === '2') {
        setActiveTool('ellipse');
      } else if (e.key === '3') {
        setActiveTool('vip-box');
      } else if (e.key === '4') {
        setActiveTool('pan');
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPeekingOriginal(false);
      }
    };

    // Ends the current drag/action "burst" so the next edit starts a new undo step
    const handleMouseUp = () => {
      isMutationBurstRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-canvas text-text-primary overflow-hidden font-sans select-none">
      {/* Top Navigation & Action Header */}
      <Header
        sourceFolder={sourceFolder}
        setSourceFolder={setSourceFolder}
        onScanFolder={handleScanFolder}
        presets={presets}
        destinationMode={destinationMode}
        setDestinationMode={setDestinationMode}
        destinationFolder={destinationFolder}
        setDestinationFolder={setDestinationFolder}
        onOpenPythonModal={() => setIsPythonModalOpen(true)}
        onOpenBatchModal={() => setIsBatchModalOpen(true)}
        onApplyActive={handleApplyActive}
        isProcessing={isProcessing}
        totalImagesCount={images.length}
        activeImage={activeImage}
        statusMessage={statusMessage}
        lastAppliedOutput={lastAppliedOutput}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Center Canvas Studio */}
        <CanvasStudio
          activeImage={activeImage}
          targets={currentTargets}
          setTargets={setCurrentTargets}
          exclusions={currentExclusions}
          setExclusions={setCurrentExclusions}
          gridDensity={gridDensity}
          gridOverlayVisible={gridOverlayVisible}
          setGridOverlayVisible={setGridOverlayVisible}
          gridBlurEnabled={gridBlurEnabled}
          setGridBlurEnabled={setGridBlurEnabled}
          selectedGridCells={selectedGridCells}
          setSelectedGridCells={setSelectedGridCells}
          activeTool={activeTool}
          viewMode={viewMode}
          setViewMode={setViewMode}
          blurRadius={blurRadius}
          featherRadius={featherRadius}
          selectedTargetIndex={selectedTargetIndex}
          setSelectedTargetIndex={setSelectedTargetIndex}
          selectedExclusionIndex={selectedExclusionIndex}
          setSelectedExclusionIndex={setSelectedExclusionIndex}
          isPeekingOriginal={isPeekingOriginal}
          setIsPeekingOriginal={setIsPeekingOriginal}
          setActiveTool={setActiveTool}
          setBlurRadius={setBlurRadius}
          setFeatherRadius={setFeatherRadius}
          setGridDensity={setGridDensity}
          onConvertGridToTargets={handleConvertGridToTargets}
        />
      </div>

      <Dock
        images={images}
        selectedIndex={selectedIndex}
        onSelectImage={(idx) => setSelectedIndex(idx)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        targetsMap={targetsMap}
        exclusionsMap={exclusionsMap}
        targets={currentTargets}
        setTargets={setCurrentTargets}
        exclusions={currentExclusions}
        setExclusions={setCurrentExclusions}
        selectedTargetIndex={selectedTargetIndex}
        setSelectedTargetIndex={setSelectedTargetIndex}
        selectedExclusionIndex={selectedExclusionIndex}
        setSelectedExclusionIndex={setSelectedExclusionIndex}
        setActiveTool={setActiveTool}
      />

      {/* Modals */}
      <PythonExportModal
        isOpen={isPythonModalOpen}
        onClose={() => setIsPythonModalOpen(false)}
        images={images}
        targetsMap={targetsMap}
        exclusionsMap={exclusionsMap}
        sourceFolder={sourceFolder}
      />

      <BatchModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        images={images}
        targetsMap={targetsMap}
        exclusionsMap={exclusionsMap}
        gridSettingsMap={gridSettingsMap}
        sourceFolder={sourceFolder}
        destinationMode={destinationMode}
        destinationFolder={destinationFolder}
        blurRadius={blurRadius}
        featherRadius={featherRadius}
        onRunBatchComplete={(processed) => {
          setStatusMessage({ type: 'success', text: 'Batch processing complete!' });

          // In-place mode overwrites source files on disk — cache-bust each replaced
          // image's preview in place, without rescanning the folder or resetting anything.
          if (destinationMode === 'replace' && Array.isArray(processed)) {
            const successFilenames = new Set(processed.filter((p) => p.success).map((p) => p.image));
            const cacheBust = Date.now();
            setImages((prev) => prev.map((img) =>
              successFilenames.has(img.filename)
                ? { ...img, streamUrl: `/raw-image?path=${encodeURIComponent(img.fullPath)}&v=${cacheBust}` }
                : img
            ));
          }
        }}
      />
    </div>
  );
}
