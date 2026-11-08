import React, { useEffect, useState } from 'react';
import { Download, FolderOpen, CheckCircle2, AlertCircle, Loader2, Sparkles, Clock } from 'lucide-react';
import { DownloadTask } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const DownloadsView: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    // 1. Fetch initial queue
    invoke<DownloadTask[]>('get_download_queue')
      .then((q) => setTasks(q))
      .catch((e) => console.error(e));

    // 2. Listen to real-time progress updates from Rust
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
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#a6e3a1]/20 text-[#a6e3a1] border border-[#a6e3a1]/30">
            <CheckCircle2 size={12} />
            Hoàn tất
          </span>
        );
      case 'packaging':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#cba6f7]/20 text-[#cba6f7] border border-[#cba6f7]/30 animate-pulse">
            <Sparkles size={12} />
            Đang đóng gói
          </span>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#89b4fa]/20 text-[#89b4fa] border border-[#89b4fa]/30">
            <Loader2 size={12} className="animate-spin" />
            Đang tải
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#f38ba8]/20 text-[#f38ba8] border border-[#f38ba8]/30">
            <AlertCircle size={12} />
            Thất bại
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#a6adc8]/20 text-[#a6adc8]">
            <Clock size={12} />
            Đang chờ
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden select-none">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-[#313244] bg-[#181825]/80 backdrop-blur-md shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#cdd6f4] flex items-center gap-2">
            <Download size={22} className="text-[#b4befe]" />
            <span>Tiến trình tải về</span>
          </h1>
          <p className="text-xs text-[#a6adc8] mt-0.5">
            Quản lý và giám sát tiến trình tải truyện đa luồng thời gian thực
          </p>
        </div>
        <div className="px-3 py-1 rounded-xl bg-[#313244] text-[#b4befe] text-xs font-bold">
          {tasks.length} tác vụ
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 max-w-5xl mx-auto w-full">
        {tasks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086] text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#313244]/40 flex items-center justify-center text-[#6c7086]">
              <Download size={32} />
            </div>
            <p className="text-sm font-medium text-[#a6adc8]">Hàng đợi tải về đang trống</p>
            <p className="text-xs text-[#6c7086]">
              Chọn truyện từ tab Khám phá và bấm nút tải để thêm vào danh sách
            </p>
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
                className="p-4 rounded-2xl bg-[#181825] border border-[#313244]/60 hover:border-[#b4befe]/30 transition-all shadow-md flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="overflow-hidden">
                    <h3 className="font-bold text-sm sm:text-base text-[#cdd6f4] truncate">
                      {task.manga_title}
                    </h3>
                    <p className="text-xs text-[#a6adc8] mt-0.5 truncate">
                      {task.chapter_title} •{' '}
                      <span className="uppercase font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#313244] text-[#b4befe]">
                        {task.file_format}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0">{getStatusBadge(task.status)}</div>
                </div>

                {/* Progress Bar Container */}
                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-[#313244] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#b4befe] to-[#cba6f7] transition-all duration-300 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[11px] font-mono text-[#a6adc8]">
                    <span>
                      {task.downloaded_pages} / {task.total_pages > 0 ? task.total_pages : '...'} trang
                    </span>
                    <span className="font-bold text-[#cdd6f4]">{progress}%</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
