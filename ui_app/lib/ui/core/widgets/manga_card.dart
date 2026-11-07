import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/catppuccin_theme.dart';
import '../../../../data/models/manga_models.dart';
import 'source_badge.dart';

/// Thẻ hiển thị truyện Manga chuẩn phong cách tối giản Catppuccin
class MangaCard extends StatelessWidget {
  final MangaSearchResult manga;
  final String sourceId;
  final VoidCallback onTap;

  const MangaCard({
    super.key,
    required this.manga,
    required this.sourceId,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Ảnh bìa truyện tỷ lệ Manga chuẩn (3:4.2)
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Container(color: CatppuccinMocha.surface0),
                  if (manga.coverUrl != null && manga.coverUrl!.isNotEmpty)
                    CachedNetworkImage(
                      imageUrl: manga.coverUrl!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: CatppuccinMocha.lavender.withOpacity(0.5),
                          ),
                        ),
                      ),
                      errorWidget: (context, url, error) => const Center(
                        child: Icon(Icons.broken_image_rounded, color: CatppuccinMocha.overlay0, size: 36),
                      ),
                    )
                  else
                    const Center(
                      child: Icon(Icons.menu_book_rounded, color: CatppuccinMocha.overlay0, size: 36),
                    ),

                  // Lớp Gradient tối dần phía dưới chân ảnh bìa
                  Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.transparent,
                            Colors.transparent,
                            CatppuccinMocha.crust.withOpacity(0.85),
                          ],
                          stops: const [0.0, 0.65, 1.0],
                        ),
                      ),
                    ),
                  ),

                  // Badge Nguồn truyện ở góc trên
                  Positioned(
                    top: 8,
                    left: 8,
                    child: SourceBadge(sourceId: sourceId),
                  ),

                  // Badge số chương mới nhất ở góc dưới
                  if (manga.latestChapter != null && manga.latestChapter!.isNotEmpty)
                    Positioned(
                      bottom: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: CatppuccinMocha.crust.withOpacity(0.85),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: CatppuccinMocha.surface1, width: 0.5),
                        ),
                        child: Text(
                          'Ch. ${manga.latestChapter}',
                          style: const TextStyle(
                            color: CatppuccinMocha.lavender,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),

          // 2. Tiêu đề truyện
          Text(
            manga.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: CatppuccinMocha.text,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
          ),
        ],
      ),
    );
  }
}
