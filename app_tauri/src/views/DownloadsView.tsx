import React, { useEffect, useState } from 'react';
import { Download, FolderOpen, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
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
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#a6e3a1]/20 text-[#a6e3a1]">
            <CheckCircle2 size={12} />
            Hoàn tất
          </span>
        );
      case 'packaging':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#cba6f7]/20 text-[#cba6f7]">
            <Sparkles size={12} />
            Đang đóng gói
          </span>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#b4befe]/20 text-[#b4befe]">
            <Loader2 size={12} className="animate-spin" />
            Đang tải
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#f38ba8]/20 text-[#f38ba8]">
            <AlertCircle size={12} />
            Thất bại
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#313244] text-[#a6adc8]">
            Chờ tải
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-[#313244] bg-[#181825]/60 backdrop-blur-md flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#cdd6f4] flex items-center gap-2">
            <Download size={20} className="text-[#b4befe]" />
            <span>Hàng đợi tải về</span>
          </h1>
          <p className="text-xs text-[#a6adc8]">
            Theo dõi tiến trình tải ảnh và đóng gói truyện theo thời gian thực
          </p>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
        {tasks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086]">
            <Download size={48} className="opacity-40" />
            <p className="text-sm">Hàng đợi tải về đang trống</p>
            <p className="text-xs text-[#a6adc8]">
              Hãy chuyển sang tab "Khám phá" để chọn chương truyện muốn tải!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const progress = task.total_pages > 0
                ? Math.round((task.downloaded_pages / task.total_pages) * 100)
                : 0;

              return (
                <div
                  key={task.id}
                  className="p-4 rounded-2xl bg-[#181825] border border-[#313244]/60 flex flex-col gap-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-sm text-[#cdd6f4]">{task.manga_title}</h3>
                      <p className="text-xs text-[#a6adc8] mt-0.5">{task.chapter_title}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#313244] text-[#b4befe]">
                        {task.file_format.toUpperCase()}
                      </span>
                      {getStatusBadge(task.status)}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-[#313244] h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === 'completed'
                          ? 'bg-[#a6e3a1]'
                          : task.status === 'failed'
                          ? 'bg-[#f38ba8]'
                          : 'bg-[#b4befe]'
                      }`}
                      style={{ width: `${task.status === 'completed' ? 100 : progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#a6adc8]">
                    <span>
                      {task.status === 'completed'
                        ? 'Đã tải & đóng gói thành công!'
                        : task.status === 'packaging'
                        ? 'Đang nén file CBZ/ZIP...'
                        : `${task.downloaded_pages} / ${task.total_pages} trang`}
                    </span>
                    <span className="font-semibold text-[#cdd6f4]">
                      {task.status === 'completed' ? '100%' : `${progress}%`}
                    </span>
                  </div>

                  {task.error_message && (
                    <p className="text-xs text-[#f38ba8] bg-[#f38ba8]/10 p-2 rounded-lg">
                      {task.error_message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
