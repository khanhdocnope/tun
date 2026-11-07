import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../core/constants/api_constants.dart';
import '../models/manga_models.dart';

/// Dịch vụ kết nối và giao tiếp REST API với Headless Python Engine (FastAPI)
class ApiService {
  String baseUrl;
  final http.Client _client;

  ApiService({
    String? baseUrl,
    http.Client? client,
  })  : baseUrl = baseUrl ?? ApiConstants.defaultBaseUrl,
        _client = client ?? http.Client();

  void updateBaseUrl(String newUrl) {
    baseUrl = newUrl.replaceAll(RegExp(r'/+$'), '');
  }

  /// 1. Kiểm tra trạng thái máy chủ Python Engine
  Future<bool> checkHealth() async {
    try {
      final response = await _client
          .get(Uri.parse('$baseUrl${ApiConstants.healthEndpoint}'))
          .timeout(const Duration(seconds: 3));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// 2. Lấy danh sách các nguồn truyện được hỗ trợ (MangaDex, Cuutruyen, Comix.to)
  Future<List<SourceMetadata>> getSources() async {
    final response = await _client.get(Uri.parse('$baseUrl${ApiConstants.sourcesEndpoint}'));
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      List<dynamic> items = [];
      if (decoded is List) {
        items = decoded;
      } else if (decoded is Map && decoded['sources'] is List) {
        items = decoded['sources'] as List<dynamic>;
      }
      return items.map((item) => SourceMetadata.fromJson(item as Map<String, dynamic>)).toList();
    }
    throw Exception('Không thể tải danh sách nguồn truyện: ${response.statusCode}');
  }

  /// 3. Tìm kiếm truyện trên nguồn chỉ định
  Future<List<MangaSearchResult>> searchManga({
    required String source,
    required String query,
    int page = 1,
  }) async {
    final uri = Uri.parse('$baseUrl${ApiConstants.searchEndpoint}').replace(
      queryParameters: {
        'source': source,
        'q': query,
        'page': page.toString(),
      },
    );

    final response = await _client.get(uri);
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      List<dynamic> items = [];
      if (decoded is List) {
        items = decoded;
      } else if (decoded is Map && decoded['results'] is List) {
        items = decoded['results'] as List<dynamic>;
      }
      return items.map((item) => MangaSearchResult.fromJson(item as Map<String, dynamic>)).toList();
    }
    throw Exception('Lỗi khi tìm kiếm manga: ${response.statusCode}');
  }

  /// 4. Lấy thông tin chi tiết manga và danh sách chapters
  Future<MangaInfo> getMangaDetails({
    required String source,
    required String mangaId,
  }) async {
    final encodedId = Uri.encodeComponent(mangaId);
    final response = await _client.get(
      Uri.parse('$baseUrl${ApiConstants.mangaEndpoint}/$source/$encodedId'),
    );

    if (response.statusCode == 200) {
      final data = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      return MangaInfo.fromJson(data);
    }
    throw Exception('Không thể lấy chi tiết manga: ${response.statusCode}');
  }

  /// 5. Khởi tạo tác vụ tải chapter ngầm (Background Task)
  Future<String> startDownload({
    required String source,
    required String mangaId,
    String? chapters,
    List<String>? chapterIds,
    String format = 'cbz',
    String? outputDir,
  }) async {
    final payload = {
      'source': source,
      'manga_id': mangaId,
      if (chapters != null) 'chapters': chapters,
      if (chapterIds != null) 'chapter_ids': chapterIds,
      'format': format,
      if (outputDir != null) 'output_dir': outputDir,
    };

    final response = await _client.post(
      Uri.parse('$baseUrl${ApiConstants.downloadEndpoint}'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode(payload),
    );

    if (response.statusCode == 202) {
      final data = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      return data['task_id'] as String;
    }
    throw Exception('Không thể khởi tạo tác vụ tải: ${response.statusCode} - ${response.body}');
  }

  /// 6. Tra cứu tiến độ tải theo task_id
  Future<DownloadTaskStatus> getDownloadStatus(String taskId) async {
    final response = await _client.get(
      Uri.parse('$baseUrl${ApiConstants.downloadEndpoint}/$taskId'),
    );

    if (response.statusCode == 200) {
      final data = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      return DownloadTaskStatus.fromJson(data);
    }
    throw Exception('Không tìm thấy thông tin tác vụ $taskId: ${response.statusCode}');
  }

  void dispose() {
    _client.close();
  }
}
