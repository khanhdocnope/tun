use eframe::egui::{self, CornerRadius, RichText, Stroke};
use std::path::PathBuf;

use crate::gui::theme::CatppuccinMocha;
use crate::models::DownloadTaskStatus;

pub fn render_downloads_view(
    ui: &mut egui::Ui,
    tasks: &[DownloadTaskStatus],
    downloads_dir: &PathBuf,
) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(format!("Hàng đợi tải về ({})", tasks.len()))
                .size(18.0)
                .strong()
                .color(CatppuccinMocha::TEXT),
        );

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui
                .add(
                    egui::Button::new(
                        RichText::new("📂 Mở thư mục tải về")
                            .color(CatppuccinMocha::CRUST)
                            .strong(),
                    )
                    .fill(CatppuccinMocha::LAVENDER)
                    .corner_radius(CornerRadius::same(6)),
                )
                .clicked()
            {
                let _ = open::that(downloads_dir);
            }
        });
    });

    ui.add_space(14.0);

    if tasks.is_empty() {
        ui.vertical_centered(|ui| {
            ui.add_space(80.0);
            ui.label(
                RichText::new("Chưa có tác vụ tải nào đang chạy hoặc hoàn tất.")
                    .size(15.0)
                    .color(CatppuccinMocha::SUBTEXT0),
            );
            ui.add_space(6.0);
            ui.label(
                RichText::new("Hãy chọn một bộ truyện ở mục Khám phá để bắt đầu tải về.")
                    .size(13.0)
                    .color(CatppuccinMocha::OVERLAY0),
            );
        });
        return;
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for task in tasks.iter().rev() {
                let frame = egui::Frame::group(ui.style())
                    .fill(CatppuccinMocha::BASE)
                    .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
                    .corner_radius(CornerRadius::same(8))
                    .inner_margin(12.0);

                frame.show(ui, |ui| {
                    ui.horizontal(|ui| {
                        // Status indicator icon
                        let (icon, _color) = match task.status.as_str() {
                            "completed" => ("✅", CatppuccinMocha::GREEN),
                            "failed" => ("❌", CatppuccinMocha::RED),
                            _ => ("⏳", CatppuccinMocha::SAPPHIRE),
                        };

                        ui.label(RichText::new(icon).size(16.0));
                        ui.label(
                            RichText::new(format!(
                                "[{}] {}",
                                task.source_id.to_uppercase(),
                                task.manga_id
                            ))
                            .size(14.0)
                            .strong()
                            .color(CatppuccinMocha::TEXT),
                        );

                        // Format Badge
                        let tag_frame = egui::Frame::new()
                            .fill(CatppuccinMocha::SURFACE0)
                            .corner_radius(CornerRadius::same(4))
                            .inner_margin(egui::Margin::symmetric(6, 2));
                        tag_frame.show(ui, |ui| {
                            ui.label(
                                RichText::new(task.format.to_uppercase())
                                    .size(10.0)
                                    .color(CatppuccinMocha::LAVENDER),
                            );
                        });

                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if let Some(ref path) = task.file_path {
                                if ui
                                    .add(
                                        egui::Button::new(RichText::new("Mở file").size(11.0))
                                            .fill(CatppuccinMocha::SURFACE1)
                                            .corner_radius(CornerRadius::same(4)),
                                    )
                                    .clicked()
                                {
                                    let _ = open::that(path);
                                }
                            }
                            if let Some(size) = task.file_size_mb {
                                ui.label(
                                    RichText::new(format!("{:.1} MB", size))
                                        .size(12.0)
                                        .color(CatppuccinMocha::SUBTEXT0),
                                );
                            }
                        });
                    });

                    ui.add_space(8.0);

                    // Progress Bar
                    let progress_ratio = (task.percent / 100.0).clamp(0.0, 1.0) as f32;
                    let bar = egui::ProgressBar::new(progress_ratio)
                        .show_percentage()
                        .animate(task.status == "running");
                    ui.add(bar);

                    ui.add_space(4.0);

                    // Status Message
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new(&task.message)
                                .size(12.0)
                                .color(CatppuccinMocha::SUBTEXT1),
                        );
                        if let Some(ref err) = task.error {
                            ui.label(RichText::new(format!("({})", err)).size(11.0).color(CatppuccinMocha::RED));
                        }
                    });
                });

                ui.add_space(8.0);
            }
        });
}
