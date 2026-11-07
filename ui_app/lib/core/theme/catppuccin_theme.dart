import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Bảng màu chuẩn mực Catppuccin Mocha cho giao diện MoeJect
class CatppuccinMocha {
  // Nền & Khung chứa (Backgrounds & Surfaces)
  static const Color base = Color(0xFF1E1E2E); // Nền chính ứng dụng
  static const Color mantle = Color(0xFF181825); // Nền Sidebar / BottomBar
  static const Color crust = Color(0xFF11111B); // Nền sâu nhất (OLED/Gốc)
  static const Color surface0 = Color(0xFF313244); // Thẻ Manga, Input field
  static const Color surface1 = Color(0xFF45475A); // Viền phân cách
  static const Color surface2 = Color(0xFF585B70); // Hover/Highlight

  // Lớp phủ & Gợi ý (Overlays & Subtexts)
  static const Color overlay0 = Color(0xFF6C7086);
  static const Color subtext0 = Color(0xFFA6ADC8); // Tác giả, ngày tháng
  static const Color subtext1 = Color(0xFFBAC2DE);
  static const Color text = Color(0xFFCDD6F4); // Văn bản chính

  // Điểm nhấn Pastel (Pastel Accents)
  static const Color lavender = Color(0xFFB4BEFE); // Primary Accent (Tím Oải Hương)
  static const Color blue = Color(0xFF89B4FA);
  static const Color sapphire = Color(0xFF74C7EC);
  static const Color sky = Color(0xFF89DCEB);
  static const Color teal = Color(0xFF94E2D5); // Mint Green (Success / Đã tải)
  static const Color green = Color(0xFFA6E3A1);
  static const Color yellow = Color(0xFFF9E2AF); // Warning
  static const Color peach = Color(0xFFFAB387); // Chú ý
  static const Color red = Color(0xFFF38BA8); // Lỗi / Hủy
  static const Color mauve = Color(0xFFCBA6F7); // Thể loại / Tags
  static const Color pink = Color(0xFFF5C2E7); // Tiến trình tải / Highlight
  static const Color flamingo = Color(0xFFF2CDCD);

  /// Tạo ThemeData chuẩn Material 3
  static ThemeData get themeData {
    final textTheme = GoogleFonts.plusJakartaSansTextTheme(
      ThemeData(brightness: Brightness.dark).textTheme,
    ).apply(
      bodyColor: text,
      displayColor: text,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: base,
      canvasColor: mantle,
      colorScheme: const ColorScheme(
        brightness: Brightness.dark,
        primary: lavender,
        onPrimary: crust,
        primaryContainer: surface0,
        onPrimaryContainer: lavender,
        secondary: teal,
        onSecondary: crust,
        secondaryContainer: surface0,
        onSecondaryContainer: teal,
        tertiary: pink,
        onTertiary: crust,
        error: red,
        onError: crust,
        surface: surface0,
        onSurface: text,
      ),
      textTheme: textTheme,
      cardTheme: CardTheme(
        color: surface0,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: surface1, width: 0.8),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface0,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        hintStyle: const TextStyle(color: overlay0, fontSize: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: surface1, width: 0.8),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: lavender, width: 1.5),
        ),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: mantle,
        selectedIconTheme: IconThemeData(color: lavender),
        unselectedIconTheme: IconThemeData(color: subtext0),
        selectedLabelTextStyle: TextStyle(color: lavender, fontWeight: FontWeight.bold, fontSize: 12),
        unselectedLabelTextStyle: TextStyle(color: subtext0, fontSize: 12),
        indicatorColor: surface0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: mantle,
        indicatorColor: surface0,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: lavender);
          }
          return const IconThemeData(color: subtext0);
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(color: lavender, fontWeight: FontWeight.w600, fontSize: 12);
          }
          return const TextStyle(color: subtext0, fontSize: 12);
        }),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: lavender,
          foregroundColor: crust,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: lavender,
          side: const BorderSide(color: surface1),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      dividerColor: surface1,
    );
  }
}
