pub mod app;
pub mod state;
pub mod theme;
pub mod views;

use std::path::PathBuf;
use std::sync::Arc;

use crate::api::SourceRegistry;

pub fn run_gui(
    registry: Arc<SourceRegistry>,
    downloads_dir: PathBuf,
) -> Result<(), eframe::Error> {
    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1150.0, 740.0])
            .with_min_inner_size([920.0, 600.0])
            .with_title("MoeJect - Native Rust Manga Reader"),
        ..Default::default()
    };

    let (cmd_tx, evt_rx) = state::spawn_async_bridge(registry, downloads_dir.clone());

    eframe::run_native(
        "MoeJect",
        native_options,
        Box::new(|cc| {
            // Install image loaders for webp, png, jpeg, and uri
            egui_extras::install_image_loaders(&cc.egui_ctx);
            // Apply Catppuccin Mocha Dark theme
            theme::CatppuccinMocha::apply(&cc.egui_ctx);

            Ok(Box::new(app::MoeJectApp::new(cc, cmd_tx, evt_rx, downloads_dir)))
        }),
    )
}
