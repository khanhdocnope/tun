import 'package:flutter/material.dart';
import '../../../../core/theme/catppuccin_theme.dart';

/// Màn hình AI Cleaner Studio (Xóa chữ & Khôi phục nền tranh tự động)
class CleanerView extends StatefulWidget {
  const CleanerView({super.key});

  @override
  State<CleanerView> createState() => _CleanerViewState();
}

class _CleanerViewState extends State<CleanerView> {
  String _mode = 'bubble_only'; // bubble_only hoặc all
  String _detector = 'ctd'; // ctd hoặc default
  double _dilation = 5.0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Cleaner Studio', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: CatppuccinMocha.mantle,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Khu vực Kéo thả file ZIP
            Container(
              height: 160,
              width: double.infinity,
              decoration: BoxDecoration(
                color: CatppuccinMocha.surface0.withOpacity(0.5),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: CatppuccinMocha.lavender.withOpacity(0.6),
                  width: 1.5,
                  style: BorderStyle.solid,
                ),
              ),
              child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.folder_zip_rounded, color: CatppuccinMocha.lavender, size: 48),
                  SizedBox(height: 10),
                  Text(
                    'Kéo thả file .ZIP hoặc thư mục ảnh truyện vào đây',
                    style: TextStyle(color: CatppuccinMocha.text, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Hỗ trợ file ZIP xuất trực tiếp từ bộ tải MoeJect',
                    style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // 2. Tùy chỉnh thông số xử lý AI (Tối ưu theo khảo sát thực tế)
            const Text(
              'Cấu hình bộ lọc AI Cleaner',
              style: TextStyle(color: CatppuccinMocha.text, fontSize: 15, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),

            // Chế độ xóa chữ
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: CatppuccinMocha.surface0,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Chế độ xóa chữ:', style: TextStyle(color: CatppuccinMocha.subtext1, fontSize: 12)),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'bubble_only',
                        label: Text('Chỉ xóa bóng thoại (Giữ SFX)'),
                        icon: Icon(Icons.chat_bubble_outline_rounded, size: 16),
                      ),
                      ButtonSegment(
                        value: 'all',
                        label: Text('Xóa tất cả (Cả bóng thoại & SFX)'),
                        icon: Icon(Icons.auto_fix_high_rounded, size: 16),
                      ),
                    ],
                    selected: {_mode},
                    onSelectionChanged: (val) => setState(() => _mode = val.first),
                    style: ButtonStyle(
                      backgroundColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.selected)) {
                          return CatppuccinMocha.lavender;
                        }
                        return CatppuccinMocha.surface0;
                      }),
                      foregroundColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.selected)) {
                          return CatppuccinMocha.crust;
                        }
                        return CatppuccinMocha.text;
                      }),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Detector & Dilation
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: CatppuccinMocha.surface0,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Bộ nhận diện Text Detector:', style: TextStyle(color: CatppuccinMocha.subtext1, fontSize: 12)),
                      DropdownButton<String>(
                        value: _detector,
                        dropdownColor: CatppuccinMocha.surface0,
                        underline: const SizedBox(),
                        items: const [
                          DropdownMenuItem(value: 'ctd', child: Text('ComicTextDetector (Khuyên dùng)')),
                          DropdownMenuItem(value: 'default', child: Text('DBNet (Mặc định)')),
                        ],
                        onChanged: (val) {
                          if (val != null) setState(() => _detector = val);
                        },
                      ),
                    ],
                  ),
                  const Divider(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Độ bù viền chữ (Dilation): ${_dilation.toInt()}px',
                          style: const TextStyle(color: CatppuccinMocha.subtext1, fontSize: 12)),
                      const Text('Giúp xóa sạch viền/furigana mờ', style: TextStyle(color: CatppuccinMocha.teal, fontSize: 11)),
                    ],
                  ),
                  Slider(
                    value: _dilation,
                    min: 0,
                    max: 12,
                    divisions: 12,
                    activeColor: CatppuccinMocha.lavender,
                    inactiveColor: CatppuccinMocha.surface1,
                    label: '${_dilation.toInt()}',
                    onChanged: (val) => setState(() => _dilation = val),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton.icon(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      backgroundColor: CatppuccinMocha.surface0,
                      content: Text('Vui lòng chọn file ZIP để bắt đầu xử lý AI Inpainting!'),
                    ),
                  );
                },
                icon: const Icon(Icons.bolt_rounded),
                label: const Text('Bắt đầu Làm sạch Toàn bộ Chapter'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
