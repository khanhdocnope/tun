import 'dart:ui';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/catppuccin_theme.dart';
import '../../../../data/models/manga_models.dart';
import '../../downloads/view_models/downloads_view_model.dart';
import '../view_models/browse_view_model.dart';

/// Màn hình Chi tiết Manga & Chọn tải chương
class MangaDetailView extends StatefulWidget {
  final String sourceId;
  final String mangaId;
  final String fallbackTitle;
  final String? fallbackCoverUrl;

  const MangaDetailView({
    super.key,
    required this.sourceId,
    required this.mangaId,
    required this.fallbackTitle,
    this.fallbackCoverUrl,
  });

  @override
  State<MangaDetailView> createState() => _MangaDetailViewState();
}

class _MangaDetailViewState extends State<MangaDetailView> {
  late Future<MangaInfo> _detailFuture;
  String _selectedFormat = 'cbz';
  final TextEditingController _rangeController = TextEditingController(text: '1-3');
  bool _isDescriptionExpanded = false;

  @override
  void initState() {
    super.initState();
    _detailFuture = context.read<BrowseViewModel>().getMangaDetails(widget.mangaId);
  }

  @override
  void dispose() {
    _rangeController.dispose();
    super.dispose();
  }

  Future<void> _startDownload(BuildContext context, {String? singleChapterId}) async {
    final downloadsVM = context.read<DownloadsViewModel>();
    try {
      final taskId = await downloadsVM.startDownload(
        source: widget.sourceId,
        mangaId: widget.mangaId,
        chapterIds: singleChapterId != null ? [singleChapterId] : null,
        chapters: singleChapterId == null ? _rangeController.text.trim() : null,
        format: _selectedFormat,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: CatppuccinMocha.surface0,
            content: Row(
              children: [
                const Icon(Icons.downloading_rounded, color: CatppuccinMocha.lavender, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Đã bắt đầu tải tác vụ: $taskId',
                    style: const TextStyle(color: CatppuccinMocha.text, fontSize: 13),
                  ),
                ),
              ],
            ),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: CatppuccinMocha.red,
            content: Text('Lỗi bắt đầu tải: $e'),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: FutureBuilder<MangaInfo>(
        future: _detailFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: CatppuccinMocha.lavender));
          }

          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.error_outline_rounded, color: CatppuccinMocha.red, size: 48),
                    const SizedBox(height: 12),
                    Text(
                      'Lỗi tải chi tiết truyện: ${snapshot.error}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: CatppuccinMocha.subtext0),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Quay lại'),
                    ),
                  ],
                ),
              ),
            );
          }

          final manga = snapshot.data!;
          final coverUrl = manga.coverUrl ?? widget.fallbackCoverUrl;

          return CustomScrollView(
            slivers: [
              // 1. Sliver AppBar với Backdrop mờ nghệ thuật
              SliverAppBar(
                expandedHeight: 260,
                pinned: true,
                backgroundColor: CatppuccinMocha.mantle,
                flexibleSpace: FlexibleSpaceBar(
                  background: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (coverUrl != null && coverUrl.isNotEmpty)
                        ImageFiltered(
                          imageFilter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                          child: CachedNetworkImage(
                            imageUrl: coverUrl,
                            fit: BoxFit.cover,
                            color: CatppuccinMocha.crust.withOpacity(0.65),
                            colorBlendMode: BlendMode.darken,
                          ),
                        ),
                      Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.transparent,
                              CatppuccinMocha.base.withOpacity(0.95),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        bottom: 16,
                        left: 20,
                        right: 20,
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: SizedBox(
                                width: 95,
                                height: 135,
                                child: coverUrl != null && coverUrl.isNotEmpty
                                    ? CachedNetworkImage(imageUrl: coverUrl, fit: BoxFit.cover)
                                    : Container(color: CatppuccinMocha.surface0),
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    manga.title,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: CatppuccinMocha.text,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    manga.authors.isNotEmpty ? manga.authors.join(', ') : 'Chưa rõ tác giả',
                                    style: const TextStyle(color: CatppuccinMocha.lavender, fontSize: 13),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    '${manga.chapters.length} chương khả dụng',
                                    style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 2. Tóm tắt nội dung & Thể loại (Synopsis & Genres)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (manga.genres.isNotEmpty) ...[
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: manga.genres.map((g) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: CatppuccinMocha.surface0,
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: CatppuccinMocha.surface1, width: 0.6),
                              ),
                              child: Text(
                                g,
                                style: const TextStyle(color: CatppuccinMocha.mauve, fontSize: 11),
                              ),
                            );
                          }).toList(),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (manga.description != null && manga.description!.isNotEmpty) ...[
                        InkWell(
                          onTap: () => setState(() => _isDescriptionExpanded = !_isDescriptionExpanded),
                          child: Text(
                            manga.description!,
                            maxLines: _isDescriptionExpanded ? 100 : 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: CatppuccinMocha.subtext1,
                              fontSize: 13,
                              height: 1.45,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      // 3. Khung cài đặt tải nhanh (Quick Download Bar)
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: CatppuccinMocha.surface0,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: CatppuccinMocha.surface1, width: 0.8),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Tùy chọn Tải xuống hàng loạt',
                              style: TextStyle(color: CatppuccinMocha.lavender, fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                // Định dạng
                                DropdownButton<String>(
                                  value: _selectedFormat,
                                  dropdownColor: CatppuccinMocha.surface0,
                                  underline: const SizedBox(),
                                  items: const [
                                    DropdownMenuItem(value: 'cbz', child: Text('CBZ (ComicInfo.xml)')),
                                    DropdownMenuItem(value: 'zip', child: Text('ZIP (Ảnh thô AI Cleaner)')),
                                    DropdownMenuItem(value: 'images', child: Text('Thư mục ảnh rời')),
                                    DropdownMenuItem(value: 'pdf', child: Text('Tài liệu PDF')),
                                  ],
                                  onChanged: (val) {
                                    if (val != null) setState(() => _selectedFormat = val);
                                  },
                                ),
                                const SizedBox(width: 12),

                                // Dải chương
                                Expanded(
                                  child: TextField(
                                    controller: _rangeController,
                                    decoration: const InputDecoration(
                                      hintText: 'VD: 1-5, all',
                                      isDense: true,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),

                                // Nút bấm tải
                                ElevatedButton.icon(
                                  onPressed: () => _startDownload(context),
                                  icon: const Icon(Icons.download_rounded, size: 18),
                                  label: const Text('Tải'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Danh sách chương',
                        style: TextStyle(color: CatppuccinMocha.text, fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                    ],
                  ),
                ),
              ),

              // 4. Danh sách các Chapter
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    final chapter = manga.chapters[index];
                    return ListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                      title: Text(
                        'Chương ${chapter.chapterNumber}${chapter.title != null && chapter.title!.isNotEmpty ? " - ${chapter.title}" : ""}',
                        style: const TextStyle(color: CatppuccinMocha.text, fontSize: 13.5, fontWeight: FontWeight.w500),
                      ),
                      subtitle: Text(
                        chapter.scanlator ?? 'Mặc định',
                        style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11),
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.download_rounded, color: CatppuccinMocha.lavender, size: 20),
                        tooltip: 'Tải chương này',
                        onPressed: () => _startDownload(context, singleChapterId: chapter.id),
                      ),
                    );
                  },
                  childCount: manga.chapters.length,
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          );
        },
      ),
    );
  }
}
