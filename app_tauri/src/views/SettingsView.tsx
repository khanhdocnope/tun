import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  Folder,
  CheckCircle2,
  Shield,
  Cloud,
  HardDrive,
  Cpu,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { AppSettings, CleanerStatus } from '../types';
import { invoke } from '@tauri-apps/api/core';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>({
    download_dir: 'downloads',
    max_concurrent_chapters: 2,
    max_connections_per_host: 5,
    preferred_format: 'cbz',
    hf_space_url: 'https://dobietdc-manga-text-cleaner.hf.space',
    hf_token: '',
    reader_mode: 'webtoon',
    cleaner_mode: 'auto',
    auto_prefer_local: true,
    local_model_dir: '',
    cloud_timeout_secs: 120,
  });
  const [saved, setSaved] = useState(false);
  const [cleanerStatus, setCleanerStatus] = useState<CleanerStatus | null>(null);

  useEffect(() => {
    invoke<AppSettings>('get_settings')
      .then((s) => setSettings(s))
      .catch((e) => console.error(e));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke('save_settings', { settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0f1524] overflow-y-auto select-none p-4 sm:p-8 relative">
      {/* Background glow */}

      <div className="max-w-4xl mx-auto w-full space-y-6 z-10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center shadow-lg text-white">
              <SettingsIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                Cài đặt
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Thư mục tải về, tốc độ tải và kết nối dịch vụ xóa chữ AI
              </p>
            </div>
          </div>

          {saved && (
            <span className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
              <CheckCircle2 size={16} />
              Đã lưu cài đặt
            </span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Section 1: Storage & Packing Format */}
          <div className="p-5 sm:p-6 rounded-3xl bg-[#182036] border border-white/[0.08] shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <HardDrive size={18} className="text-violet-400" />
              <span>Lưu trữ & Định dạng đóng gói</span>
            </h2>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Thư mục tải về
              </label>
              <input
                type="text"
                value={settings.download_dir}
                onChange={(e) => setSettings({ ...settings, download_dir: e.target.value })}
                className="w-full h-12 px-4 bg-white/[0.04] text-white rounded-2xl text-xs font-mono border border-white/10 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Định dạng đóng gói mặc định
              </label>
              <div className="grid grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, preferred_format: 'cbz' })}
                  className={`py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer border ${
                    settings.preferred_format === 'cbz'
                      ? 'bg-violet-600 text-white border-violet-400/50 shadow-lg'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:text-white'
                  }`}
                >
                  CBZ (Chuẩn ComicInfo.xml)
                </button>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, preferred_format: 'zip' })}
                  className={`py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer border ${
                    settings.preferred_format === 'zip'
                      ? 'bg-violet-600 text-white border-violet-400/50 shadow-lg'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:text-white'
                  }`}
                >
                  ZIP (File nén nguyên bản)
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Two-tier Concurrency Performance */}
          <div className="p-5 sm:p-6 rounded-3xl bg-[#182036] border border-white/[0.08] shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cpu size={18} className="text-cyan-400" />
              <span>Tốc độ tải</span>
            </h2>

            <div>
              <div className="flex justify-between items-center text-xs mb-2">
                <span className="font-semibold text-slate-300">Số chương tải song song:</span>
                <span className="font-mono font-bold text-violet-400">{settings.max_concurrent_chapters}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={settings.max_concurrent_chapters}
                onChange={(e) =>
                  setSettings({ ...settings, max_concurrent_chapters: Number(e.target.value) })
                }
                className="w-full accent-violet-500 cursor-pointer h-1.5 bg-white/10 rounded-lg"
              />
            </div>

            <div>
              <div className="flex justify-between items-center text-xs mb-2">
                <span className="font-semibold text-slate-300">Kết nối tối đa mỗi máy chủ:</span>
                <span className="font-mono font-bold text-cyan-400">{settings.max_connections_per_host}</span>
              </div>
              <input
                type="range"
                min={2}
                max={10}
                value={settings.max_connections_per_host}
                onChange={(e) =>
                  setSettings({ ...settings, max_connections_per_host: Number(e.target.value) })
                }
                className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-white/10 rounded-lg"
              />
            </div>
          </div>

          {/* Section 3a: Cleaner hybrid (cloud / local) */}
          <div className="p-5 sm:p-6 rounded-3xl bg-[#182036] border border-white/[0.08] shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cloud size={18} className="text-emerald-400" />
              <span>Nơi xóa chữ</span>
            </h2>

            <div className="grid grid-cols-3 gap-2">
              {([
                ['auto', 'Tự động'],
                ['cloud', 'Cloud'],
                ['local', 'Trên máy'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings({ ...settings, cleaner_mode: value })}
                  className={`h-11 rounded-2xl text-xs font-bold border transition-all cursor-pointer ${
                    settings.cleaner_mode === value
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-white/[0.04] text-slate-300 border-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {settings.cleaner_mode === 'auto' && (
              <label className="flex items-center gap-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={settings.auto_prefer_local}
                  onChange={(e) => setSettings({ ...settings, auto_prefer_local: e.target.checked })}
                />
                <span>Ưu tiên chạy trên máy, lỗi thì chuyển sang Cloud (bỏ chọn = ngược lại)</span>
              </label>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Thư mục model local (detector.onnx, lama.onnx)
              </label>
              <input
                type="text"
                value={settings.local_model_dir || ''}
                onChange={(e) => setSettings({ ...settings, local_model_dir: e.target.value })}
                placeholder="Cần build với --features local-ort và đủ 2 file model"
                className="w-full h-12 px-4 bg-white/[0.04] text-white rounded-2xl text-xs font-mono border border-white/10 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={async () => {
                try {
                  await invoke('save_settings', { settings });
                  setCleanerStatus(await invoke<CleanerStatus>('get_cleaner_status'));
                } catch {
                  setCleanerStatus(null);
                }
              }}
              className="w-full h-11 rounded-2xl text-xs font-bold bg-white/[0.06] text-slate-200 border border-white/10 cursor-pointer"
            >
              Kiểm tra Cloud / Trên máy
            </button>
            {cleanerStatus && (
              <p className="text-xs text-slate-300">
                Cloud: {cleanerStatus.cloud_available ? 'sẵn sàng' : 'không khả dụng'} · Trên máy:{' '}
                {cleanerStatus.local_available ? 'sẵn sàng' : 'chưa sẵn sàng'}
              </p>
            )}
          </div>

          {/* Section 3b: AI Cleaner API Config */}
          <div className="p-5 sm:p-6 rounded-3xl bg-[#182036] border border-white/[0.08] shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cloud size={18} className="text-emerald-400" />
              <span>Xóa chữ AI (Hugging Face)</span>
            </h2>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                Hugging Face Space Endpoint
              </label>
              <input
                type="text"
                value={settings.hf_space_url}
                onChange={(e) => setSettings({ ...settings, hf_space_url: e.target.value })}
                className="w-full h-12 px-4 bg-white/[0.04] text-white rounded-2xl text-xs font-mono border border-white/10 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                HF User Access Token (Tùy chọn)
              </label>
              <input
                type="password"
                value={settings.hf_token || ''}
                onChange={(e) => setSettings({ ...settings, hf_token: e.target.value })}
                placeholder="hf_..."
                className="w-full h-12 px-4 bg-white/[0.04] text-white rounded-2xl text-xs font-mono border border-white/10 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex justify-end pt-3">
            <button
              type="submit"
              className="w-full sm:w-auto px-10 py-3.5 bg-violet-600 text-white rounded-2xl text-sm font-bold shadow-xl hover:opacity-95 transition-all flex items-center justify-center gap-2.5 active:scale-95 cursor-pointer"
            >
              <Save size={18} />
              <span>Lưu cấu hình</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
