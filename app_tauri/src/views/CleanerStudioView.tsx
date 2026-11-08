import React, { useState } from 'react';
import { Wand2, Upload, Loader2, Sparkles, Download, CheckCircle2, Sliders, Image as ImageIcon } from 'lucide-react';
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
      setTimeTaken(res.time_taken);
      setMobileTab('cleaned');
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi xử lý ảnh với AI Space');
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
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto select-none p-3 sm:p-6">
      <div className="max-w-6xl mx-auto w-full space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#313244] pb-4">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-[#cdd6f4] flex items-center gap-2">
              <Wand2 size={24} className="text-[#cba6f7]" />
              <span>Manga AI Cleaner Studio</span>
            </h1>
            <p className="text-xs text-[#a6adc8] mt-0.5">
              Tẩy xóa text bong bóng thoại và SFX tự động bằng mô hình AI Vision (Hugging Face Space)
            </p>
          </div>

          {cleanedImage && (
            <button
              onClick={handleDownloadResult}
              className="px-4 py-2 bg-[#a6e3a1] text-[#11111b] rounded-xl text-xs font-bold hover:bg-[#94e2d5] transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer shadow-md"
            >
              <Download size={15} />
              <span>Tải ảnh kết quả</span>
            </button>
          )}
        </div>

        {/* Control Bar & Parameters */}
        <div className="p-4 rounded-2xl bg-[#181825] border border-[#313244] shadow-md grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Detector */}
          <div>
            <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">Mô hình phát hiện chữ</label>
            <select
              value={detector}
              onChange={(e) => setDetector(e.target.value)}
              className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-medium border border-[#45475a] focus:border-[#cba6f7] focus:outline-none"
            >
              <option value="default">ComicTextDetector (Khuyên dùng)</option>
              <option value="dbnet">DBNet Manga</option>
            </select>
          </div>

          {/* Clean Mode */}
          <div>
            <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">Phạm vi làm sạch</label>
            <select
              value={cleanMode}
              onChange={(e) => setCleanMode(e.target.value)}
              className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-medium border border-[#45475a] focus:border-[#cba6f7] focus:outline-none"
            >
              <option value="all">Toàn bộ (Text thoại + SFX)</option>
              <option value="text_only">Chỉ xóa Text thoại</option>
              <option value="sfx_only">Chỉ xóa hiệu ứng SFX</option>
            </select>
          </div>

          {/* Dilation Offset */}
          <div>
            <div className="flex justify-between items-center mb-1.5 text-xs text-[#a6adc8]">
              <span className="font-medium">Độ lan viền (Dilation):</span>
              <span className="font-mono font-bold text-[#b4befe]">{dilation}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={dilation}
              onChange={(e) => setDilation(Number(e.target.value))}
              className="w-full accent-[#cba6f7] cursor-pointer h-1.5 bg-[#313244] rounded-lg mt-2"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-xs">
            {error}
          </div>
        )}

        {/* Mobile View Toggle Pills */}
        <div className="flex sm:hidden bg-[#181825] p-1 rounded-xl text-xs font-semibold border border-[#313244]">
          <button
            onClick={() => setMobileTab('original')}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              mobileTab === 'original' ? 'bg-[#b4befe] text-[#11111b] font-bold' : 'text-[#a6adc8]'
            }`}
          >
            Ảnh gốc (Trước)
          </button>
          <button
            onClick={() => setMobileTab('cleaned')}
            disabled={!cleanedImage}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              mobileTab === 'cleaned' ? 'bg-[#a6e3a1] text-[#11111b] font-bold' : 'text-[#a6adc8] disabled:opacity-40'
            }`}
          >
            Đã làm sạch (Sau)
          </button>
        </div>

        {/* Image Workspace Area */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Before Box */}
          <div
            className={`rounded-2xl border border-[#313244] bg-[#181825] p-4 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden ${
              mobileTab === 'original' ? 'block' : 'hidden sm:flex'
            }`}
          >
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#313244] text-[#a6adc8] z-10">
              ẢNH GỐC
            </span>

            {originalImage ? (
              <img
                src={`data:image/png;base64,${originalImage}`}
                alt="Original"
                className="max-h-[500px] w-auto object-contain rounded-xl shadow-lg"
              />
            ) : (
              <label className="flex flex-col items-center justify-center gap-3 cursor-pointer p-8 text-center text-[#6c7086] hover:text-[#cdd6f4] transition-colors">
                <Upload size={48} className="text-[#a6adc8]" />
                <span className="text-sm font-semibold">Tải ảnh trang truyện lên</span>
                <span className="text-xs text-[#6c7086]">Hỗ trợ PNG, JPEG, WebP</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* After Box */}
          <div
            className={`rounded-2xl border border-[#313244] bg-[#181825] p-4 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden ${
              mobileTab === 'cleaned' ? 'block' : 'hidden sm:flex'
            }`}
          >
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#a6e3a1]/20 text-[#a6e3a1] z-10 border border-[#a6e3a1]/30">
              ĐÃ LÀM SẠCH (AI)
            </span>

            {loading ? (
              <div className="flex flex-col items-center gap-3 text-[#a6adc8]">
                <Loader2 size={42} className="animate-spin text-[#cba6f7]" />
                <p className="text-xs font-medium">AI Vision đang phát hiện và tẩy xóa chữ...</p>
              </div>
            ) : cleanedImage ? (
              <img
                src={`data:image/png;base64,${cleanedImage}`}
                alt="Cleaned"
                className="max-h-[500px] w-auto object-contain rounded-xl shadow-lg"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center text-[#6c7086] p-6">
                <Sparkles size={40} className="opacity-40" />
                <p className="text-xs">Kết quả sau khi AI xử lý sẽ hiển thị tại đây</p>
              </div>
            )}

            {timeTaken && (
              <span className="absolute bottom-3 right-3 text-[10px] font-mono text-[#a6adc8] bg-[#11111b]/80 px-2 py-0.5 rounded">
                Thời gian xử lý: {timeTaken}
              </span>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-center pt-2">
          <button
            onClick={handleClean}
            disabled={!originalImage || loading}
            className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-[#cba6f7] to-[#b4befe] text-[#11111b] rounded-2xl text-sm font-bold shadow-xl shadow-[#cba6f7]/20 hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-40"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            <span>Tẩy xóa Text với AI Space</span>
          </button>
        </div>
      </div>
    </div>
  );
};
