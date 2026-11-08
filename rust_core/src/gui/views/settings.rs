use eframe::egui::{self, CornerRadius, RichText, Stroke};
use std::path::PathBuf;

use crate::gui::theme::CatppuccinMocha;

pub enum SettingsAction {
    ChangeDownloadDir(PathBuf),
    ClearCache,
}

pub fn render_settings_view(
    ui: &mut egui::Ui,
    downloads_dir: &PathBuf,
) -> Option<SettingsAction> {
    let mut action = None;

    ui.label(
        RichText::new("⚙️ Cài đặt hệ thống")
            .size(18.0)
            .strong()
            .color(CatppuccinMocha::TEXT),
    );

    ui.add_space(14.0);

    // 1. Download Path Configuration
    egui::Frame::group(ui.style())
        .fill(CatppuccinMocha::BASE)
        .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(12.0)
        .show(ui, |ui| {
            ui.label(
                RichText::new("Thư mục lưu truyện tải về:")
                    .size(14.0)
                    .strong()
                    .color(CatppuccinMocha::TEXT),
            );
            ui.add_space(6.0);

            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(downloads_dir.to_string_lossy().to_string())
                        .size(13.0)
                        .color(CatppuccinMocha::LAVENDER),
                );

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui
                        .add(
                            egui::Button::new(RichText::new("📁 Thay đổi").size(12.0))
                                .fill(CatppuccinMocha::SURFACE1)
                                .corner_radius(CornerRadius::same(4)),
                        )
                        .clicked()
                    {
                        if let Some(folder) = rfd::FileDialog::new().pick_folder() {
                            action = Some(SettingsAction::ChangeDownloadDir(folder));
                        }
                    }
                });
            });
        });

    ui.add_space(14.0);

    // 2. Technical Specs
    egui::Frame::group(ui.style())
        .fill(CatppuccinMocha::BASE)
        .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(12.0)
        .show(ui, |ui| {
            ui.label(
                RichText::new("Thông tin ứng dụng MoeJect:")
                    .size(14.0)
                    .strong()
                    .color(CatppuccinMocha::TEXT),
            );
            ui.add_space(6.0);

            ui.label(
                RichText::new("• Kiến trúc: 100% Native Rust (Tokio Asynchronous Runtime + eframe/wgpu)")
                    .size(12.0)
                    .color(CatppuccinMocha::SUBTEXT1),
            );
            ui.label(
                RichText::new("• Đóng gói định dạng: CBZ (ComicInfo.xml v2.0) & ZIP (Raw)")
                    .size(12.0)
                    .color(CatppuccinMocha::SUBTEXT1),
            );
            ui.label(
                RichText::new("• AI Manga Cleaner: Hugging Face Spaces Remote GPU Inpainting")
                    .size(12.0)
                    .color(CatppuccinMocha::SUBTEXT1),
            );
            ui.label(
                RichText::new("• Phiên bản: 1.0.0 (Native Release)")
                    .size(12.0)
                    .color(CatppuccinMocha::GREEN),
            );
        });

    action
}
