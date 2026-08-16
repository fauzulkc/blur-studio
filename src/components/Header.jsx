import React, { useState, useEffect } from 'react';
import {
  Folder, FolderOpen, Save, Layers, Code, Play, CheckCircle2,
  Settings, HelpCircle, RefreshCw, Sparkles, Sliders, ArrowRight,
  FolderSync, ShieldCheck, Check, ChevronDown, Download, Undo2, Redo2
} from 'lucide-react';

export default function Header({
  sourceFolder,
  setSourceFolder,
  onScanFolder,
  presets,
  destinationMode,
  setDestinationMode,
  destinationFolder,
  setDestinationFolder,
  onApplyActive,
  onOpenBatchModal,
  onOpenPythonModal,
  activeImage,
  isProcessing,
  totalImagesCount,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  lastAppliedOutput
}) {
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);
  const [folderInput, setFolderInput] = useState(sourceFolder);
  const [destInput, setDestInput] = useState(destinationFolder);

  useEffect(() => {
    setFolderInput(sourceFolder);
  }, [sourceFolder]);

  useEffect(() => {
    setDestInput(destinationFolder);
  }, [destinationFolder]);

  const handleFolderSubmit = (e) => {
    e.preventDefault();
    if (folderInput.trim()) {
      onScanFolder(folderInput.trim());
    }
  };

  const handlePresetSelect = (presetPath) => {
    setFolderInput(presetPath);
    onScanFolder(presetPath);
    setShowPresetsDropdown(false);
  };

  return (
    <header className="h-16 glass-panel px-4 flex items-center justify-between gap-3 z-30 shrink-0 select-none">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-panel bg-gradient-to-tr from-accent to-accent-strong p-[1px] shadow-lg shadow-accent/20">
          <div className="w-full h-full bg-surface-canvas rounded-[11px] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-accent-strong" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-text-primary">
              Blur Studio
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary border border-border-default">
              Pro v1.0
            </span>
          </div>
          <p className="text-xs text-text-secondary">Precision Privacy &amp; Face Blurring</p>
        </div>
      </div>

      {/* Center: Source Folder & Destination Selector */}
      <div className="flex items-center gap-2 flex-1 max-w-3xl justify-center">
        {/* Source Folder */}
        <div className="relative flex-1 max-w-md">
          <form onSubmit={handleFolderSubmit} className="flex items-center">
            <div className="relative w-full flex items-center">
              <div className="absolute left-2.5 text-text-secondary pointer-events-none">
                <FolderOpen className="w-4 h-4 text-accent" />
              </div>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="Enter image source folder path..."
                className="w-full pl-9 pr-24 py-1.5 text-xs glass-input placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 transition-colors mono-font"
              />
              <div className="absolute right-1 flex items-center gap-1">
                <button
                  type="submit"
                  title="Scan / Load Directory"
                  className="px-2 py-1 glass-btn text-[11px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                  className="p-1 glass-btn transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  title="Quick Presets"
                  aria-label="Quick Presets"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${showPresetsDropdown ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </form>

          {/* Presets Dropdown */}
          {showPresetsDropdown && (
            <div className="absolute left-0 top-full mt-1.5 w-full glass-panel rounded-panel shadow-2xl p-1.5 z-50 origin-top animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-2 py-1">
                Quick Presets
              </div>
              <div className="space-y-0.5">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePresetSelect(p.path)}
                    title={`Load ${p.path}`}
                    className="w-full text-left px-2.5 py-1.5 rounded-control text-xs hover:bg-accent/10 hover:text-accent-strong text-text-secondary flex items-center justify-between group transition-colors"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[10px] text-text-muted group-hover:text-accent/70 mono-font truncate max-w-[200px]">
                      {p.path.split('/').slice(-2).join('/')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-text-muted shrink-0" />

        {/* Destination Mode Selector */}
        <div className="ios-segment shrink-0">
          <button
            type="button"
            onClick={() => setDestinationMode('separate_folder')}
            title="Write blurred photos to a separate output folder — originals are never touched"
            className={`ios-segment-btn text-xs font-medium transition-all ${
              destinationMode === 'separate_folder'
                ? 'on'
                : ''
            }`}
          >
            Export Folder
          </button>
          <button
            type="button"
            onClick={() => setDestinationMode('replace')}
            className={`ios-segment-btn text-xs font-medium transition-all ${
              destinationMode === 'replace'
                ? 'danger on'
                : ''
            }`}
            title="Overwrite original images in-place (creates .bak backup)"
          >
            Replace In-Place
          </button>
        </div>

        {/* Export Folder Input (if separate folder selected) */}
        {destinationMode === 'separate_folder' && (
          <div className="w-56 shrink-0 relative">
            <input
              type="text"
              value={destInput}
              onChange={(e) => {
                setDestInput(e.target.value);
                setDestinationFolder(e.target.value);
              }}
              placeholder="Output folder path..."
              className="w-full px-2.5 py-1.5 text-[11px] glass-input placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 transition-colors mono-font"
            />
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 bg-surface-recessed rounded-control p-0.5 mr-1" style={{boxShadow: 'inset 0 1px 2px rgba(0,0,0,.35)'}}>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo (Ctrl+Z)"
            className="p-1.5 glass-btn rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo (Ctrl+Shift+Z)"
            className="p-1.5 glass-btn rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Python Config Export */}
        <button
          type="button"
          onClick={onOpenPythonModal}
          className="flex items-center gap-1.5 px-3 py-1.5 glass-btn rounded-control text-xs font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          title="View and copy generated Python script configuration"
        >
          <Code className="w-3.5 h-3.5 text-state-info" />
          <span>Python Code</span>
        </button>

        {/* Process Active Photo */}
        <button
          type="button"
          onClick={onApplyActive}
          disabled={!activeImage || isProcessing}
          title="Blur the currently open photo using its saved regions"
          className="flex items-center gap-1.5 px-3.5 py-1.5 glass-btn pri rounded-control text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          {isProcessing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span>Apply Active</span>
        </button>

        {/* Download the just-processed active photo */}
        {lastAppliedOutput && activeImage && lastAppliedOutput.filename === activeImage.filename && (
          <a
            href={`/api/download?path=${encodeURIComponent(lastAppliedOutput.path)}`}
            className="flex items-center gap-1.5 px-3.5 py-1.5 glass-btn rounded-control text-xs transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            title="Download the blurred photo"
          >
            <Download className="w-3.5 h-3.5 text-state-success" />
            <span>Download</span>
          </a>
        )}

        {/* Batch Process All */}
        <button
          type="button"
          onClick={onOpenBatchModal}
          disabled={totalImagesCount === 0}
          title="Open batch processing to blur every photo in the folder at once"
          className="flex items-center gap-1.5 px-3.5 py-1.5 glass-btn rounded-control text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Batch All ({totalImagesCount})</span>
        </button>
      </div>
    </header>
  );
}
