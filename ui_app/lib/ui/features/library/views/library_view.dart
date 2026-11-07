import 'package:flutter/material.dart';
import '../../../../core/theme/catppuccin_theme.dart';

/// Màn hình Kệ truyện Thư viện (Library)
class LibraryView extends StatelessWidget {
  const LibraryView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kệ truyện', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: CatppuccinMocha.mantle,
        elevation: 0,
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: CatppuccinMocha.surface0,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.collections_bookmark_rounded, color: CatppuccinMocha.lavender, size: 40),
              ),
              const SizedBox(height: 16),
              const Text(
                'Thư viện của bạn đang trống',
                style: TextStyle(color: CatppuccinMocha.text, fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Hãy chuyển sang tab "Khám phá" để tìm kiếm và tải những bộ manga đầu tiên về máy!',
                textAlign: TextAlign.center,
                style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
