import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export interface ZoomControlsProps {
  className?: string;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({ className = '' }) => {
  const scale = useCanvasStore((s) => s.scale);
  const zoomIn = useCanvasStore((s) => s.zoomIn);
  const zoomOut = useCanvasStore((s) => s.zoomOut);
  const fitToScreen = useCanvasStore((s) => s.fitToScreen);
  const actualSize = useCanvasStore((s) => s.actualSize);

  const zoomPercentage = Math.round(scale * 100);

  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-1.5 bg-[#1a1b20]/90 backdrop-blur border border-[#272930] rounded-lg shadow-lg select-none text-[#f1f5f9] text-xs font-medium z-30 ${className}`}
      data-testid="zoom-controls"
    >
      {/* Zoom Out Button */}
      <button
        type="button"
        onClick={() => zoomOut(1.25)}
        className="p-1.5 rounded hover:bg-[#272930] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Zoom Out (-)"
        aria-label="Zoom Out"
        data-testid="zoom-out-btn"
      >
        <ZoomOut className="w-4 h-4" />
      </button>

      {/* Percentage Display (Click to reset to 100%) */}
      <button
        type="button"
        onClick={() => actualSize()}
        className="px-2 py-1 rounded hover:bg-[#272930] text-center min-w-[50px] font-mono text-xs text-[#f1f5f9] transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Reset to 100% Actual Size"
        aria-label="Current Zoom Percentage"
        data-testid="zoom-percentage-btn"
      >
        {zoomPercentage}%
      </button>

      {/* Zoom In Button */}
      <button
        type="button"
        onClick={() => zoomIn(1.25)}
        className="p-1.5 rounded hover:bg-[#272930] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
        title="Zoom In (+)"
        aria-label="Zoom In"
        data-testid="zoom-in-btn"
      >
        <ZoomIn className="w-4 h-4" />
      </button>

      <div className="w-[1px] h-4 bg-[#272930] mx-0.5" />

      {/* Fit to Screen Button */}
      <button
        type="button"
        onClick={() => fitToScreen()}
        className="p-1.5 rounded hover:bg-[#272930] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 flex items-center gap-1"
        title="Fit to Screen"
        aria-label="Fit to Screen"
        data-testid="fit-to-screen-btn"
      >
        <Maximize2 className="w-4 h-4" />
      </button>

      {/* 100% Actual Size Button */}
      <button
        type="button"
        onClick={() => actualSize()}
        className="p-1.5 rounded hover:bg-[#272930] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 flex items-center gap-1"
        title="100% Actual Size"
        aria-label="100% Actual Size"
        data-testid="actual-size-btn"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
    </div>
  );
};
