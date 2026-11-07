import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/catppuccin_theme.dart';
import '../../../core/widgets/manga_card.dart';
import '../view_models/browse_view_model.dart';
import 'manga_detail_view.dart';

/// Màn hình Khám phá & Tìm kiếm Truyện (Browse & Search)
class BrowseView extends StatefulWidget {
  const BrowseView({super.key});

  @override
  State<BrowseView> createState() => _BrowseViewState();
}

class _BrowseViewState extends State<BrowseView> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchSubmitted(String query) {
    if (query.trim().isNotEmpty) {
      context.read<BrowseViewModel>().search(query);
    }
  }

  @override
  Widget build(BuildContext context) {
    final viewModel = context.watch<BrowseViewModel>();

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // 1. Header & Thanh tìm kiếm tối giản
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _searchController,
                textInputAction: TextInputAction.search,
                onSubmitted: _onSearchSubmitted,
                decoration: InputDecoration(
                  hintText: 'Tìm kiếm manga, tác giả trên ${viewModel.currentSource?.name ?? "nguồn"}...',
                  prefixIcon: const Icon(Icons.search_rounded, color: CatppuccinMocha.lavender),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, color: CatppuccinMocha.subtext0, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        )
                      : null,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),

            // 2. Bộ chọn nguồn truyện (MangaDex, Cứu Truyện, Comix.to)
            SizedBox(
              height: 46,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                scrollDirection: Axis.horizontal,
                itemCount: viewModel.sources.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final source = viewModel.sources[index];
                  final isSelected = source.id == viewModel.selectedSourceId;

                  return ChoiceChip(
                    label: Text(source.name),
                    selected: isSelected,
                    onSelected: (_) => viewModel.selectSource(source.id),
                    backgroundColor: CatppuccinMocha.surface0,
                    selectedColor: CatppuccinMocha.lavender,
                    labelStyle: TextStyle(
                      color: isSelected ? CatppuccinMocha.crust : CatppuccinMocha.text,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                      fontSize: 13,
                    ),
                    side: BorderSide(
                      color: isSelected ? CatppuccinMocha.lavender : CatppuccinMocha.surface1,
                      width: 0.8,
                    ),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    showCheckmark: false,
                  );
                },
              ),
            ),
            const SizedBox(height: 8),

            // 3. Khu vực danh sách kết quả (Responsive Grid)
            Expanded(
              child: Builder(
                builder: (context) {
                  if (viewModel.isLoading) {
                    return const Center(
                      child: CircularProgressIndicator(color: CatppuccinMocha.lavender),
                    );
                  }

                  if (viewModel.errorMessage != null) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24.0),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.cloud_off_rounded, color: CatppuccinMocha.red, size: 48),
                            const SizedBox(height: 12),
                            Text(
                              viewModel.errorMessage!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 14),
                            ),
                            const SizedBox(height: 16),
                            ElevatedButton.icon(
                              onPressed: () => viewModel.loadSources(),
                              icon: const Icon(Icons.refresh_rounded, size: 18),
                              label: const Text('Thử lại'),
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  if (viewModel.searchResults.isEmpty) {
                    return const Center(
                      child: Text(
                        'Không tìm thấy truyện nào phù hợp.',
                        style: TextStyle(color: CatppuccinMocha.subtext0),
                      ),
                    );
                  }

                  return LayoutBuilder(
                    builder: (context, constraints) {
                      // Tính toán số cột tự động theo độ rộng màn hình
                      final width = constraints.maxWidth;
                      int crossAxisCount = 2; // Mobile nhỏ
                      if (width >= 1200) {
                        crossAxisCount = 6;
                      } else if (width >= 900) {
                        crossAxisCount = 5;
                      } else if (width >= 600) {
                        crossAxisCount = 4;
                      } else if (width >= 400) {
                        crossAxisCount = 3;
                      }

                      return GridView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: crossAxisCount,
                          childAspectRatio: 0.65, // Tỷ lệ card Manga tiêu chuẩn
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 16,
                        ),
                        itemCount: viewModel.searchResults.length,
                        itemBuilder: (context, index) {
                          final manga = viewModel.searchResults[index];
                          return MangaCard(
                            manga: manga,
                            sourceId: viewModel.selectedSourceId,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => MangaDetailView(
                                    sourceId: viewModel.selectedSourceId,
                                    mangaId: manga.id,
                                    fallbackTitle: manga.title,
                                    fallbackCoverUrl: manga.coverUrl,
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
