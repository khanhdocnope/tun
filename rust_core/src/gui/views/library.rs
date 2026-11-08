use eframe::egui::{self, CornerRadius, RichText, Stroke};
use std::path::PathBuf;

use crate::gui::theme::CatppuccinMocha;
use crate::models::LibraryFileItem;

pub enum LibraryAction {
    Refresh,
    DeleteFile(String),
}

pub fn render_library_view(
    ui: &mut egui::Ui,
    files: &[LibraryFileItem],
    downloads_dir: &PathBuf,
) -> Option<LibraryAction> {
    let mut action = None;

    ui.horizontal(|ui| {
        ui.label(
            RichText::new(format!("Thư viện truyện ({})", files.len()))
                .size(18.0)
                .strong()
                .color(CatppuccinMocha::TEXT),
        );

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui
                .add(
                    egui::Button::new(RichText::new("📂 Mở thư mục").size(12.0))
                        .fill(CatppuccinMocha::SURFACE0)
                        .corner_radius(CornerRadius::same(6)),
                )
                .clicked()
            {
                let _ = open::that(downloads_dir);
            }

            if ui
                .add(
                    egui::Button::new(
                        RichText::new("🔄 Quét lại")
                            .color(CatppuccinMocha::CRUST)
                            .strong(),
                    )
                    .fill(CatppuccinMocha::LAVENDER)
                    .corner_radius(CornerRadius::same(6)),
                )
                .clicked()
            {
                action = Some(LibraryAction::Refresh);
            }
        });
    });

    ui.add_space(14.0);

    if files.is_empty() {
        ui.vertical_centered(|ui| {
            ui.add_space(80.0);
            ui.label(
                RichText::new("Thư viện đang trống.")
                    .size(15.0)
                    .color(CatppuccinMocha::SUBTEXT0),
            );
            ui.add_space(6.0);
            ui.label(
                RichText::new("Các tập truyện sau khi tải về thành công (CBZ hoặc ZIP) sẽ hiển thị ở đây.")
                    .size(13.0)
                    .color(CatppuccinMocha::OVERLAY0),
            );
        });
        return action;
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for file in files {
                let frame = egui::Frame::group(ui.style())
                    .fill(CatppuccinMocha::BASE)
                    .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(10.0);

                frame.show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let icon = if file.format == "CBZ" { "📘" } else { "📦" };
                        ui.label(RichText::new(icon).size(18.0));

                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(&file.name)
                                    .size(14.0)
                                    .strong()
                                    .color(CatppuccinMocha::TEXT),
                            );
                            ui.label(
                                RichText::new(format!(
                                    "Định dạng: {} • Dung lượng: {:.2} MB • Ngày tải: {}",
                                    file.format, file.size_mb, file.modified_at
                                ))
                                .size(11.0)
                                .color(CatppuccinMocha::SUBTEXT0),
                            );
                        });

                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui
                                .add(
                                    egui::Button::new(RichText::new("🗑").size(12.0).color(CatppuccinMocha::RED))
                                        .fill(CatppuccinMocha::SURFACE0)
                                        .corner_radius(CornerRadius::same(4)),
                                )
                                .on_hover_text("Xóa file này khỏi máy")
                                .clicked()
                            {
                                action = Some(LibraryAction::DeleteFile(file.path.clone()));
                            }

                            if ui
                                .add(
                                    egui::Button::new(
                                        RichText::new("📖 Đọc truyện")
                                            .size(12.0)
                                            .color(CatppuccinMocha::CRUST)
                                            .strong(),
                                    )
                                    .fill(CatppuccinMocha::GREEN)
                                    .corner_radius(CornerRadius::same(4)),
                                )
                                .clicked()
                            {
                                let _ = open::that(&file.path);
                            }
                        });
                    });
                });

                ui.add_space(6.0);
            }
        });

    action
}
