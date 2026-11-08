use eframe::egui::{self, CornerRadius, RichText, Stroke, Vec2};
use std::path::PathBuf;

use crate::gui::theme::CatppuccinMocha;

pub enum CleanerAction {
    PickImage,
    StartClean { image_bytes: Vec<u8>, hf_url: String },
    SaveCleaned(Vec<u8>),
}

pub fn render_cleaner_view(
    ui: &mut egui::Ui,
    hf_space_url: &mut String,
    selected_image_path: Option<&PathBuf>,
    image_bytes: Option<&[u8]>,
    cleaned_bytes: Option<&[u8]>,
    is_cleaning: bool,
    error_msg: Option<&str>,
) -> Option<CleanerAction> {
    let mut action = None;

    ui.horizontal(|ui| {
        ui.label(
            RichText::new("🪄 Tẩy thoại tự động (AI Inpainting)")
                .size(18.0)
                .strong()
                .color(CatppuccinMocha::TEXT),
        );
    });

    ui.add_space(8.0);

    // HF Space Endpoint Configuration
    egui::Frame::group(ui.style())
        .fill(CatppuccinMocha::MANTLE)
        .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
        .corner_radius(CornerRadius::same(6))
        .inner_margin(8.0)
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("Hugging Face Space Endpoint:")
                        .size(12.0)
                        .color(CatppuccinMocha::SUBTEXT1),
                );
                ui.add(
                    egui::TextEdit::singleline(hf_space_url)
                        .desired_width(ui.available_width() - 10.0),
                );
            });
        });

    ui.add_space(10.0);

    // Action buttons toolbar
    ui.horizontal(|ui| {
        if ui
            .add(
                egui::Button::new(
                    RichText::new("📁 Chọn ảnh truyện...")
                        .color(CatppuccinMocha::CRUST)
                        .strong(),
                )
                .fill(CatppuccinMocha::LAVENDER)
                .corner_radius(CornerRadius::same(6)),
            )
            .clicked()
        {
            action = Some(CleanerAction::PickImage);
        }

        if let Some(bytes) = image_bytes {
            let clean_btn = egui::Button::new(
                RichText::new("🪄 Bắt đầu tẩy thoại")
                    .color(CatppuccinMocha::CRUST)
                    .strong(),
            )
            .fill(CatppuccinMocha::GREEN)
            .corner_radius(CornerRadius::same(6));

            if ui.add_enabled(!is_cleaning, clean_btn).clicked() {
                action = Some(CleanerAction::StartClean {
                    image_bytes: bytes.to_vec(),
                    hf_url: hf_space_url.clone(),
                });
            }
        }

        if let Some(c_bytes) = cleaned_bytes {
            if ui
                .add(
                    egui::Button::new(
                        RichText::new("💾 Lưu ảnh kết quả")
                            .color(CatppuccinMocha::CRUST)
                            .strong(),
                    )
                    .fill(CatppuccinMocha::SAPPHIRE)
                    .corner_radius(CornerRadius::same(6)),
                )
                .clicked()
            {
                action = Some(CleanerAction::SaveCleaned(c_bytes.to_vec()));
            }
        }

        if is_cleaning {
            ui.spinner();
            ui.label(
                RichText::new("Đang gửi và xử lý trên Hugging Face GPU...")
                    .color(CatppuccinMocha::MAUVE)
                    .size(13.0),
            );
        }
    });

    if let Some(err) = error_msg {
        ui.add_space(6.0);
        ui.label(RichText::new(format!("⚠️ {}", err)).color(CatppuccinMocha::RED).size(12.0));
    }

    if let Some(p) = selected_image_path {
        ui.add_space(4.0);
        ui.label(
            RichText::new(format!("Đã chọn: {}", p.display()))
                .size(11.0)
                .color(CatppuccinMocha::SUBTEXT0),
        );
    }

    ui.add_space(10.0);

    // Previews: Side by side (Original vs Cleaned)
    let available_w = ui.available_width();
    let col_w = (available_w - 20.0) / 2.0;

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.horizontal_top(|ui| {
                // Left Column: Original
                ui.vertical(|ui| {
                    ui.set_width(col_w);
                    ui.label(
                        RichText::new("Ảnh gốc")
                            .size(14.0)
                            .strong()
                            .color(CatppuccinMocha::TEXT),
                    );
                    ui.add_space(4.0);

                    if let Some(bytes) = image_bytes {
                        let img_src = egui::ImageSource::Bytes {
                            uri: "bytes://original_image".into(),
                            bytes: bytes.to_vec().into(),
                        };
                        ui.add(
                            egui::Image::new(img_src)
                                .max_width(col_w - 10.0)
                                .corner_radius(CornerRadius::same(6)),
                        );
                    } else {
                        let (rect, _) = ui.allocate_exact_size(Vec2::new(col_w - 10.0, 300.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, CornerRadius::same(6), CatppuccinMocha::SURFACE0);
                        ui.label(RichText::new("Chưa chọn ảnh").color(CatppuccinMocha::OVERLAY0));
                    }
                });

                ui.add_space(10.0);

                // Right Column: Cleaned
                ui.vertical(|ui| {
                    ui.set_width(col_w);
                    ui.label(
                        RichText::new("Kết quả đã tẩy bóng thoại")
                            .size(14.0)
                            .strong()
                            .color(CatppuccinMocha::GREEN),
                    );
                    ui.add_space(4.0);

                    if let Some(c_bytes) = cleaned_bytes {
                        let img_src = egui::ImageSource::Bytes {
                            uri: "bytes://cleaned_image".into(),
                            bytes: c_bytes.to_vec().into(),
                        };
                        ui.add(
                            egui::Image::new(img_src)
                                .max_width(col_w - 10.0)
                                .corner_radius(CornerRadius::same(6)),
                        );
                    } else {
                        let (rect, _) = ui.allocate_exact_size(Vec2::new(col_w - 10.0, 300.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, CornerRadius::same(6), CatppuccinMocha::SURFACE0);
                        ui.label(RichText::new("Kết quả tẩy thoại sẽ xuất hiện tại đây").color(CatppuccinMocha::OVERLAY0));
                    }
                });
            });
        });

    action
}
