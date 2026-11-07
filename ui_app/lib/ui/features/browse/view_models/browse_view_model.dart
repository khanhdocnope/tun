import 'package:flutter/material.dart';
import '../../../../data/models/manga_models.dart';
import '../../../../data/repositories/manga_repository.dart';

/// ViewModel quản lý trạng thái tìm kiếm và khám phá truyện
class BrowseViewModel extends ChangeNotifier {
  final MangaRepository _repository;

  List<SourceMetadata> _sources = [];
  String _selectedSourceId = 'mangadex';
  List<MangaSearchResult> _searchResults = [];
  bool _isLoading = false;
  String? _errorMessage;
  String _currentQuery = '';

  BrowseViewModel({required MangaRepository repository}) : _repository = repository {
    loadSources();
  }

  List<SourceMetadata> get sources => _sources;
  String get selectedSourceId => _selectedSourceId;
  List<MangaSearchResult> get searchResults => _searchResults;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String get currentQuery => _currentQuery;

  SourceMetadata? get currentSource {
    try {
      return _sources.firstWhere((s) => s.id == _selectedSourceId);
    } catch (_) {
      return null;
    }
  }

  /// Nạp danh sách các nguồn truyện khả dụng
  Future<void> loadSources() async {
    try {
      _isLoading = true;
      _errorMessage = null;
      notifyListeners();

      _sources = await _repository.getSources();
      if (_sources.isNotEmpty && !_sources.any((s) => s.id == _selectedSourceId)) {
        _selectedSourceId = _sources.first.id;
      }

      // Tự động nạp danh sách truyện mới cập nhật khi mở app
      if (_searchResults.isEmpty) {
        await search('');
      }
    } catch (e) {
      _errorMessage = 'Không thể kết nối tới Core Engine. Vui lòng đảm bảo FastAPI Server đang chạy!';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Đổi nguồn truyện được chọn
  void selectSource(String sourceId) {
    if (_selectedSourceId != sourceId) {
      _selectedSourceId = sourceId;
      notifyListeners();
      search(_currentQuery);
    }
  }

  /// Thực hiện tìm kiếm truyện (Nếu rỗng sẽ lấy truyện mới cập nhật)
  Future<void> search(String query) async {
    final clean = query.trim();
    _currentQuery = clean;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _searchResults = await _repository.searchManga(
        source: _selectedSourceId,
        query: clean,
      );
    } catch (e) {
      _errorMessage = 'Lỗi tải truyện: $e';
      _searchResults = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Lấy chi tiết manga
  Future<MangaInfo> getMangaDetails(String mangaId) {
    return _repository.getMangaDetails(
      source: _selectedSourceId,
      mangaId: mangaId,
    );
  }
}
