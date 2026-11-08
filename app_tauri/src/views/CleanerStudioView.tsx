import React, { useState } from 'react';
import { Wand2, Upload, Loader2, Sparkles, Download, CheckCircle2, Sliders } from 'lucide-react';
import { CleanResponse } from '../types';
import { invoke } from '@tauri-apps/api/core';

export const CleanerStudioView: React.FC = () => {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [cleanedImage, setCleanedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeTaken, setTimeTaken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi gọi Hugging Face Space AI');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadResult = () => {
    if (!cleanedImage) return;
    const link = document.createElement('a');
    link.href = `data:image/webp;base64,${cleanedImage}`;
    link.download = `cleaned_${Date.now()}.webp`;
    link.click();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto p-8">
      {/* Header */}
      <div className="max-w-5xl mx-auto w-full mb-6">
        <h1 className="text-xl font-bold text-[#cdd6f4] flex items-center gap-2">
          <Wand2 size={24} className="text-[#cba6f7]" />
          <span>AI Manga Cleaner Studio</span>
        </h1>
        <p className="text-xs text-[#a6adc8] mt-1">
          Tẩy xóa chữ thoại & khôi phục nền tranh chuẩn Studio bằng mô hình LaMa Inpainting trên Hugging Face Space
        </p>
      </div>

      <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Config Panel */}
        <div className="flex flex-col gap-5 bg-[#181825] p-5 rounded-2xl border border-[#313244]/60 h-fit">
          <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2">
            <Sliders size={16} className="text-[#b4befe]" />
            <span>Cấu hình AI Inpainting</span>
          </h2>

          {/* Upload Area */}
          <div>
            <label className="text-xs text-[#a6adc8] font-semibold mb-2 block">
              1. Chọn ảnh trang truyện
            </label>
            <label className="border-2 border-dashed border-[#313244] hover:border-[#b4befe] rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#11111b]/40">
              <Upload size={28} className="text-[#b4befe] mb-2" />
              <span className="text-xs font-semibold text-[#cdd6f4]">Bấm để chọn file ảnh</span>
              <span className="text-[10px] text-[#6c7086] mt-1">PNG, JPG, WebP</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Clean Mode */}
          <div>
            <label className="text-xs text-[#a6adc8] font-semibold mb-2 block">
              2. Chế độ xóa chữ
            </label>
            <div className="flex bg-[#313244] p-1 rounded-xl text-xs">
              <button
                onClick={() => setCleanMode('all')}
                className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${
                  cleanMode === 'all' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
                }`}
              >
                Xóa tất cả (Cả SFX)
              </button>
              <button
                onClick={() => setCleanMode('bubble_only')}
                className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${
                  cleanMode === 'bubble_only' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
                }`}
              >
                Chỉ bóng thoại
              </button>
            </div>
          </div>

          {/* Detector */}
          <div>
            <label className="text-xs text-[#a6adc8] font-semibold mb-2 block">
              3. Bộ nhận diện chữ (Detector)
            </label>
            <select
              value={detector}
              onChange={(e) => setDetector(e.target.value)}
              className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
            >
              <option value="default">DBNet (Quét sạch cả trong & ngoài bóng thoại)</option>
              <option value="ctd">ComicTextDetector (Chuyên dụng Manga)</option>
            </select>
          </div>

          {/* Dilation */}
          <div>
            <div className="flex justify-between text-xs text-[#a6adc8] mb-1">
              <span>Độ bù viền nét chữ (Dilation):</span>
              <span className="font-bold text-[#b4befe]">{dilation}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={8}
              value={dilation}
              onChange={(e) => setDilation(parseInt(e.target.value))}
              className="w-full accent-[#b4befe]"
            />
            <p className="text-[10px] text-[#6c7086] mt-1">
              Dilation 2px giúp nuốt trọn bóng mờ và nét viền chữ mà không lem nét vẽ.
            </p>
          </div>

          {/* Clean Action Button */}
          <button
            onClick={handleClean}
            disabled={!originalImage || loading}
            className="w-full py-3 bg-gradient-to-r from-[#cba6f7] to-[#b4befe] text-[#11111b] rounded-xl text-sm font-bold hover:opacity-95 transition-all shadow-md shadow-[#cba6f7]/20 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            <span>{loading ? 'Đang tẩy xóa AI...' : 'Bắt đầu làm sạch ảnh'}</span>
          </button>

          {timeTaken && (
            <p className="text-xs text-[#a6e3a1] text-center font-semibold">
              ✓ Hoàn tất xử lý trong {timeTaken}
            </p>
          )}

          {error && (
            <p className="text-xs text-[#f38ba8] bg-[#f38ba8]/10 p-2.5 rounded-xl border border-[#f38ba8]/20">
              {error}
            </p>
          )}
        </div>

        {/* Right Column: Comparison Preview */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#cdd6f4]">Xem trước so sánh</h2>
            {cleanedImage && (
              <button
                onClick={handleDownloadResult}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#a6e3a1] text-[#11111b] rounded-xl text-xs font-bold hover:bg-[#94e2d5] transition-colors"
              >
                <Download size={14} />
                <span>Lưu ảnh sạch</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            {/* Original Box */}
            <div className="flex flex-col rounded-2xl bg-[#181825] border border-[#313244]/60 overflow-hidden">
              <div className="px-4 py-2 border-b border-[#313244] text-xs font-semibold text-[#a6adc8] bg-[#11111b]/40">
                Ảnh gốc
              </div>
              <div className="flex-1 flex items-center justify-center p-4 min-h-[360px] bg-[#11111b]">
                {originalImage ? (
                  <img
                    src={`data:image/webp;base64,${originalImage}`}
                    alt="Original"
                    className="max-h-[500px] w-auto object-contain rounded-lg shadow-lg"
                  />
                ) : (
                  <span className="text-xs text-[#6c7086]">Chưa chọn ảnh</span>
                )}
              </div>
            </div>

            {/* Cleaned Box */}
            <div className="flex flex-col rounded-2xl bg-[#181825] border border-[#313244]/60 overflow-hidden">
              <div className="px-4 py-2 border-b border-[#313244] text-xs font-semibold text-[#a6adc8] bg-[#11111b]/40 flex justify-between items-center">
                <span>Ảnh đã làm sạch AI</span>
                {cleanedImage && <span className="text-[#a6e3a1] text-[10px] font-bold">HOÀN TẤT</span>}
              </div>
              <div className="flex-1 flex items-center justify-center p-4 min-h-[360px] bg-[#11111b]">
                {cleanedImage ? (
                  <img
                    src={`data:image/webp;base64,${cleanedImage}`}
                    alt="Cleaned"
                    className="max-h-[500px] w-auto object-contain rounded-lg shadow-lg"
                  />
                ) : loading ? (
                  <div className="flex flex-col items-center gap-2 text-[#a6adc8]">
                    <Loader2 size={32} className="animate-spin text-[#cba6f7]" />
                    <span className="text-xs">Đang phục hồi nét vẽ...</span>
                  </div>
                ) : (
                  <span className="text-xs text-[#6c7086]">Kết quả sẽ hiển thị ở đây</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
