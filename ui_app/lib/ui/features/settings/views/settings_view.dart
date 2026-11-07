import 'package:flutter/material.dart';
import '../../../../core/theme/catppuccin_theme.dart';
import '../../../../data/services/api_service.dart';

/// Màn hình Cài đặt & Cấu hình Máy chủ Engine
class SettingsView extends StatefulWidget {
  final ApiService apiService;

  const SettingsView({super.key, required this.apiService});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late TextEditingController _urlController;
  bool _isChecking = false;
  bool? _isConnected;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.apiService.baseUrl);
    _checkServerStatus();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _checkServerStatus() async {
    setState(() => _isChecking = true);
    final ok = await widget.apiService.checkHealth();
    if (mounted) {
      setState(() {
        _isConnected = ok;
        _isChecking = false;
      });
    }
  }

  void _saveServerUrl() {
    final newUrl = _urlController.text.trim();
    if (newUrl.isNotEmpty) {
      widget.apiService.updateBaseUrl(newUrl);
      _checkServerStatus();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: CatppuccinMocha.surface0,
          content: Text('Đã cập nhật địa chỉ máy chủ Core Engine!'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cài đặt hệ thống', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        backgroundColor: CatppuccinMocha.mantle,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // 1. Cấu hình máy chủ Python Core Engine
          const Text(
            'Kết nối Máy chủ Core Engine',
            style: TextStyle(color: CatppuccinMocha.text, fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'Desktop dùng http://127.0.0.1:8000. Điện thoại Mobile kết nối qua IP mạng LAN hoặc Cloud VPS.',
            style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 12),
          ),
          const SizedBox(height: 12),

          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CatppuccinMocha.surface0,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: CatppuccinMocha.surface1, width: 0.8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _urlController,
                        decoration: const InputDecoration(
                          labelText: 'Địa chỉ Base URL',
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: _saveServerUrl,
                      child: const Text('Lưu'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (_isChecking)
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: CatppuccinMocha.lavender),
                      )
                    else
                      Icon(
                        _isConnected == true ? Icons.check_circle_rounded : Icons.cancel_rounded,
                        color: _isConnected == true ? CatppuccinMocha.teal : CatppuccinMocha.red,
                        size: 18,
                      ),
                    const SizedBox(width: 8),
                    Text(
                      _isConnected == true
                          ? 'Máy chủ Python Engine đang hoạt động tốt'
                          : 'Không thể kết nối tới máy chủ (Offline)',
                      style: TextStyle(
                        color: _isConnected == true ? CatppuccinMocha.teal : CatppuccinMocha.red,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.refresh_rounded, size: 18, color: CatppuccinMocha.subtext0),
                      tooltip: 'Kiểm tra lại',
                      onPressed: _checkServerStatus,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),

          // 2. Giao diện & Thẩm mỹ
          const Text(
            'Giao diện & Thẩm mỹ',
            style: TextStyle(color: CatppuccinMocha.text, fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            tileColor: CatppuccinMocha.surface0,
            leading: const Icon(Icons.palette_rounded, color: CatppuccinMocha.lavender),
            title: const Text('Bảng màu chủ đề', style: TextStyle(color: CatppuccinMocha.text, fontSize: 13)),
            subtitle: const Text('Catppuccin Mocha (Ấm áp & Êm dịu)', style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 11)),
            trailing: Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(
                color: CatppuccinMocha.lavender,
                shape: BoxShape.circle,
              ),
            ),
          ),
          const SizedBox(height: 28),

          // 3. Thông tin ứng dụng
          const Text(
            'Về MoeJect',
            style: TextStyle(color: CatppuccinMocha.text, fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CatppuccinMocha.surface0,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'MoeJect (Kumo-Manga / Omni-Manga)',
                  style: TextStyle(color: CatppuccinMocha.text, fontWeight: FontWeight.bold, fontSize: 13),
                ),
                SizedBox(height: 4),
                Text(
                  'Phiên bản: 1.0.0 (Decoupled Client-Server Architecture)',
                  style: TextStyle(color: CatppuccinMocha.subtext0, fontSize: 12),
                ),
                SizedBox(height: 6),
                Text(
                  'Nguồn truyện: MangaDex • Cứu Truyện • Comix.to\nPipeline: Two-tier Downloader & LaMa AI Vision Cleaner',
                  style: TextStyle(color: CatppuccinMocha.subtext1, fontSize: 11, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
