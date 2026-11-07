import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme/catppuccin_theme.dart';
import '../../data/services/api_service.dart';
import '../features/browse/views/browse_view.dart';
import '../features/cleaner/views/cleaner_view.dart';
import '../features/downloads/view_models/downloads_view_model.dart';
import '../features/downloads/views/downloads_view.dart';
import '../features/library/views/library_view.dart';
import '../features/settings/views/settings_view.dart';

/// Khung điều hướng đa thích ứng (Adaptive Layout):
/// - Desktop (Width >= 768px): Navigation Rail siêu mảnh bên trái
/// - Mobile  (Width < 768px): Bottom Navigation Bar chuẩn Material 3
class ResponsiveScaffold extends StatefulWidget {
  final ApiService apiService;

  const ResponsiveScaffold({super.key, required this.apiService});

  @override
  State<ResponsiveScaffold> createState() => _ResponsiveScaffoldState();
}

class _ResponsiveScaffoldState extends State<ResponsiveScaffold> {
  int _currentIndex = 1; // Mặc định mở tab "Khám phá"

  late final List<Widget> _screens;

  @override
  void initState() {
    super.initState();
    _screens = [
      const LibraryView(),
      const BrowseView(),
      const CleanerView(),
      const DownloadsView(),
      SettingsView(apiService: widget.apiService),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final downloadsVM = context.watch<DownloadsViewModel>();
    final runningDownloads = downloadsVM.runningCount;

    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth >= 768;

        if (isDesktop) {
          // Bố cục Màn hình Lớn / Desktop: Navigation Rail bên trái
          return Scaffold(
            body: Row(
              children: [
                NavigationRail(
                  selectedIndex: _currentIndex,
                  onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
                  labelType: NavigationRailLabelType.all,
                  leading: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 20),
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: CatppuccinMocha.lavender.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.auto_stories_rounded, color: CatppuccinMocha.lavender, size: 26),
                    ),
                  ),
                  destinations: [
                    const NavigationRailDestination(
                      icon: Icon(Icons.collections_bookmark_outlined),
                      selectedIcon: Icon(Icons.collections_bookmark_rounded),
                      label: Text('Thư viện'),
                    ),
                    const NavigationRailDestination(
                      icon: Icon(Icons.explore_outlined),
                      selectedIcon: Icon(Icons.explore_rounded),
                      label: Text('Khám phá'),
                    ),
                    const NavigationRailDestination(
                      icon: Icon(Icons.auto_fix_high_outlined),
                      selectedIcon: Icon(Icons.auto_fix_high_rounded),
                      label: Text('AI Studio'),
                    ),
                    NavigationRailDestination(
                      icon: Badge(
                        isLabelVisible: runningDownloads > 0,
                        label: Text('$runningDownloads'),
                        child: const Icon(Icons.downloading_outlined),
                      ),
                      selectedIcon: Badge(
                        isLabelVisible: runningDownloads > 0,
                        label: Text('$runningDownloads'),
                        child: const Icon(Icons.downloading_rounded),
                      ),
                      label: const Text('Tiến trình'),
                    ),
                    const NavigationRailDestination(
                      icon: Icon(Icons.settings_outlined),
                      selectedIcon: Icon(Icons.settings_rounded),
                      label: Text('Cài đặt'),
                    ),
                  ],
                ),
                const VerticalDivider(thickness: 0.8, width: 0.8, color: CatppuccinMocha.surface1),
                Expanded(
                  child: IndexedStack(
                    index: _currentIndex,
                    children: _screens,
                  ),
                ),
              ],
            ),
          );
        }

        // Bố cục Màn hình Nhỏ / Mobile: Bottom Navigation Bar
        return Scaffold(
          body: IndexedStack(
            index: _currentIndex,
            children: _screens,
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _currentIndex,
            onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
            destinations: [
              const NavigationDestination(
                icon: Icon(Icons.collections_bookmark_outlined),
                selectedIcon: Icon(Icons.collections_bookmark_rounded),
                label: 'Thư viện',
              ),
              const NavigationDestination(
                icon: Icon(Icons.explore_outlined),
                selectedIcon: Icon(Icons.explore_rounded),
                label: 'Khám phá',
              ),
              const NavigationDestination(
                icon: Icon(Icons.auto_fix_high_outlined),
                selectedIcon: Icon(Icons.auto_fix_high_rounded),
                label: 'AI Studio',
              ),
              NavigationDestination(
                icon: Badge(
                  isLabelVisible: runningDownloads > 0,
                  label: Text('$runningDownloads'),
                  child: const Icon(Icons.downloading_outlined),
                ),
                selectedIcon: Badge(
                  isLabelVisible: runningDownloads > 0,
                  label: Text('$runningDownloads'),
                  child: const Icon(Icons.downloading_rounded),
                ),
                label: 'Tải về',
              ),
              const NavigationDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings_rounded),
                label: 'Cài đặt',
              ),
            ],
          ),
        );
      },
    );
  }
}
