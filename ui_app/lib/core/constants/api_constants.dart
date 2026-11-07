/// Các hằng số URL và cấu hình kết nối tới Python Core Engine
class ApiConstants {
  /// URL máy chủ mặc định (Local Engine chạy trên PC)
  static const String defaultBaseUrl = 'http://127.0.0.1:8000';

  // Endpoints
  static const String healthEndpoint = '/api/health';
  static const String sourcesEndpoint = '/api/sources';
  static const String searchEndpoint = '/api/search';
  static const String mangaEndpoint = '/api/manga';
  static const String downloadEndpoint = '/api/download';

  // Polling interval cho Background Download tasks
  static const Duration downloadPollInterval = Duration(milliseconds: 800);
}
