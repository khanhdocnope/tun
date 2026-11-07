import 'package:flutter_test/flutter_test.dart';
import 'package:moeject_app/data/models/manga_models.dart';

void main() {
  group('Manga Models JSON Parsing Tests', () {
    test('SourceMetadata parses correctly', () {
      final json = {
        'id': 'mangadex',
        'name': 'MangaDex',
        'url': 'https://mangadex.org',
        'languages': ['vi', 'en'],
        'description': 'MangaDex API',
        'needs_browser_bypass': false,
        'status': 'active',
      };

      final meta = SourceMetadata.fromJson(json);
      expect(meta.id, 'mangadex');
      expect(meta.name, 'MangaDex');
      expect(meta.languages, ['vi', 'en']);
      expect(meta.needsBrowserBypass, false);
    });

    test('MangaSearchResult parses with null cover gracefully', () {
      final json = {
        'id': 'z0l20',
        'title': 'One-Punch Man',
        'url': 'https://example.com/title/z0l20',
        'cover_url': null,
        'latest_chapter': '200',
        'authors': ['ONE', 'Murata'],
        'genres': ['Action', 'Comedy'],
      };

      final result = MangaSearchResult.fromJson(json);
      expect(result.id, 'z0l20');
      expect(result.title, 'One-Punch Man');
      expect(result.coverUrl, isNull);
      expect(result.latestChapter, '200');
      expect(result.authors.length, 2);
    });

    test('MangaInfo and Chapter list parse correctly', () {
      final json = {
        'id': '1106',
        'title': 'Dandadan',
        'url': 'https://cuutruyen.net/mangas/1106',
        'cover_url': 'https://cdn.example.com/cover.jpg',
        'description': 'A supernatural manga',
        'authors': ['Tatsu Yukinobu'],
        'genres': ['Action', 'Supernatural'],
        'status': 'ongoing',
        'chapters': [
          {
            'id': 'c1',
            'chapter_number': '1',
            'title': 'Kỳ ngộ',
            'url': 'https://cuutruyen.net/chapters/c1',
            'scanlator': 'Cứu Truyện',
            'release_date': '2026-01-01',
          },
          {
            'id': 'c2',
            'chapter_number': '2',
            'title': 'Chiến đấu',
            'url': 'https://cuutruyen.net/chapters/c2',
            'scanlator': 'Cứu Truyện',
          }
        ],
      };

      final info = MangaInfo.fromJson(json);
      expect(info.id, '1106');
      expect(info.title, 'Dandadan');
      expect(info.chapters.length, 2);
      expect(info.chapters.first.chapterNumber, '1');
      expect(info.chapters.last.chapterNumber, '2');
    });

    test('DownloadTaskStatus parses percent and running status correctly', () {
      final json = {
        'task_id': 'task-123',
        'status': 'running',
        'source_id': 'mangadex',
        'manga_id': 'manga-abc',
        'format': 'cbz',
        'total_chapters': 5,
        'completed_chapters': 2,
        'total_pages': 100,
        'completed_pages': 45,
        'percent': 45.0,
        'results': [
          {
            'chapter_id': 'ch-1',
            'chapter_number': '1',
            'success': true,
            'output_path': 'downloads/ch-1.cbz',
            'page_count': 22,
          }
        ],
      };

      final task = DownloadTaskStatus.fromJson(json);
      expect(task.taskId, 'task-123');
      expect(task.isRunning, isTrue);
      expect(task.isCompleted, isFalse);
      expect(task.percent, 45.0);
      expect(task.results.length, 1);
      expect(task.results.first.success, isTrue);
    });
  });
}
