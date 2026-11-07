import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/catppuccin_theme.dart';
import '../../../../data/models/manga_models.dart';
import '../view_models/downloads_view_model.dart';

/// Màn hình Quản lý Tiến độ Tải Truyện Real-Time
class DownloadsView extends StatelessWidget {
  const DownloadsView({super.key});

  @override
  Widget build(BuildContext context) {
    final viewModel = context.watch<DownloadsViewModel>();
    final tasks = viewModel.tasks;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tiến trình Tải truyện', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: CatppuccinMocha.mantle,
        elevation: 0,
      ),
      body: tasks.isEmpty
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.download_done_rounded, color: CatppuccinMocha.overlay0, size: 54),
                  SizedBox(height: 12),
                  Text(
                    'Chưa có tác vụ tải nào.',
                    style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 14),
                  ),
                ],
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: tasks.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final task = tasks[index];
                return _DownloadTaskCard(task: task);
              },
            ),
    );
  }
}

class _DownloadTaskCard extends StatelessWidget {
  final DownloadTaskStatus task;

  const _DownloadTaskCard({required this.task});

  Widget _buildStatusIndicator() {
    if (task.isRunning) {
      return const SizedBox(
        width: 18,
        height: 18,
        child: CircularProgressIndicator(strokeWidth: 2, color: CatppuccinMocha.lavender),
      );
    }
    if (task.isCompleted) {
      return const Icon(Icons.check_circle_rounded, color: CatppuccinMocha.teal, size: 20);
    }
    if (task.isFailed) {
      return const Icon(Icons.error_rounded, color: CatppuccinMocha.red, size: 20);
    }
    return const Icon(Icons.hourglass_empty_rounded, color: CatppuccinMocha.subtext0, size: 20);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: CatppuccinMocha.surface0,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: CatppuccinMocha.surface1, width: 0.8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: Task ID & Status
          Row(
            children: [
              _buildStatusIndicator(),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '${task.sourceId.toUpperCase()} • ${task.mangaId}',
                  style: const TextStyle(
                    color: CatppuccinMocha.text,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: CatppuccinMocha.mantle,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  task.format.toUpperCase(),
                  style: const TextStyle(color: CatppuccinMocha.lavender, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Thanh tiến trình phần trăm
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: task.percent > 0 ? (task.percent / 100).clamp(0.0, 1.0) : null,
              backgroundColor: CatppuccinMocha.mantle,
              color: task.isCompleted ? CatppuccinMocha.teal : CatppuccinMocha.lavender,
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 10),

          // Thông số chi tiết 2 tầng: Chương & Trang ảnh
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Chương: ${task.completedChapters}/${task.totalChapters}',
                style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11),
              ),
              Text(
                'Trang: ${task.completedPages}/${task.totalPages}',
                style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11),
              ),
              Text(
                '${task.percent.toStringAsFixed(1)}%',
                style: const TextStyle(
                  color: CatppuccinMocha.lavender,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),

          if (task.error != null) ...[
            const SizedBox(height: 8),
            Text(
              'Lỗi: ${task.error}',
              style: const TextStyle(color: CatppuccinMocha.red, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}
