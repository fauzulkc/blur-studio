import React, { useState } from 'react';
import { Search, X } from 'lucide-react';

export default function Dock({
  images,
  selectedIndex,
  onSelectImage,
  searchQuery,
  setSearchQuery,
  targetsMap,
  exclusionsMap,
  targets,
  setTargets,
  exclusions,
  setExclusions,
  selectedTargetIndex,
  setSelectedTargetIndex,
  selectedExclusionIndex,
  setSelectedExclusionIndex,
  setActiveTool
}) {
  const [activeDockTab, setActiveDockTab] = useState('regions'); // 'regions' | 'photos'
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'has-targets' | 'no-targets'

  const filteredImages = images.filter((img) => {
    const matchesSearch = img.filename.toLowerCase().includes(searchQuery.toLowerCase());
    const t = targetsMap[img.filename] || img.targets || [];
    const e = exclusionsMap[img.filename] || img.exclusions || [];
    const hasAny = t.length > 0 || e.length > 0;

    if (!matchesSearch) return false;
    if (filterMode === 'has-targets') return hasAny;
    if (filterMode === 'no-targets') return !hasAny;
    return true;
  });

  const handleSelectTarget = (idx) => {
    setSelectedTargetIndex(idx);
    setSelectedExclusionIndex(null);
    setActiveTool('ellipse');
  };

  const handleSelectExclusion = (idx) => {
    setSelectedExclusionIndex(idx);
    setSelectedTargetIndex(null);
    setActiveTool('vip-box');
  };

  const handleDeleteExclusion = (e, idx) => {
    e.stopPropagation();
    setExclusions((prev) => prev.filter((_, i) => i !== idx));
    setSelectedExclusionIndex((prev) => (prev === idx ? null : prev));
  };

  return (
    <div className="glass-panel rounded-t-panel w-full shrink-0 select-none z-20 flex flex-col" style={{ height: '118px' }}>
      {/* Row 1: tab bar */}
      <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: '34px' }}>
        <div className="ios-segment">
          <button
            onClick={() => setActiveDockTab('regions')}
            title="Show ellipse targets and VIP areas for the active photo"
            className={`ios-segment-btn text-xs font-medium ${activeDockTab === 'regions' ? 'on' : ''}`}
          >
            Regions {targets.length}
          </button>
          <button
            onClick={() => setActiveDockTab('photos')}
            title="Browse and search all photos in the folder"
            className={`ios-segment-btn text-xs font-medium ${activeDockTab === 'photos' ? 'on' : ''}`}
          >
            Photos {images.length}
          </button>
        </div>

        {activeDockTab === 'photos' && (
          <>
            <div className="relative w-40">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter…"
                className="glass-input w-full pl-6 pr-2 py-1 text-[11px] mono-font placeholder-text-muted"
              />
            </div>

            <div className="ios-segment">
              <button
                onClick={() => setFilterMode('all')}
                title="Show every photo in the folder"
                className={`ios-segment-btn text-[10px] font-medium ${filterMode === 'all' ? 'on' : ''}`}
              >
                All
              </button>
              <button
                onClick={() => setFilterMode('has-targets')}
                title="Show only photos with at least one saved region"
                className={`ios-segment-btn text-[10px] font-medium ${filterMode === 'has-targets' ? 'on' : ''}`}
              >
                Configured
              </button>
              <button
                onClick={() => setFilterMode('no-targets')}
                title="Show only photos with no regions saved yet"
                className={`ios-segment-btn text-[10px] font-medium ${filterMode === 'no-targets' ? 'on' : ''}`}
              >
                Pending
              </button>
            </div>
          </>
        )}
      </div>

      {/* Row 2: scrollable chip row */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-3 pb-2.5">
        {activeDockTab === 'regions' ? (
          targets.length === 0 && exclusions.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-text-muted text-xs text-center">
              No regions yet — use Ellipse or Grid on the canvas
            </div>
          ) : (
            <div className="flex items-stretch gap-2 h-full">
              {targets.map((t, idx) => {
                const isSelected = selectedTargetIndex === idx;
                return (
                  <button
                    key={`t-${idx}`}
                    onClick={() => handleSelectTarget(idx)}
                    style={{ width: '78px', ...(isSelected ? { boxShadow: '0 0 0 2px var(--color-accent)' } : {}) }}
                    className="shrink-0 rounded-panel bg-surface-raised/60 p-1.5 text-left flex flex-col gap-1 transition-colors hover:bg-surface-raised"
                    title={t.label || `Target ${idx + 1}`}
                  >
                    <div className="w-full h-9 rounded bg-surface-raised" />
                    <p className="text-[10px] font-medium text-text-primary truncate leading-tight">
                      {t.label || `Target ${idx + 1}`}
                    </p>
                    <p className="text-[9px] mono-font text-text-muted leading-tight">
                      X:{(t.cx * 100).toFixed(0)}% Y:{(t.cy * 100).toFixed(0)}%
                    </p>
                  </button>
                );
              })}

              {exclusions.map((box, idx) => {
                const isSelected = selectedExclusionIndex === idx;
                return (
                  <div
                    key={`e-${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectExclusion(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectExclusion(idx);
                      }
                    }}
                    style={{
                      width: '78px',
                      boxShadow: isSelected
                        ? '0 0 0 2px var(--color-state-success), 0 0 0 4px var(--color-accent-strong)'
                        : '0 0 0 2px var(--color-state-success)'
                    }}
                    className="shrink-0 rounded-panel bg-surface-raised/60 p-1.5 text-left flex flex-col gap-1 relative cursor-pointer transition-colors hover:bg-surface-raised"
                    title={box.label || 'VIP Subject'}
                  >
                    <button
                      onClick={(e) => handleDeleteExclusion(e, idx)}
                      title="Remove this VIP area"
                      aria-label="Remove this VIP area"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-state-danger text-white text-[9px] flex items-center justify-center leading-none z-10"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                    <div className="w-full h-9 rounded bg-surface-raised" />
                    <p className="text-[10px] font-medium text-state-success truncate leading-tight">
                      {box.label || 'VIP Subject'}
                    </p>
                    <p className="text-[9px] mono-font text-text-muted leading-tight">
                      {(box.x1 * 100).toFixed(0)},{(box.y1 * 100).toFixed(0)}
                    </p>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredImages.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-xs text-center">
            No images match your filter
          </div>
        ) : (
          <div className="flex items-stretch gap-2 h-full">
            {filteredImages.map((img) => {
              const index = images.findIndex((i) => i.id === img.id);
              const isSelected = index === selectedIndex;
              const t = targetsMap[img.filename] || img.targets || [];
              const e = exclusionsMap[img.filename] || img.exclusions || [];
              const hasAny = t.length > 0 || e.length > 0;

              return (
                <button
                  key={img.id}
                  onClick={() => onSelectImage(index)}
                  style={{ width: '78px', ...(isSelected ? { boxShadow: '0 0 0 2px var(--color-accent)' } : {}) }}
                  className="shrink-0 rounded-panel bg-surface-raised/60 p-1.5 text-left flex flex-col gap-1 relative transition-colors hover:bg-surface-raised"
                  title={img.filename}
                >
                  <div className="w-full h-9 rounded overflow-hidden relative">
                    <img
                      src={img.streamUrl}
                      alt={img.filename}
                      loading="lazy"
                      className="w-full h-full object-cover rounded"
                    />
                    {hasAny && (
                      <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-accent ring-2 ring-surface-canvas" />
                    )}
                  </div>
                  <p className="text-[10px] font-medium text-text-primary truncate leading-tight">
                    {img.filename}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
