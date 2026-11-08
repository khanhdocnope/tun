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
    let mut native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([1150.0, 740.0])
            .with_min_inner_size([920.0, 600.0])
            .with_title("MoeJect - Native Rust Manga Reader"),
        ..Default::default()
    };

    #[cfg(target_os = "windows")]
    {
        if let eframe::egui_wgpu::WgpuSetup::CreateNew(ref mut create_new) = native_options.wgpu_options.wgpu_setup {
            // Prioritize DirectX 12 and OpenGL on Windows to prevent Vulkan overlay layer crashes on Intel HD Graphics
            create_new.instance_descriptor.backends = eframe::wgpu::Backends::DX12 | eframe::wgpu::Backends::GL;
        }
    }

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
