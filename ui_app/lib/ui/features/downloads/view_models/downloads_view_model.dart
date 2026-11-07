import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../data/models/manga_models.dart';
import '../../../../data/repositories/manga_repository.dart';

/// ViewModel theo dõi và quản lý các tác vụ tải truyện trong nền
class DownloadsViewModel extends ChangeNotifier {
  final MangaRepository _repository;

  final Map<String, DownloadTaskStatus> _tasks = {};
  Timer? _pollTimer;

  DownloadsViewModel({required MangaRepository repository}) : _repository = repository;

  List<DownloadTaskStatus> get tasks => _tasks.values.toList().reversed.toList();

  int get runningCount => _tasks.values.where((t) => t.isRunning).length;

  /// Bắt đầu một tác vụ tải mới và kích hoạt polling
  Future<String> startDownload({
    required String source,
    required String mangaId,
    String? chapters,
    List<String>? chapterIds,
    String format = 'cbz',
    String? outputDir,
  }) async {
    final taskId = await _repository.startDownload(
      source: source,
      mangaId: mangaId,
      chapters: chapters,
      chapterIds: chapterIds,
      format: format,
      outputDir: outputDir,
    );

    // Nạp trạng thái ban đầu
    _tasks[taskId] = DownloadTaskStatus(
      taskId: taskId,
      status: 'pending',
      sourceId: source,
      mangaId: mangaId,
      format: format,
      totalChapters: 0,
      completedChapters: 0,
      totalPages: 0,
      completedPages: 0,
      percent: 0.0,
      results: [],
    );
    notifyListeners();

    _ensurePolling();
    return taskId;
  }

  void _ensurePolling() {
    if (_pollTimer != null && _pollTimer!.isActive) return;

    _pollTimer = Timer.periodic(ApiConstants.downloadPollInterval, (timer) async {
      final runningTaskIds = _tasks.values.where((t) => t.isRunning).map((t) => t.taskId).toList();

      if (runningTaskIds.isEmpty) {
        timer.cancel();
        return;
      }

      for (final taskId in runningTaskIds) {
        try {
          final updatedStatus = await _repository.getDownloadStatus(taskId);
          _tasks[taskId] = updatedStatus;
        } catch (_) {
          // Bỏ qua lỗi mạng tạm thời trong một chu kỳ polling
        }
      }
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
