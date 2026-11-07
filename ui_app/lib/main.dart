import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/theme/catppuccin_theme.dart';
import 'data/repositories/manga_repository.dart';
import 'data/services/api_service.dart';
import 'ui/core/responsive_scaffold.dart';
import 'ui/features/browse/view_models/browse_view_model.dart';
import 'ui/features/downloads/view_models/downloads_view_model.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final apiService = ApiService();
  final mangaRepository = MangaRepository(apiService: apiService);

  runApp(
    MoeJectApp(
      apiService: apiService,
      mangaRepository: mangaRepository,
    ),
  );
}

class MoeJectApp extends StatelessWidget {
  final ApiService apiService;
  final MangaRepository mangaRepository;

  const MoeJectApp({
    super.key,
    required this.apiService,
    required this.mangaRepository,
  });

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => BrowseViewModel(repository: mangaRepository),
        ),
        ChangeNotifierProvider(
          create: (_) => DownloadsViewModel(repository: mangaRepository),
        ),
      ],
      child: MaterialApp(
        title: 'MoeJect',
        debugShowCheckedModeBanner: false,
        theme: CatppuccinMocha.themeData,
        home: ResponsiveScaffold(apiService: apiService),
      ),
    );
  }
}
