import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Type,
  Maximize,
  FileText,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  CheckCircle2,
  Sparkles,
  Info,
  Eraser,
  Loader2,
  ShieldAlert,
  Layers,
} from 'lucide-react';
import { useStudioStore } from '../../store/useStudioStore';
import { usePage, useTextRegions } from '../../db/hooks';
import { db } from '../../db';
import { TextRegion, TextRegionStatus, ReadingDirectionType } from '../../types/region';
import { PageStatus } from '../../types/project';
import { processInpaint, eraseTextInRegion } from '../../services/api';

export const PropertiesPanel: React.FC = () => {
  const {
    activePageId,
    selectedRegionId,
    setSelectedRegion,
    isPropertiesOpen,
    maskDilation,
    setMaskDilation,
    selectedInpaintEngine,
    setActiveLayer,
    setStatusMessage,
  } = useStudioStore();

  const page = usePage(activePageId);
  const regions = useTextRegions(activePageId);

  const selectedRegion = regions?.find((r) => r.id === selectedRegionId);

  // Local form state for selected region editing
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [boxX, setBoxX] = useState<number>(0);
  const [boxY, setBoxY] = useState<number>(0);
  const [boxW, setBoxW] = useState<number>(0);
  const [boxH, setBoxH] = useState<number>(0);
  const [fontSize, setFontSize] = useState<number>(16);
  const [fontFamily, setFontFamily] = useState<string>('Comic Neue');
  const [fontColor, setFontColor] = useState<string>('#ffffff');
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('center');
  const [regionStatus, setRegionStatus] = useState<TextRegionStatus>('detected');
  const [readingDirection, setReadingDirection] = useState<ReadingDirectionType>('vertical');
  const [isSingleInpainting, setIsSingleInpainting] = useState(false);

  useEffect(() => {
    if (selectedRegion) {
      setSourceText(selectedRegion.sourceText || '');
      setTranslatedText(selectedRegion.translatedText || '');
      setBoxX(selectedRegion.box.x);
      setBoxY(selectedRegion.box.y);
      setBoxW(selectedRegion.box.width);
      setBoxH(selectedRegion.box.height);
      setFontSize(selectedRegion.style?.fontSize || 16);
      setFontFamily(selectedRegion.style?.fontFamily || 'Comic Neue');
      setFontColor(selectedRegion.style?.fontColor || '#ffffff');
      setAlignment(selectedRegion.style?.alignment || 'center');
      setRegionStatus(selectedRegion.status || 'detected');
      setReadingDirection(selectedRegion.readingDirection || 'vertical');
    }
  }, [selectedRegion]);

  const handleUpdateRegion = async (updates: Partial<TextRegion>) => {
    if (!selectedRegion) return;
    await db.textRegions.update(selectedRegion.id, {
      ...updates,
      updatedAt: Date.now(),
    });
  };

  const handleSaveText = async () => {
    if (!selectedRegion) return;
    await handleUpdateRegion({
      sourceText,
      translatedText,
      status: translatedText.trim() ? 'translated' : regionStatus,
    });
  };

  const handleUpdateBox = async (x: number, y: number, w: number, h: number) => {
    if (!selectedRegion) return;
    setBoxX(x);
    setBoxY(y);
    setBoxW(w);
    setBoxH(h);
    await handleUpdateRegion({
      box: {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
        width: Math.max(4, Math.round(w)),
        height: Math.max(4, Math.round(h)),
      },
    });
  };

  const handleDeleteRegion = async (regionId: string) => {
    if (window.confirm('Delete this text region?')) {
      await db.textRegions.delete(regionId);
      if (selectedRegionId === regionId) {
        setSelectedRegion(null);
      }
    }
  };

  const handleUpdatePageStatus = async (status: PageStatus) => {
    if (!page) return;
    await db.pages.update(page.id, {
      status,
      updatedAt: Date.now(),
    });
  };

  // Erase single selected bubble
  const handleEraseSingleRegion = async () => {
    if (!page || !page.sourceBlob || !selectedRegion || isSingleInpainting) return;

    setIsSingleInpainting(true);
    setStatusMessage({
      text: `Inpainting bubble #${selectedRegion.orderIndex}...`,
      type: 'info',
    });

    try {
      const region: [number, number, number, number] = [
        selectedRegion.box.x,
        selectedRegion.box.y,
        selectedRegion.box.width,
        selectedRegion.box.height,
      ];

      const res = await eraseTextInRegion(page.cleanedBlob || page.sourceBlob, {
        regions: [region],
        dilation: maskDilation,
        engine: selectedInpaintEngine,
      });

      await db.pages.update(page.id, {
        cleanedBlob: res.cleanedBlob,
        updatedAt: Date.now(),
      });

      setActiveLayer('split');
      setStatusMessage({
        text: `Bubble #${selectedRegion.orderIndex} erased (${res.engine}, ${res.textBoxes} text box(es)).`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMessage({
        text: `Inpainting failed: ${err.message || 'Error erasing region'}`,
        type: 'error',
      });
    } finally {
      setIsSingleInpainting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (!isPropertiesOpen) {
    return null;
  }

  // Confidence color helper
  const getConfidenceBadge = (confidence?: number) => {
    const conf = confidence !== undefined ? confidence : 1.0;
    const pct = Math.round(conf * 100);
    let colorClass = 'bg-emerald-950/60 text-emerald-400 border-emerald-800';
    if (pct < 50) {
      colorClass = 'bg-rose-950/60 text-rose-400 border-rose-800';
    } else if (pct < 80) {
      colorClass = 'bg-amber-950/60 text-amber-400 border-amber-800';
    }

    return (
      <span
        data-testid="region-confidence-badge"
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${colorClass}`}
        title={`OCR confidence score: ${pct}%`}
      >
        {pct}% confidence
      </span>
    );
  };

  return (
    <aside
      data-testid="properties-panel"
      className="w-80 h-full bg-sidebar border-l border-border flex flex-col z-20 select-none text-text overflow-hidden"
      style={{ backgroundColor: '#141518', borderColor: '#272930' }}
    >
      {/* Header */}
      <div className="h-10 px-3.5 border-b border-border flex items-center justify-between bg-card/40">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Sliders className="w-3.5 h-3.5 text-primary" />
          <span>Properties</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Section 1: Page Metadata */}
        <div data-testid="page-metadata-section" className="bg-card/40 border border-border rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Page Info
            </span>
            {page && (
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                #{page.pageNumber}
              </span>
            )}
          </div>

          {page ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-muted">
                <span>File Name:</span>
                <span className="text-text font-medium truncate max-w-[150px]" title={page.fileName}>
                  {page.fileName}
                </span>
              </div>

              <div className="flex items-center justify-between text-muted">
                <span>Dimensions:</span>
                <span className="text-text font-mono">
                  {page.width} × {page.height} px
                </span>
              </div>

              <div className="flex items-center justify-between text-muted">
                <span>File Size:</span>
                <span className="text-text font-mono">
                  {formatFileSize(page.fileSize)}
                </span>
              </div>

              <div className="flex items-center justify-between text-muted">
                <span>Cleaned Image:</span>
                <span
                  data-testid="page-cleaned-status"
                  className={`font-mono text-[11px] ${page.cleanedBlob ? 'text-emerald-400' : 'text-slate-500'}`}
                >
                  {page.cleanedBlob ? 'Available (Ready)' : 'Not yet generated'}
                </span>
              </div>

              <div className="flex items-center justify-between text-muted pt-1 border-t border-border/50">
                <span>Status:</span>
                <select
                  data-testid="page-status-select"
                  value={page.status}
                  onChange={(e) => handleUpdatePageStatus(e.target.value as PageStatus)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                >
                  <option value="idle">Idle</option>
                  <option value="processing">Processing</option>
                  <option value="ocr_completed">OCR Done</option>
                  <option value="translated">Translated</option>
                  <option value="error">Error</option>
                </select>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">No page selected</p>
          )}
        </div>

        {/* Section 2: Inpainting Mask Settings */}
        <div data-testid="inpaint-settings-section" className="bg-card/40 border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Mask Settings
            </span>
            <span className="text-[11px] font-mono text-blue-400">{maskDilation}px padding</span>
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">
              Text Mask Dilation (Padding Margin)
            </label>
            <input
              type="range"
              min={0}
              max={12}
              value={maskDilation}
              onChange={(e) => setMaskDilation(Number(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
              data-testid="mask-dilation-slider"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>0px (tight)</span>
              <span>4px (standard)</span>
              <span>12px (broad)</span>
            </div>
          </div>
        </div>

        {/* Section 3: Selected TextRegion Inspector */}
        <div data-testid="region-inspector-section" className="bg-card/40 border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Text Region
              </span>
            </div>

            {selectedRegion && (
              <button
                type="button"
                data-testid="delete-region-btn"
                onClick={() => handleDeleteRegion(selectedRegion.id)}
                title="Delete text region"
                className="text-muted hover:text-red-400 p-0.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {selectedRegion ? (
            <div className="space-y-3 text-xs">
              {/* Region Header Details */}
              <div className="flex items-center justify-between bg-background/60 p-2 rounded border border-border/60">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-300 font-semibold">
                    Bubble #{selectedRegion.orderIndex}
                  </span>
                  {selectedRegion.polygon && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      {selectedRegion.polygon.length} pts
                    </span>
                  )}
                </div>
                {getConfidenceBadge(selectedRegion.confidence)}
              </div>

              {/* Single Bubble Inpainting Action */}
              <button
                type="button"
                data-testid="erase-single-bubble-btn"
                onClick={handleEraseSingleRegion}
                disabled={isSingleInpainting}
                className="w-full py-1.5 px-2 bg-emerald-600/90 hover:bg-emerald-600 disabled:opacity-50 text-white rounded font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
              >
                {isSingleInpainting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Eraser className="w-3.5 h-3.5" />
                )}
                <span>{isSingleInpainting ? 'Erasing Bubble...' : 'Erase This Bubble'}</span>
              </button>

              {/* Status and Direction */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-muted mb-1">Status</label>
                  <select
                    data-testid="region-status-select"
                    value={regionStatus}
                    onChange={(e) => {
                      const val = e.target.value as TextRegionStatus;
                      setRegionStatus(val);
                      handleUpdateRegion({ status: val });
                    }}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                  >
                    <option value="detected">Detected</option>
                    <option value="verified">Verified</option>
                    <option value="in_translation">Translating</option>
                    <option value="translated">Translated</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-muted mb-1">Direction</label>
                  <select
                    data-testid="region-direction-select"
                    value={readingDirection}
                    onChange={(e) => {
                      const val = e.target.value as ReadingDirectionType;
                      setReadingDirection(val);
                      handleUpdateRegion({ readingDirection: val });
                    }}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                  >
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </div>
              </div>

              {/* Bounding Box Coordinates */}
              <div>
                <label className="block text-[10px] text-muted mb-1 flex items-center gap-1">
                  <Maximize className="w-3 h-3" />
                  <span>Bounding Box (Native Pixels)</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5 font-mono text-[11px]">
                  <div>
                    <span className="block text-[9px] text-muted">X</span>
                    <input
                      type="number"
                      data-testid="region-box-x"
                      value={boxX || selectedRegion?.box.x || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBoxX(val);
                        handleUpdateBox(val, boxY, boxW, boxH);
                      }}
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-text"
                    />
                  </div>
                  <div>
                    <span className="block text-[9px] text-muted">Y</span>
                    <input
                      type="number"
                      data-testid="region-box-y"
                      value={boxY || selectedRegion?.box.y || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBoxY(val);
                        handleUpdateBox(boxX, val, boxW, boxH);
                      }}
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-text"
                    />
                  </div>
                  <div>
                    <span className="block text-[9px] text-muted">W</span>
                    <input
                      type="number"
                      data-testid="region-box-w"
                      value={boxW || selectedRegion?.box.width || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBoxW(val);
                        handleUpdateBox(boxX, boxY, val, boxH);
                      }}
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-text"
                    />
                  </div>
                  <div>
                    <span className="block text-[9px] text-muted">H</span>
                    <input
                      type="number"
                      data-testid="region-box-h"
                      value={boxH || selectedRegion?.box.height || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setBoxH(val);
                        handleUpdateBox(boxX, boxY, boxW, val);
                      }}
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-text"
                    />
                  </div>
                </div>
              </div>

              {/* Typography / Style Inspector */}
              <div className="space-y-2 pt-1 border-t border-border/50">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Font</label>
                    <input
                      type="text"
                      value={fontFamily}
                      onChange={(e) => {
                        setFontFamily(e.target.value);
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, fontFamily: e.target.value },
                        });
                      }}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-text"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Size (px)</label>
                    <input
                      type="number"
                      value={fontSize}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setFontSize(val);
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, fontSize: val },
                        });
                      }}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-text"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-muted">Color</label>
                    <input
                      type="color"
                      value={fontColor}
                      onChange={(e) => {
                        setFontColor(e.target.value);
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, fontColor: e.target.value },
                        });
                      }}
                      className="w-6 h-6 rounded border border-border bg-transparent cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center bg-background border border-border rounded p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAlignment('left');
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, alignment: 'left' },
                        });
                      }}
                      className={`p-1 rounded ${alignment === 'left' ? 'bg-primary text-white' : 'text-muted'}`}
                    >
                      <AlignLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAlignment('center');
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, alignment: 'center' },
                        });
                      }}
                      className={`p-1 rounded ${alignment === 'center' ? 'bg-primary text-white' : 'text-muted'}`}
                    >
                      <AlignCenter className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAlignment('right');
                        handleUpdateRegion({
                          style: { ...selectedRegion.style, alignment: 'right' },
                        });
                      }}
                      className={`p-1 rounded ${alignment === 'right' ? 'bg-primary text-white' : 'text-muted'}`}
                    >
                      <AlignRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Source Text Area */}
              <div>
                <label className="block text-[10px] text-muted mb-1 flex items-center justify-between">
                  <span>Source Text</span>
                  <span className="text-[9px] text-slate-400">OCR / Original</span>
                </label>
                <textarea
                  data-testid="region-source-text"
                  rows={2}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  onBlur={handleSaveText}
                  placeholder="Enter original dialogue text..."
                  className="w-full bg-background border border-border rounded p-2 text-xs text-text focus:outline-none focus:border-primary resize-y"
                />
              </div>

              {/* Translated Text Area */}
              <div>
                <label className="block text-[10px] text-muted mb-1 flex items-center justify-between">
                  <span>Translated Text</span>
                  <span className="text-[9px] text-primary">Target</span>
                </label>
                <textarea
                  data-testid="region-translated-text"
                  rows={3}
                  value={translatedText}
                  onChange={(e) => setTranslatedText(e.target.value)}
                  onBlur={handleSaveText}
                  placeholder="Enter Vietnamese or target translation..."
                  className="w-full bg-background border border-border rounded p-2 text-xs text-text focus:outline-none focus:border-primary resize-y"
                />
              </div>

              {/* Save Trigger Button */}
              <button
                type="button"
                data-testid="save-region-btn"
                onClick={handleSaveText}
                className="w-full py-1.5 bg-primary hover:bg-blue-600 text-white rounded font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save Region</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 py-2 text-center">
              {regions && regions.length > 0 ? (
                <div className="space-y-2 text-left">
                  <span className="text-[10px] text-muted block">
                    Select a region from list ({regions.length}):
                  </span>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {regions.map((reg) => (
                      <div
                        key={reg.id}
                        data-testid={`select-region-${reg.id}`}
                        onClick={() => setSelectedRegion(reg.id)}
                        className="p-1.5 rounded bg-background border border-border/80 hover:border-primary cursor-pointer text-xs flex items-center justify-between"
                      >
                        <span className="font-mono text-slate-300">
                          #{reg.orderIndex} ({reg.box.width}×{reg.box.height})
                        </span>
                        <span className="text-[10px] text-muted truncate max-w-[100px]">
                          {reg.translatedText || reg.sourceText || '(Empty)'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-muted text-xs space-y-1.5 py-4">
                  <Info className="w-6 h-6 mx-auto opacity-50 text-slate-400" />
                  <p className="font-medium text-slate-300">No text regions detected</p>
                  <p className="text-[11px] text-muted leading-relaxed">
                    Click "Run OCR" above or use the Draw tool (R) to create dialogue boxes.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
