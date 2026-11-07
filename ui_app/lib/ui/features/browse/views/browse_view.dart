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
    context.read<BrowseViewModel>().search(query);
  }

  void _openSourcePicker(BuildContext context, BrowseViewModel viewModel) {
    showModalBottomSheet(
      context: context,
      backgroundColor: CatppuccinMocha.mantle,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        String query = '';
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            final filtered = viewModel.sources.where((s) {
              if (query.isEmpty) return true;
              final q = query.toLowerCase();
              return s.name.toLowerCase().contains(q) ||
                  s.id.toLowerCase().contains(q) ||
                  s.languages.any((l) => l.toLowerCase().contains(q));
            }).toList();

            return DraggableScrollableSheet(
              initialChildSize: 0.75,
              minChildSize: 0.5,
              maxChildSize: 0.95,
              expand: false,
              builder: (_, scrollController) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Kho Nguồn Truyện (${viewModel.sources.length})',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: CatppuccinMocha.text,
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close_rounded, color: CatppuccinMocha.subtext0),
                            onPressed: () => Navigator.pop(ctx),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        decoration: const InputDecoration(
                          hintText: 'Tìm nguồn (vd: cuutruyen, asura, truyen)...',
                          prefixIcon: Icon(Icons.search_rounded, color: CatppuccinMocha.lavender),
                          isDense: true,
                        ),
                        onChanged: (val) {
                          setModalState(() {
                            query = val.trim();
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: ListView.separated(
                          controller: scrollController,
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const Divider(color: CatppuccinMocha.surface0, height: 1),
                          itemBuilder: (ctx, idx) {
                            final src = filtered[idx];
                            final isSel = src.id == viewModel.selectedSourceId;
                            return ListTile(
                              title: Text(
                                src.name,
                                style: TextStyle(
                                  color: isSel ? CatppuccinMocha.lavender : CatppuccinMocha.text,
                                  fontWeight: isSel ? FontWeight.bold : FontWeight.w500,
                                ),
                              ),
                              subtitle: Text(
                                src.url,
                                style: const TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: Chip(
                                label: Text(src.languages.join(', ').toUpperCase()),
                                labelStyle: const TextStyle(fontSize: 10, color: CatppuccinMocha.lavender),
                                backgroundColor: CatppuccinMocha.surface0,
                                visualDensity: VisualDensity.compact,
                              ),
                              onTap: () {
                                viewModel.selectSource(src.id);
                                Navigator.pop(ctx);
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
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
                            context.read<BrowseViewModel>().search('');
                          },
                        )
                      : null,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),

            // 2. Bộ chọn nguồn truyện & Nút mở toàn bộ 1,313 nguồn
            SizedBox(
              height: 46,
              child: Row(
                children: [
                  const SizedBox(width: 16),
                  ActionChip(
                    avatar: const Icon(Icons.explore_rounded, size: 16, color: CatppuccinMocha.lavender),
                    label: Text('${viewModel.sources.length} Nguồn'),
                    backgroundColor: CatppuccinMocha.surface1,
                    labelStyle: const TextStyle(
                      color: CatppuccinMocha.text,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    side: const BorderSide(color: CatppuccinMocha.surface2, width: 0.8),
                    onPressed: () => _openSourcePicker(context, viewModel),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 4),
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
                  const SizedBox(width: 16),
                ],
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
