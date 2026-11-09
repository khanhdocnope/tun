import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Globe, Check, ExternalLink, Filter, Layers, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { SourceCatalogEntry } from '../types';

interface SourceCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (source: { id: string; name: string; url?: string; language?: string }) => void;
  currentSourceId: string;
}

const SUPPORTED_TEMPLATES = ['WordPressMadara', 'WordPressMangastream', 'MojoPortalComic'];

const LANGUAGES = [
  { id: 'all', label: 'Tất cả ngôn ngữ' },
  { id: 'vi', label: 'Tiếng Việt' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語 (Raw)' },
  { id: 'ko', label: '한국어' },
  { id: 'zh', label: '中文' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
];

export const SourceCatalogModal: React.FC<SourceCatalogModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
  currentSourceId,
}) => {
  const [sources, setSources] = useState<SourceCatalogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selectedLang, setSelectedLang] = useState('all');
  const [onlySupported, setOnlySupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(60);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);

    const langArg = selectedLang === 'all' ? null : selectedLang;
    invoke<SourceCatalogEntry[]>('list_catalog_sources', {
      query: query.trim() || null,
      lang: langArg,
      onlySupported,
    })
      .then((data) => {
        if (isMounted) {
          setSources(data || []);
          setDisplayLimit(60);
        }
      })
      .catch((err) => {
        console.error('Failed to load catalog sources:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, query, selectedLang, onlySupported]);

  const visibleSources = useMemo(() => {
    return sources.slice(0, displayLimit);
  }, [sources, displayLimit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-ink-900 border border-white/10 rounded-xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-son-600/20 text-son-400 flex items-center justify-center">
              <Globe size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-paper flex items-center gap-2">
                Kho Nguồn Truyện HakuNeko
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 font-normal">
                  {sources.length} nguồn
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Kho hơn 1,300 nguồn truyện toàn cầu trích xuất từ HakuNeko, tối ưu bộ nhớ & tải song song.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-paper rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 bg-ink-950/60 border-b border-white/10 flex flex-col sm:flex-row gap-3 shrink-0">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên nguồn (ví dụ: NetTruyen, Flame, Asura...)"
              className="w-full h-10 pl-9 pr-8 bg-ink-900 border border-white/10 rounded-lg text-sm text-paper placeholder-slate-500 focus:outline-none focus:border-son-500"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-paper p-1 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Toggle supported only */}
          <label className="flex items-center gap-2 text-xs text-slate-300 select-none cursor-pointer bg-ink-900 border border-white/10 px-3 py-2 rounded-lg hover:border-white/20 transition-colors shrink-0">
            <input
              type="checkbox"
              checked={onlySupported}
              onChange={(e) => setOnlySupported(e.target.checked)}
              className="accent-son-500 rounded"
            />
            <Zap size={14} className={onlySupported ? 'text-amber-400' : 'text-slate-500'} />
            <span>Chỉ nguồn hỗ trợ tự động ({'>'}640 nguồn)</span>
          </label>
        </div>

        {/* Languages tabs */}
        <div className="px-4 py-2 border-b border-white/5 bg-ink-950/40 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => setSelectedLang(lang.id)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                selectedLang === lang.id
                  ? 'bg-son-600 text-white font-medium'
                  : 'bg-white/5 text-slate-400 hover:text-paper hover:bg-white/10'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Source List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-28 rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : visibleSources.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Filter size={36} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">Không tìm thấy nguồn nào khớp với bộ lọc.</p>
              {onlySupported && (
                <button
                  onClick={() => setOnlySupported(false)}
                  className="mt-3 text-xs text-son-400 hover:underline cursor-pointer"
                >
                  Bỏ lọc "Chỉ nguồn hỗ trợ tự động" để tìm trong tất cả 1,300+ nguồn
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {visibleSources.map((s) => {
                const isSupported = SUPPORTED_TEMPLATES.includes(s.template);
                const isCurrent = currentSourceId === s.id;

                return (
                  <div
                    key={s.id}
                    className={`p-3.5 rounded-lg border transition-all flex flex-col justify-between ${
                      isCurrent
                        ? 'border-son-500 bg-son-950/20 shadow-md ring-1 ring-son-500/30'
                        : 'border-white/10 bg-ink-950/40 hover:border-white/20 hover:bg-white/[0.02]'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-paper line-clamp-1" title={s.name}>
                          {s.name}
                        </h4>
                        {isCurrent && (
                          <span className="shrink-0 text-son-400 flex items-center gap-1 text-[11px] font-medium">
                            <Check size={13} /> Đang dùng
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5" title={s.url}>
                        {s.url.replace(/^https?:\/\//, '')}
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                        {/* Template Badge */}
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-ink-800 text-slate-300 font-mono border border-white/5">
                          <Layers size={10} className="text-slate-400" />
                          {s.template.replace(/^WordPress/, 'WP-')}
                        </span>

                        {/* Supported status */}
                        {isSupported ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/40 font-medium">
                            Auto
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-white/5">
                            Connector
                          </span>
                        )}

                        {/* Languages */}
                        {s.languages.slice(0, 2).map((l) => (
                          <span
                            key={l}
                            className="text-[10px] px-1.5 py-0.5 rounded uppercase bg-pencil-950/60 text-pencil-300 border border-pencil-800/30 font-medium"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3.5 pt-2.5 border-t border-white/5 flex items-center justify-between gap-2">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-400 hover:text-paper flex items-center gap-1 transition-colors"
                        title="Mở trang web trong trình duyệt"
                      >
                        Web <ExternalLink size={11} />
                      </a>

                      <button
                        onClick={() => {
                          onSelectSource({ id: s.id, name: s.name, url: s.url, language: s.languages[0] });
                          onClose();
                        }}
                        className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-white/10 text-slate-400 cursor-default'
                            : isSupported
                            ? 'bg-son-600 hover:bg-son-500 text-white'
                            : 'bg-white/10 hover:bg-white/20 text-slate-200'
                        }`}
                      >
                        {isCurrent ? 'Đã chọn' : 'Dùng nguồn này'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load more button */}
          {visibleSources.length < sources.length && (
            <div className="pt-4 text-center">
              <button
                onClick={() => setDisplayLimit((prev) => prev + 60)}
                className="px-4 py-2 text-xs font-semibold rounded-md bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors cursor-pointer"
              >
                Tải thêm ({sources.length - visibleSources.length} nguồn còn lại)
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 bg-ink-950 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>Hệ thống tự động điều hướng sang scraper tương ứng với mỗi template.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-paper font-medium cursor-pointer transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
