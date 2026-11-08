import React, { useEffect, useState } from 'react';
import { Download, FolderOpen, CheckCircle2, AlertCircle, Loader2, Sparkles, Clock, ArrowDownToLine } from 'lucide-react';
import { DownloadTask } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const DownloadsView: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    invoke<DownloadTask[]>('get_download_queue')
      .then((q) => setTasks(q))
      .catch((e) => console.error(e));

    const unlistenPromise = listen<DownloadTask>('download-progress', (event) => {
      const updatedTask = event.payload;
      setTasks((prev) => {
        const index = prev.findIndex((t) => t.id === updatedTask.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = updatedTask;
          return next;
        } else {
          return [updatedTask, ...prev];
        }
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const getStatusBadge = (status: DownloadTask['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={13} />
            Hoàn tất
          </span>
        );
      case 'packaging':
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30 animate-pulse">
            <Sparkles size={13} />
            Đang đóng gói
          </span>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            <Loader2 size={13} className="animate-spin" />
            Đang tải
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertCircle size={13} />
            Thất bại
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/[0.06] text-slate-400 border border-white/[0.08]">
            <Clock size={13} />
            Đang chờ
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#07080e] overflow-hidden select-none relative">
      {/* Background glow orbs */}
      <div className="absolute top-10 right-20 w-80 h-80 bg-violet-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-white/[0.08] bg-[#0c0d18]/85 backdrop-blur-2xl shrink-0 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-600/20 text-white">
            <ArrowDownToLine size={20} />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-bold text-white tracking-wide">
              Tiến trình tải về đa luồng
            </h1>
            <p className="text-xs text-slate-400">
              Hệ thống Two-Tier Concurrency tải ảnh siêu tốc & tự động đóng gói CBZ
            </p>
          </div>
        </div>

        <div className="px-3.5 py-1.5 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-violet-400 text-xs font-bold">
          {tasks.length} tác vụ
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3.5 max-w-5xl mx-auto w-full z-10">
        {tasks.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center gap-3.5 text-slate-500 text-center">
            <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-400 shadow-inner">
              <Download size={36} className="text-slate-400 opacity-60" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300">Hàng đợi tải về đang trống</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Chọn truyện từ tab Khám phá và bấm nút tải để thêm chương vào danh sách
              </p>
            </div>
          </div>
        ) : (
          tasks.map((task) => {
            const progress =
              task.total_pages > 0
                ? Math.round((task.downloaded_pages / task.total_pages) * 100)
                : 0;

            return (
              <div
                key={task.id}
                className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#0d0f1a] border border-white/[0.07] hover:border-violet-500/30 transition-all shadow-xl flex flex-col gap-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="overflow-hidden">
                    <h3 className="font-bold text-sm sm:text-base text-white truncate">
                      {task.manga_title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400 truncate">{task.chapter_title}</span>
                      <span className="uppercase font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/20">
                        {task.file_format}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">{getStatusBadge(task.status)}</div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-600 via-purple-500 to-cyan-400 transition-all duration-300 rounded-full shadow-[0_0_12px_rgba(168,85,247,0.5)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>
                      {task.downloaded_pages} / {task.total_pages > 0 ? task.total_pages : '...'} trang
                    </span>
                    <span className="font-bold text-white">{progress}%</span>
                  </div>
                </div>

                {task.error_message && (
                  <p className="text-[11px] text-rose-400 bg-rose-500/10 p-2 rounded-xl border border-rose-500/20">
                    {task.error_message}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
