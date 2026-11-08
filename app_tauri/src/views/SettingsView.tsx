import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, Folder, CheckCircle2, Shield, Cloud } from 'lucide-react';
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
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#cdd6f4] flex items-center gap-2">
            <SettingsIcon size={24} className="text-[#b4befe]" />
            <span>Cài đặt hệ thống</span>
          </h1>
          <p className="text-xs text-[#a6adc8] mt-1">
            Tùy chỉnh thư mục lưu trữ, luồng tải và cấu hình AI Cleaner theo nhu cầu của bạn
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Download Settings Card */}
          <div className="bg-[#181825] p-6 rounded-2xl border border-[#313244]/60 space-y-4">
            <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2 border-b border-[#313244] pb-3">
              <Folder size={16} className="text-[#b4befe]" />
              <span>Lưu trữ & Tải về</span>
            </h2>

            <div>
              <label className="text-xs text-[#a6adc8] font-semibold mb-1.5 block">
                Thư mục tải truyện
              </label>
              <input
                type="text"
                value={settings.download_dir}
                onChange={(e) => setSettings({ ...settings, download_dir: e.target.value })}
                className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
              />
              <p className="text-[10px] text-[#6c7086] mt-1">
                Đường dẫn thư mục lưu trữ truyện (mặc định là thư mục "downloads" trong thư mục ứng dụng)
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#a6adc8] font-semibold mb-1.5 block">
                  Định dạng tải mặc định
                </label>
                <select
                  value={settings.preferred_format}
                  onChange={(e) => setSettings({ ...settings, preferred_format: e.target.value })}
                  className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
                >
                  <option value="cbz">CBZ (Tích hợp ComicInfo.xml)</option>
                  <option value="zip">ZIP (Ảnh thô nguyên bản)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-[#a6adc8] font-semibold mb-1.5 block">
                  Số chương tải đồng thời
                </label>
                <select
                  value={settings.max_concurrent_chapters}
                  onChange={(e) => setSettings({ ...settings, max_concurrent_chapters: parseInt(e.target.value) })}
                  className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
                >
                  <option value={1}>1 chương (Nhẹ máy nhất)</option>
                  <option value={2}>2 chương (Khuyên dùng)</option>
                  <option value={3}>3 chương (Tải nhanh)</option>
                </select>
              </div>
            </div>
          </div>

          {/* AI Cleaner Hybrid Settings */}
          <div className="bg-[#181825] p-6 rounded-2xl border border-[#313244]/60 space-y-4">
            <h2 className="text-sm font-bold text-[#cdd6f4] flex items-center gap-2 border-b border-[#313244] pb-3">
              <Cloud size={16} className="text-[#cba6f7]" />
              <span>AI Cleaner Studio (Chế độ Hybrid)</span>
            </h2>

            <div>
              <label className="text-xs text-[#a6adc8] font-semibold mb-1.5 block">
                Hugging Face Space API URL
              </label>
              <input
                type="text"
                value={settings.hf_space_url}
                onChange={(e) => setSettings({ ...settings, hf_space_url: e.target.value })}
                className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
              />
              <p className="text-[10px] text-[#6c7086] mt-1">
                Mặc định dùng Space miễn phí của cộng đồng, hoặc nhập URL server riêng của bạn
              </p>
            </div>

            <div>
              <label className="text-xs text-[#a6adc8] font-semibold mb-1.5 block">
                Hugging Face Token (Tùy chọn)
              </label>
              <input
                type="password"
                value={settings.hf_token || ''}
                onChange={(e) => setSettings({ ...settings, hf_token: e.target.value })}
                placeholder="hf_..."
                className="w-full h-10 px-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs border border-transparent focus:border-[#b4befe] focus:outline-none"
              />
              <p className="text-[10px] text-[#6c7086] mt-1">
                Token Hugging Face cá nhân để tăng giới hạn tốc độ và ưu tiên hàng đợi
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {saved && (
                <span className="flex items-center gap-1.5 text-xs text-[#a6e3a1] font-semibold">
                  <CheckCircle2 size={16} />
                  <span>Đã lưu cài đặt thành công!</span>
                </span>
              )}
            </div>

            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 bg-[#b4befe] text-[#11111b] rounded-xl text-xs font-bold hover:bg-[#cba6f7] transition-colors shadow-sm"
            >
              <Save size={16} />
              <span>Lưu thay đổi</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
