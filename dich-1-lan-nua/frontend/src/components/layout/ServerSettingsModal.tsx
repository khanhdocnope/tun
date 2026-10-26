import React, { useState, useEffect } from 'react';
import { Server, CheckCircle2, AlertCircle, RefreshCw, X, Cpu, ExternalLink } from 'lucide-react';
import { useStudioStore } from '../../store/useStudioStore';
import { testBackendConnection, fetchCapabilities, CapabilitiesAPI } from '../../services/api';

export interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({ isOpen, onClose }) => {
  const { backendUrl, setBackendUrl, selectedOcrEngine, setSelectedOcrEngine, selectedInpaintEngine, setSelectedInpaintEngine } = useStudioStore();
  const [urlInput, setUrlInput] = useState(backendUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: number;
    message: string;
    latencyMs: number;
    isHfSpace?: boolean;
  } | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesAPI | null>(null);

  useEffect(() => {
    setUrlInput(backendUrl);
  }, [backendUrl]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testBackendConnection(urlInput);
      setTestResult(res);
      if (res.ok) {
        setBackendUrl(urlInput);
        try {
          const caps = await fetchCapabilities(urlInput);
          setCapabilities(caps);
        } catch {
          // ignore
        }
      }
    } catch (e: any) {
      setTestResult({
        ok: false,
        status: 0,
        message: e.message || 'Connection failed',
        latencyMs: 0,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    setBackendUrl(urlInput);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      data-testid="server-settings-modal"
    >
      <div className="bg-[#18191d] border border-[#272930] rounded-xl max-w-lg w-full shadow-2xl p-6 text-slate-200">
        <div className="flex items-center justify-between border-b border-[#272930] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-sm tracking-wide uppercase">Backend Server Connection</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#272930] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Backend Endpoint URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:8000 or https://user-space.hf.space"
                className="flex-1 bg-[#121316] border border-[#272930] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                data-testid="backend-url-input"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                data-testid="test-connection-btn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>Test</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              Use local FastAPI server (<code className="text-blue-400">http://127.0.0.1:8000</code>) or your free Hugging Face Docker Space URL.
            </p>
          </div>

          {/* Test Status feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                testResult.ok
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                  : 'bg-amber-950/40 border-amber-800 text-amber-200'
              }`}
              data-testid="connection-status-banner"
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-medium">
                  {testResult.ok ? 'Connection Successful' : 'Connection Warning'}
                </div>
                <div className="text-[11px] opacity-90 mt-0.5">{testResult.message}</div>
                {testResult.latencyMs > 0 && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    Latency: {testResult.latencyMs}ms {testResult.isHfSpace ? '• Hugging Face Space' : '• Local Backend'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hugging Face Free Tier Notice */}
          <div className="bg-[#141518] p-3 rounded-lg border border-[#272930] text-xs">
            <div className="flex items-center gap-1.5 text-blue-400 font-medium mb-1">
              <Cpu className="w-3.5 h-3.5" />
              <span>Hugging Face Free Tier Optimizations</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              The backend uses a manga-tuned ONNXRuntime OCR pipeline and pixel-accurate flat-bubble erasing, with OpenCV Telea/Navier-Stokes as optional fallbacks for textured artwork. Designed for 2 vCPU / 16 GB free spaces.
            </p>
          </div>

          {/* Engine Selectors */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] text-slate-300 mb-1">OCR Engine</label>
              <select
                value={selectedOcrEngine}
                onChange={(e) => setSelectedOcrEngine(e.target.value)}
                className="w-full bg-[#121316] border border-[#272930] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="rapidocr">RapidOCR (ONNX / CPU fast)</option>
                <option value="contour">Contour Fallback (CV2 Bubble)</option>
                {capabilities?.ocr.available_engines
                  .filter((e) => e !== 'rapidocr' && e !== 'contour')
                  .map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-300 mb-1">Inpaint Engine</label>
              <select
                value={selectedInpaintEngine}
                onChange={(e) => setSelectedInpaintEngine(e.target.value as any)}
                className="w-full bg-[#121316] border border-[#272930] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="auto">Auto (flat fill + flatten transparent bubbles)</option>
                <option value="flat">Flat fill (fastest, clean bubbles)</option>
                <option value="texture">Texture fill (preserve grid/pattern)</option>
                <option value="flatten">Flatten bubble (solid clean background)</option>
                <option value="lama">LaMa (AI, optional)</option>
                <option value="opencv_telea">Telea (Fast Marching)</option>
                <option value="opencv_ns">Navier-Stokes (Fluid PDE)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 border-t border-[#272930] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[#272930] hover:bg-[#272930] text-xs text-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
          >
            Save & Connect
          </button>
        </div>
      </div>
    </div>
  );
};
