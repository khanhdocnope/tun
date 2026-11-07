/// Các cấu trúc dữ liệu Manga tương thích 100% với Pydantic Models từ FastAPI Core Engine

class SourceMetadata {
  final String id;
  final String name;
  final String url;
  final List<String> languages;
  final String? description;
  final bool needsBrowserBypass;
  final String status;

  SourceMetadata({
    required this.id,
    required this.name,
    required this.url,
    required this.languages,
    this.description,
    required this.needsBrowserBypass,
    required this.status,
  });

  factory SourceMetadata.fromJson(Map<String, dynamic> json) {
    return SourceMetadata(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      url: json['url'] as String? ?? '',
      languages: (json['languages'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      description: json['description'] as String?,
      needsBrowserBypass: json['needs_browser_bypass'] as bool? ?? false,
      status: json['status'] as String? ?? 'active',
    );
  }
}

class MangaSearchResult {
  final String id;
  final String title;
  final String url;
  final String? coverUrl;
  final String? latestChapter;
  final String? description;
  final List<String> authors;
  final List<String> genres;

  MangaSearchResult({
    required this.id,
    required this.title,
    required this.url,
    this.coverUrl,
    this.latestChapter,
    this.description,
    required this.authors,
    required this.genres,
  });

  factory MangaSearchResult.fromJson(Map<String, dynamic> json) {
    return MangaSearchResult(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Chưa rõ tiêu đề',
      url: json['url'] as String? ?? '',
      coverUrl: json['cover_url'] as String?,
      latestChapter: json['latest_chapter'] as String?,
      description: json['description'] as String?,
      authors: (json['authors'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      genres: (json['genres'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }
}

class Chapter {
  final String id;
  final String chapterNumber;
  final String? title;
  final String url;
  final String? scanlator;
  final String? releaseDate;

  Chapter({
    required this.id,
    required this.chapterNumber,
    this.title,
    required this.url,
    this.scanlator,
    this.releaseDate,
  });

  factory Chapter.fromJson(Map<String, dynamic> json) {
    return Chapter(
      id: json['id'] as String? ?? '',
      chapterNumber: json['chapter_number']?.toString() ?? '0',
      title: json['title'] as String?,
      url: json['url'] as String? ?? '',
      scanlator: json['scanlator'] as String?,
      releaseDate: json['release_date'] as String?,
    );
  }
}

class MangaInfo {
  final String id;
  final String title;
  final String url;
  final String? coverUrl;
  final String? description;
  final List<String> authors;
  final List<String> genres;
  final String? status;
  final List<Chapter> chapters;

  MangaInfo({
    required this.id,
    required this.title,
    required this.url,
    this.coverUrl,
    this.description,
    required this.authors,
    required this.genres,
    this.status,
    required this.chapters,
  });

  factory MangaInfo.fromJson(Map<String, dynamic> json) {
    return MangaInfo(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Chưa rõ tiêu đề',
      url: json['url'] as String? ?? '',
      coverUrl: json['cover_url'] as String?,
      description: json['description'] as String?,
      authors: (json['authors'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      genres: (json['genres'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      status: json['status'] as String?,
      chapters: (json['chapters'] as List<dynamic>?)
              ?.map((c) => Chapter.fromJson(c as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class ChapterDownloadResult {
  final String chapterId;
  final String chapterNumber;
  final bool success;
  final String? outputPath;
  final int pageCount;
  final String? error;

  ChapterDownloadResult({
    required this.chapterId,
    required this.chapterNumber,
    required this.success,
    this.outputPath,
    required this.pageCount,
    this.error,
  });

  factory ChapterDownloadResult.fromJson(Map<String, dynamic> json) {
    return ChapterDownloadResult(
      chapterId: json['chapter_id'] as String? ?? '',
      chapterNumber: json['chapter_number']?.toString() ?? '',
      success: json['success'] as bool? ?? false,
      outputPath: json['output_path'] as String?,
      pageCount: json['page_count'] as int? ?? 0,
      error: json['error'] as String?,
    );
  }
}

class DownloadTaskStatus {
  final String taskId;
  final String status;
  final String sourceId;
  final String mangaId;
  final String format;
  final int totalChapters;
  final int completedChapters;
  final int totalPages;
  final int completedPages;
  final double percent;
  final List<ChapterDownloadResult> results;
  final String? error;

  DownloadTaskStatus({
    required this.taskId,
    required this.status,
    required this.sourceId,
    required this.mangaId,
    required this.format,
    required this.totalChapters,
    required this.completedChapters,
    required this.totalPages,
    required this.completedPages,
    required this.percent,
    required this.results,
    this.error,
  });

  bool get isRunning => status == 'running' || status == 'pending';
  bool get isCompleted => status == 'completed';
  bool get isFailed => status == 'failed';

  factory DownloadTaskStatus.fromJson(Map<String, dynamic> json) {
    return DownloadTaskStatus(
      taskId: json['task_id'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      sourceId: json['source_id'] as String? ?? '',
      mangaId: json['manga_id'] as String? ?? '',
      format: json['format'] as String? ?? 'cbz',
      totalChapters: json['total_chapters'] as int? ?? 0,
      completedChapters: json['completed_chapters'] as int? ?? 0,
      totalPages: json['total_pages'] as int? ?? 0,
      completedPages: json['completed_pages'] as int? ?? 0,
      percent: (json['percent'] as num?)?.toDouble() ?? 0.0,
      results: (json['results'] as List<dynamic>?)
              ?.map((r) => ChapterDownloadResult.fromJson(r as Map<String, dynamic>))
              .toList() ??
          [],
      error: json['error'] as String?,
    );
  }
}
