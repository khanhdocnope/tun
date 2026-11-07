import 'package:flutter/material.dart';
import '../../../../core/theme/catppuccin_theme.dart';

/// Huy hiệu nguồn truyện (MangaDex, Cuutruyen, Comix)
class SourceBadge extends StatelessWidget {
  final String sourceId;
  final double fontSize;

  const SourceBadge({
    super.key,
    required this.sourceId,
    this.fontSize = 11,
  });

  Color _getSourceColor() {
    switch (sourceId.toLowerCase()) {
      case 'mangadex':
        return CatppuccinMocha.peach;
      case 'cuutruyen':
        return CatppuccinMocha.teal;
      case 'comix':
        return CatppuccinMocha.lavender;
      default:
        return CatppuccinMocha.mauve;
    }
  }

  String _getSourceLabel() {
    switch (sourceId.toLowerCase()) {
      case 'mangadex':
        return 'MangaDex';
      case 'cuutruyen':
        return 'Cứu Truyện';
      case 'comix':
        return 'Comix.to';
      default:
        return sourceId.toUpperCase();
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _getSourceColor();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.18),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.5), width: 0.8),
      ),
      child: Text(
        _getSourceLabel(),
        style: TextStyle(
          color: color,
          fontSize: fontSize,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}
