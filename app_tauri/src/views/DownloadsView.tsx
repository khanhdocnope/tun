import React, { useEffect, useState } from 'react';
import { Download, FolderOpen, CheckCircle2, AlertCircle, Loader2, Sparkles, Clock, ArrowDownToLine, X, Ban } from 'lucide-react';
import { DownloadTask } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const DownloadsView: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  const handleCancel = (taskId: string) => {
    invoke('cancel_download', { taskId }).catch((e) => console.error(e));
  };

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
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30">
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
      case 'cancelled':
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">
            <Ban size={13} />
            Đã hủy
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
    <div className="flex-1 flex flex-col h-full bg-[#0f1524] overflow-hidden select-none relative">
      {/* Background glow orbs */}

      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-white/[0.08] bg-[#131a2c]/85 backdrop-blur-2xl shrink-0 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-violet-600 flex items-center justify-center shadow-lg text-white">
            <ArrowDownToLine size={20} />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-bold text-white tracking-wide">
              Tải về
            </h1>
            <p className="text-xs text-slate-400">
              Các chương được tải song song rồi tự đóng gói
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
                className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#182036] border border-white/[0.07] hover:border-violet-500/30 transition-all shadow-xl flex flex-col gap-3.5"
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
                  <div className="shrink-0 flex items-center gap-2">
                    {getStatusBadge(task.status)}
                    {(task.status === 'downloading' || task.status === 'queued') && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        title="Hủy tải"
                        className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-white/[0.06] transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full tone-bar transition-all duration-300 rounded-full"
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
