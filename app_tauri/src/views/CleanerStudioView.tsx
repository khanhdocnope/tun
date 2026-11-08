import React, { useState } from 'react';
import {
  Wand2,
  Upload,
  Loader2,
  Sparkles,
  Download,
  CheckCircle2,
  Sliders,
  Image as ImageIcon,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { CleanResponse } from '../types';
import { invoke } from '@tauri-apps/api/core';

export const CleanerStudioView: React.FC = () => {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [cleanedImage, setCleanedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeTaken, setTimeTaken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mobile active preview tab
  const [mobileTab, setMobileTab] = useState<'original' | 'cleaned'>('original');

  // Filter params
  const [detector, setDetector] = useState('default');
  const [cleanMode, setCleanMode] = useState('all');
  const [dilation, setDilation] = useState(2);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1];
      setOriginalImage(b64);
      setCleanedImage(null);
      setTimeTaken(null);
      setError(null);
      setMobileTab('original');
    };
    reader.readAsDataURL(file);
  };

  const handleClean = async () => {
    if (!originalImage) return;

    setLoading(true);
    setError(null);
    try {
      const res = await invoke<CleanResponse>('clean_image', {
        req: {
          image_base64: originalImage,
          detector,
          inpainter: 'lama_large',
          dilation_offset: dilation,
          clean_mode: cleanMode,
          max_dim: null,
        },
      });

      setCleanedImage(res.cleaned_image_base64);
      setTimeTaken(res.time_taken || null);
      setMobileTab('cleaned');
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi xử lý ảnh với Hugging Face AI Space');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadResult = () => {
    if (!cleanedImage) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${cleanedImage}`;
    a.download = `moeject_cleaned_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#07080e] overflow-y-auto select-none p-4 sm:p-8 relative">
      {/* Background glow orb */}
      <div className="absolute top-20 right-1/4 w-96 h-96 bg-fuchsia-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-6xl mx-auto w-full space-y-5 sm:space-y-6 z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-fuchsia-600 via-purple-600 to-violet-500 flex items-center justify-center shadow-lg shadow-fuchsia-600/25 text-white">
              <Wand2 size={24} />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black text-white tracking-wide">
                Manga AI Cleaner Studio
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Tự động phát hiện và tẩy xóa lời thoại, hiệu ứng SFX với mô hình ComicTextDetector & LaMa Inpainting
              </p>
            </div>
          </div>

          {cleanedImage && (
            <button
              onClick={handleDownloadResult}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl text-xs font-bold hover:opacity-95 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer shadow-lg shadow-emerald-500/25 shrink-0"
            >
              <Download size={15} />
              <span>Tải ảnh đã xóa chữ</span>
            </button>
          )}
        </div>

        {/* Studio Controls Bar */}
        <div className="p-4 sm:p-5 rounded-3xl bg-[#0d0f1a] border border-white/[0.08] shadow-xl grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Detector */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-2">
              Mô hình phát hiện chữ
            </label>
            <select
              value={detector}
              onChange={(e) => setDetector(e.target.value)}
              className="w-full h-11 px-3.5 bg-white/[0.04] text-white rounded-2xl text-xs font-semibold border border-white/10 focus:border-violet-500 focus:outline-none appearance-none cursor-pointer"
            >
              <option value="default" className="bg-[#10121f]">ComicTextDetector (Khuyên dùng)</option>
              <option value="dbnet" className="bg-[#10121f]">DBNet Manga AI</option>
            </select>
          </div>

          {/* Clean Mode */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-2">
              Phạm vi làm sạch
            </label>
            <select
              value={cleanMode}
              onChange={(e) => setCleanMode(e.target.value)}
              className="w-full h-11 px-3.5 bg-white/[0.04] text-white rounded-2xl text-xs font-semibold border border-white/10 focus:border-violet-500 focus:outline-none appearance-none cursor-pointer"
            >
              <option value="all" className="bg-[#10121f]">Toàn bộ (Text thoại + SFX)</option>
              <option value="text_only" className="bg-[#10121f]">Chỉ xóa Text bóng thoại</option>
              <option value="sfx_only" className="bg-[#10121f]">Chỉ xóa âm thanh tượng thanh SFX</option>
            </select>
          </div>

          {/* Dilation Offset */}
          <div>
            <div className="flex justify-between items-center mb-2 text-xs">
              <span className="font-bold text-slate-300">Độ lan viền (Dilation):</span>
              <span className="font-mono font-bold text-violet-400">{dilation}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={dilation}
              onChange={(e) => setDilation(Number(e.target.value))}
              className="w-full accent-violet-500 cursor-pointer h-1.5 bg-white/10 rounded-lg mt-3"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs sm:text-sm">
            {error}
          </div>
        )}

        {/* Mobile View Toggle Pills */}
        <div className="flex sm:hidden bg-white/[0.04] p-1 rounded-2xl border border-white/[0.08]">
          <button
            onClick={() => setMobileTab('original')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
              mobileTab === 'original'
                ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                : 'text-slate-400'
            }`}
          >
            Ảnh gốc (Trước)
          </button>
          <button
            onClick={() => setMobileTab('cleaned')}
            disabled={!cleanedImage}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
              mobileTab === 'cleaned'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                : 'text-slate-400 disabled:opacity-40'
            }`}
          >
            Đã làm sạch (Sau)
          </button>
        </div>

        {/* Dual Canvas Showcase */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Left: Original */}
          <div
            className={`rounded-3xl border border-white/[0.08] bg-[#0d0f1a] p-4 flex flex-col items-center justify-center min-h-[420px] relative overflow-hidden ${
              mobileTab === 'original' ? 'block' : 'hidden sm:flex'
            }`}
          >
            <span className="absolute top-4 left-4 px-3 py-1 rounded-xl text-[10px] font-extrabold bg-white/[0.06] text-slate-300 border border-white/[0.08] z-10">
              ẢNH GỐC
            </span>

            {originalImage ? (
              <img
                src={`data:image/png;base64,${originalImage}`}
                alt="Original"
                className="max-h-[520px] w-auto object-contain rounded-2xl shadow-2xl"
              />
            ) : (
              <label className="flex flex-col items-center justify-center gap-3.5 cursor-pointer p-8 text-center text-slate-500 hover:text-slate-200 transition-colors">
                <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-violet-400">
                  <Upload size={30} />
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-200 block">Tải ảnh trang truyện lên</span>
                  <span className="text-xs text-slate-500 mt-1 block">Hỗ trợ định dạng PNG, JPG, WebP</span>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Right: AI Cleaned */}
          <div
            className={`rounded-3xl border border-white/[0.08] bg-[#0d0f1a] p-4 flex flex-col items-center justify-center min-h-[420px] relative overflow-hidden ${
              mobileTab === 'cleaned' ? 'block' : 'hidden sm:flex'
            }`}
          >
            <span className="absolute top-4 left-4 px-3 py-1 rounded-xl text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 z-10">
              KẾT QUẢ AI CLEANER
            </span>

            {loading ? (
              <div className="flex flex-col items-center gap-3.5 text-slate-400">
                <Loader2 size={44} className="animate-spin text-fuchsia-500" />
                <p className="text-xs font-semibold">AI Vision đang nhận diện và tẩy xóa text...</p>
              </div>
            ) : cleanedImage ? (
              <img
                src={`data:image/png;base64,${cleanedImage}`}
                alt="Cleaned"
                className="max-h-[520px] w-auto object-contain rounded-2xl shadow-2xl"
              />
            ) : (
              <div className="flex flex-col items-center gap-2.5 text-center text-slate-500 p-6">
                <Sparkles size={40} className="text-fuchsia-500/30" />
                <p className="text-xs text-slate-400">Hình ảnh sau khi AI xử lý sẽ hiển thị tại đây</p>
              </div>
            )}

            {timeTaken && (
              <span className="absolute bottom-4 right-4 text-[10px] font-mono text-slate-400 bg-black/70 px-2.5 py-1 rounded-lg border border-white/10">
                Thời gian: {timeTaken}
              </span>
            )}
          </div>
        </div>

        {/* Process Button */}
        <div className="flex justify-center pt-2">
          <button
            onClick={handleClean}
            disabled={!originalImage || loading}
            className="w-full sm:w-auto px-10 py-3.5 bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-fuchsia-600/30 hover:opacity-95 transition-all flex items-center justify-center gap-2.5 cursor-pointer active:scale-95 disabled:opacity-40"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            <span>Tẩy xóa Text với Hugging Face AI</span>
          </button>
        </div>
      </div>
    </div>
  );
};
