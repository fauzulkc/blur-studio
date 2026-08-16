import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Code, FileText, Download } from 'lucide-react';

export default function PythonExportModal({ isOpen, onClose }) {
  const [pythonCode, setPythonCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      fetch('/api/export-python')
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setPythonCode(data.pythonCode);
          }
        })
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pythonCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-surface-canvas/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-recessed border border-border-subtle rounded-modal w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-control bg-state-info/10 border border-state-info/20 flex items-center justify-center text-state-info">
              <Code className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Python Configuration Export</h3>
              <p className="text-xs text-text-secondary">Exact coordinates compatible with batch_privacy_blur.py</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-text-secondary hover:text-text-primary rounded-control hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Code View */}
        <div className="flex-1 p-4 overflow-y-auto bg-surface-canvas">
          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-xs">Generating Python configuration...</div>
          ) : (
            <pre className="text-xs font-mono text-text-secondary leading-relaxed overflow-x-auto select-all">
              {pythonCode}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-recessed/80 flex items-center justify-between">
          <span className="text-xs text-text-muted">
            Paste directly into <code className="text-text-secondary">batch_privacy_blur.py</code> or your deployment scripts.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-strong text-surface-canvas font-bold rounded-panel text-xs transition-all shadow-lg shadow-accent/20 active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              {copied ? <Check className="w-4 h-4 text-surface-canvas" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy Python Code'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
