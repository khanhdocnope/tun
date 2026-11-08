import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, Folder, CheckCircle2, Shield, Cloud, HardDrive, Cpu, Sliders } from 'lucide-react';
import { AppSettings } from '../types';
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
  });
  const [saved, setSaved] = useState(false);

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
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto select-none p-4 sm:p-8">
      <div className="max-w-3xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#313244] pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#cdd6f4] flex items-center gap-2">
              <SettingsIcon size={24} className="text-[#b4befe]" />
              <span>Cài đặt hệ thống</span>
            </h1>
            <p className="text-xs text-[#a6adc8] mt-0.5">
              Cấu hình thư mục lưu trữ, giới hạn luồng tải và kết nối AI Cleaner
            </p>
          </div>

          {saved && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#a6e3a1]/20 text-[#a6e3a1] text-xs font-semibold border border-[#a6e3a1]/30 animate-fade-in">
              <CheckCircle2 size={14} />
              Đã lưu cài đặt
            </span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Section 1: Storage & Format */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#181825] border border-[#313244] shadow-md space-y-4">
            <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2">
              <HardDrive size={18} className="text-[#b4befe]" />
              <span>Lưu trữ & Định dạng</span>
            </h2>

            <div>
              <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">
                Thư mục tải về
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={settings.download_dir}
                  onChange={(e) => setSettings({ ...settings, download_dir: e.target.value })}
                  className="flex-1 h-11 px-3.5 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-mono border border-[#45475a] focus:border-[#b4befe] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">
                Định dạng đóng gói mặc định
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, preferred_format: 'cbz' })}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                    settings.preferred_format === 'cbz'
                      ? 'bg-[#b4befe] text-[#11111b] border-[#b4befe] font-bold shadow-md'
                      : 'bg-[#313244] text-[#a6adc8] border-transparent hover:text-[#cdd6f4]'
                  }`}
                >
                  CBZ (Chuẩn ComicInfo.xml)
                </button>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, preferred_format: 'zip' })}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                    settings.preferred_format === 'zip'
                      ? 'bg-[#b4befe] text-[#11111b] border-[#b4befe] font-bold shadow-md'
                      : 'bg-[#313244] text-[#a6adc8] border-transparent hover:text-[#cdd6f4]'
                  }`}
                >
                  ZIP (Ảnh thô nguyên bản)
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Concurrency & Downloader */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#181825] border border-[#313244] shadow-md space-y-4">
            <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2">
              <Cpu size={18} className="text-[#cba6f7]" />
              <span>Hiệu năng Tải Đa luồng (Two-Tier Gated)</span>
            </h2>

            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-[#a6adc8]">Số chương tải song song:</span>
                <span className="font-mono font-bold text-[#b4befe]">{settings.max_concurrent_chapters}</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={settings.max_concurrent_chapters}
                onChange={(e) =>
                  setSettings({ ...settings, max_concurrent_chapters: Number(e.target.value) })
                }
                className="w-full accent-[#b4befe] cursor-pointer h-1.5 bg-[#313244] rounded-lg"
              />
            </div>

            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-[#a6adc8]">Kết nối tối đa trên mỗi máy chủ (Tránh bị chặn IP):</span>
                <span className="font-mono font-bold text-[#b4befe]">{settings.max_connections_per_host}</span>
              </div>
              <input
                type="range"
                min={2}
                max={10}
                value={settings.max_connections_per_host}
                onChange={(e) =>
                  setSettings({ ...settings, max_connections_per_host: Number(e.target.value) })
                }
                className="w-full accent-[#b4befe] cursor-pointer h-1.5 bg-[#313244] rounded-lg"
              />
            </div>
          </div>

          {/* Section 3: AI Cleaner API */}
          <div className="p-4 sm:p-5 rounded-2xl bg-[#181825] border border-[#313244] shadow-md space-y-4">
            <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2">
              <Cloud size={18} className="text-[#a6e3a1]" />
              <span>Manga AI Cleaner (Hugging Face)</span>
            </h2>

            <div>
              <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">
                Hugging Face Space URL
              </label>
              <input
                type="text"
                value={settings.hf_space_url}
                onChange={(e) => setSettings({ ...settings, hf_space_url: e.target.value })}
                className="w-full h-11 px-3.5 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-mono border border-[#45475a] focus:border-[#a6e3a1] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#a6adc8] block mb-1.5">
                HF User Access Token (Tùy chọn cho Private Space)
              </label>
              <input
                type="password"
                value={settings.hf_token}
                onChange={(e) => setSettings({ ...settings, hf_token: e.target.value })}
                placeholder="hf_..."
                className="w-full h-11 px-3.5 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-mono border border-[#45475a] focus:border-[#a6e3a1] focus:outline-none"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="w-full sm:w-auto px-8 py-3 bg-[#b4befe] text-[#11111b] rounded-xl text-sm font-bold hover:bg-[#cba6f7] transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer shadow-lg shadow-[#b4befe]/20"
            >
              <Save size={18} />
              <span>Lưu cài đặt</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
