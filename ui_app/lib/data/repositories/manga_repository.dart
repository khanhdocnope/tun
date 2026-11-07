import '../models/manga_models.dart';
import '../services/api_service.dart';

/// Repository đóng gói dữ liệu và cache cho tầng Presentation (UI)
class MangaRepository {
  final ApiService _apiService;

  List<SourceMetadata>? _cachedSources;

  MangaRepository({required ApiService apiService}) : _apiService = apiService;

  Future<bool> checkEngineHealth() => _apiService.checkHealth();

  Future<List<SourceMetadata>> getSources({bool forceRefresh = false}) async {
    if (_cachedSources != null && !forceRefresh) {
      return _cachedSources!;
    }
    final sources = await _apiService.getSources();
    _cachedSources = sources;
    return sources;
  }

  Future<List<MangaSearchResult>> searchManga({
    required String source,
    required String query,
    int page = 1,
  }) {
    return _apiService.searchManga(source: source, query: query, page: page);
  }

  Future<MangaInfo> getMangaDetails({
    required String source,
    required String mangaId,
  }) {
    return _apiService.getMangaDetails(source: source, mangaId: mangaId);
  }

  Future<String> startDownload({
    required String source,
    required String mangaId,
    String? chapters,
    List<String>? chapterIds,
    String format = 'cbz',
    String? outputDir,
  }) {
    return _apiService.startDownload(
      source: source,
      mangaId: mangaId,
      chapters: chapters,
      chapterIds: chapterIds,
      format: format,
      outputDir: outputDir,
    );
  }

  Future<DownloadTaskStatus> getDownloadStatus(String taskId) {
    return _apiService.getDownloadStatus(taskId);
  }
}
