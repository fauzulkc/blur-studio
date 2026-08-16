import React, { useState } from 'react';
import {
  X, Play, CheckCircle2, AlertCircle, RefreshCw,
  FolderOutput, ShieldAlert, FileText, Check, Download
} from 'lucide-react';
import { buildCombinedTargets } from '../utils/gridBlur.js';

export default function BatchModal({
  isOpen,
  onClose,
  images,
  targetsMap,
  exclusionsMap,
  gridSettingsMap,
  sourceFolder,
  destinationMode,
  destinationFolder,
  blurRadius,
  featherRadius,
  onRunBatchComplete
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLog, setStatusLog] = useState([]);
  const [batchDone, setBatchDone] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  if (!isOpen) return null;

  // Filter only images that have configured targets, exclusions, or painted grid tiles
  const configuredItems = images.filter((img) => {
    const t = targetsMap[img.filename] || img.targets || [];
    const e = exclusionsMap[img.filename] || img.exclusions || [];
    const grid = gridSettingsMap[img.filename];
    const hasGrid = grid && grid.blurEnabled && grid.cells && grid.cells.size > 0;
    return t.length > 0 || e.length > 0 || hasGrid;
  });

  const handleStartBatch = async () => {
    setIsProcessing(true);
    setProgress(0);
    setStatusLog([]);
    setBatchDone(false);

    try {
      const itemsToProcess = images.map((img) => {
        const baseTargets = targetsMap[img.filename] || img.targets || [];
        return {
          inputPath: img.fullPath,
          targets: buildCombinedTargets(img, baseTargets, gridSettingsMap[img.filename]),
          exclusions: exclusionsMap[img.filename] || img.exclusions || []
        };
      });

      const res = await fetch('/api/apply-blur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itemsToProcess,
          blurRadius,
          featherRadius,
          destinationMode,
          destinationFolder,
          makeBackup: true
        })
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.processed)) {
        setStatusLog(data.processed);
        setProgress(100);
        setBatchDone(true);
        if (onRunBatchComplete) onRunBatchComplete(data.processed);
      } else {
        alert('Batch processing error: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Failed to execute batch: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadAll = async () => {
    const paths = statusLog.filter((log) => log.success && log.output).map((log) => log.output);
    if (paths.length === 0) return;

    setIsZipping(true);
    try {
      const res = await fetch('/api/download-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to build zip archive');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'blurred-photos.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to download zip: ' + err.message);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-recessed border border-border-subtle rounded-modal w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-control bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Play className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Batch Blur Processing</h3>
              <p className="text-xs text-text-secondary">Process all {images.length} images in folder</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            title="Close"
            aria-label="Close"
            className="p-1.5 text-text-secondary hover:text-text-primary rounded-control hover:bg-surface-raised transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {/* Settings Summary Card */}
          <div className="p-3.5 rounded-panel bg-surface-canvas border border-border-subtle space-y-2 text-xs">
            <div className="flex items-center justify-between text-text-secondary">
              <span className="text-text-secondary">Source Directory:</span>
              <span className="mono-font text-text-primary truncate max-w-xs">{sourceFolder}</span>
            </div>

            <div className="flex items-center justify-between text-text-secondary">
              <span className="text-text-secondary">Destination:</span>
              <span className={`font-semibold ${destinationMode === 'replace' ? 'text-state-danger' : 'text-state-success'}`}>
                {destinationMode === 'replace' ? 'In-Place Overwrite (.bak backup)' : `Export to: ${destinationFolder}`}
              </span>
            </div>

            <div className="flex items-center justify-between text-text-secondary">
              <span className="text-text-secondary">Total Images:</span>
              <span>{images.length} photos ({configuredItems.length} with active blur targets)</span>
            </div>

            <div className="flex items-center justify-between text-text-secondary">
              <span className="text-text-secondary">Blur Settings:</span>
              <span>Gaussian {blurRadius}px | Feather {featherRadius}px</span>
            </div>
          </div>

          {destinationMode === 'replace' && (
            <div className="p-3 rounded-panel bg-state-danger/10 border border-state-danger/30 flex items-start gap-2.5 text-xs text-state-danger">
              <ShieldAlert className="w-4 h-4 text-state-danger shrink-0 mt-0.5" />
              <span>
                <strong>Safety Note:</strong> Replacing in-place will overwrite original files, but a <code className="text-state-danger">.bak</code> backup file will be created automatically for every altered photo.
              </span>
            </div>
          )}

          {/* Progress / Status Logs */}
          {statusLog.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-secondary">Batch Processing Results:</label>
              <div className="max-h-48 overflow-y-auto p-2 bg-surface-canvas rounded-panel border border-border-subtle text-xs space-y-1 mono-font">
                {statusLog.map((log, i) => (
                  <div key={i} className="flex items-center justify-between text-text-secondary py-0.5">
                    <span className="text-text-primary truncate">{log.image}</span>
                    {log.success ? (
                      <span className="text-state-success flex items-center gap-1 shrink-0">
                        <Check className="w-3 h-3" />
                        {log.targets_count} blurred
                      </span>
                    ) : (
                      <span className="text-state-danger shrink-0">{log.error || 'Failed'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-recessed/80 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={isProcessing}
            title={batchDone ? 'Close this dialog' : 'Cancel and close this dialog'}
            className="px-3 py-1.5 hover:bg-surface-raised text-text-secondary hover:text-text-primary rounded-control text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            {batchDone ? 'Close' : 'Cancel'}
          </button>

          <div className="flex items-center gap-2">
            {batchDone && statusLog.some((log) => log.success) && (
              <button
                onClick={handleDownloadAll}
                disabled={isZipping}
                title="Download every successfully-processed photo as one ZIP file"
                className="flex items-center gap-2 px-4 py-2 glass-btn rounded-panel text-xs font-medium transition-all disabled:opacity-50 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {isZipping ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 text-state-success" />
                )}
                <span>Download All (ZIP)</span>
              </button>
            )}

            <button
              onClick={handleStartBatch}
              disabled={isProcessing}
              title={batchDone ? 'Run batch processing again with the current settings' : 'Process every photo in the folder with its saved regions'}
              className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-strong text-surface-canvas font-bold rounded-panel text-xs transition-all shadow-lg shadow-accent/30 disabled:opacity-50 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Photos...</span>
                </>
              ) : batchDone ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Re-run Batch Process</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start Batch Processing ({images.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
