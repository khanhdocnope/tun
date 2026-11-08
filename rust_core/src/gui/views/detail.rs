use eframe::egui::{self, CornerRadius, RichText, Sense, Stroke, Vec2};

use crate::gui::theme::CatppuccinMocha;
use crate::models::{DownloadTaskRequest, MangaInfo, OutputFormat};

pub struct DetailAction {
    pub go_back: bool,
    pub start_download: Option<DownloadTaskRequest>,
}

pub fn render_detail_view(
    ui: &mut egui::Ui,
    source_id: &str,
    manga: &MangaInfo,
    selected_format: &mut OutputFormat,
    batch_range: &mut String,
    chapter_filter: &mut String,
) -> DetailAction {
    let mut action = DetailAction {
        go_back: false,
        start_download: None,
    };

    // 1. Back button header
    ui.horizontal(|ui| {
        if ui
            .add(
                egui::Button::new(
                    RichText::new("⬅ Quay lại Khám phá")
                        .size(13.0)
                        .color(CatppuccinMocha::TEXT),
                )
                .fill(CatppuccinMocha::SURFACE0)
                .corner_radius(CornerRadius::same(6)),
            )
            .clicked()
        {
            action.go_back = true;
        }

        ui.add_space(16.0);
        ui.label(
            RichText::new(format!("[{}] {}", source_id.to_uppercase(), manga.title))
                .size(16.0)
                .strong()
                .color(CatppuccinMocha::LAVENDER),
        );
    });

    ui.add_space(12.0);

    // 2. Manga Hero Card
    egui::Frame::group(ui.style())
        .fill(CatppuccinMocha::BASE)
        .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(12.0)
        .show(ui, |ui| {
            ui.horizontal_top(|ui| {
                if let Some(ref cover) = manga.cover_url {
                    ui.add(
                        egui::Image::from_uri(cover)
                            .fit_to_exact_size(Vec2::new(120.0, 170.0))
                            .corner_radius(CornerRadius::same(6)),
                    );
                } else {
                    let (rect, _) = ui.allocate_exact_size(Vec2::new(120.0, 170.0), Sense::hover());
                    ui.painter().rect_filled(rect, CornerRadius::same(6), CatppuccinMocha::SURFACE0);
                }

                ui.add_space(14.0);

                ui.vertical(|ui| {
                    ui.label(
                        RichText::new(&manga.title)
                            .size(18.0)
                            .strong()
                            .color(CatppuccinMocha::TEXT),
                    );

                    ui.add_space(4.0);
                    if !manga.authors.is_empty() {
                        ui.label(
                            RichText::new(format!("Tác giả: {}", manga.authors.join(", ")))
                                .size(13.0)
                                .color(CatppuccinMocha::SUBTEXT1),
                        );
                    }

                    if !manga.genres.is_empty() {
                        ui.add_space(4.0);
                        ui.horizontal_wrapped(|ui| {
                            for g in manga.genres.iter().take(8) {
                                let tag_frame = egui::Frame::new()
                                    .fill(CatppuccinMocha::SURFACE0)
                                    .corner_radius(CornerRadius::same(4))
                                    .inner_margin(egui::Margin::symmetric(6, 2));
                                tag_frame.show(ui, |ui| {
                                    ui.label(RichText::new(g).size(11.0).color(CatppuccinMocha::SAPPHIRE));
                                });
                            }
                        });
                    }

                    if let Some(ref desc) = manga.description {
                        ui.add_space(6.0);
                        let truncated = if desc.chars().count() > 220 {
                            format!("{}...", desc.chars().take(220).collect::<String>())
                        } else {
                            desc.clone()
                        };
                        ui.label(
                            RichText::new(truncated)
                                .size(12.0)
                                .color(CatppuccinMocha::SUBTEXT0),
                        );
                    }
                });
            });
        });

    ui.add_space(14.0);

    // 3. Batch Download Bar
    egui::Frame::group(ui.style())
        .fill(CatppuccinMocha::MANTLE)
        .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(10.0)
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("Định dạng:").size(13.0).strong().color(CatppuccinMocha::TEXT));
                ui.radio_value(selected_format, OutputFormat::Cbz, "CBZ (ComicInfo.xml)");
                ui.radio_value(selected_format, OutputFormat::Zip, "ZIP (Raw Ảnh)");

                ui.add_space(16.0);

                ui.label(RichText::new("Tải dải:").size(13.0).color(CatppuccinMocha::TEXT));
                ui.add(
                    egui::TextEdit::singleline(batch_range)
                        .hint_text("VD: 1-5, all")
                        .desired_width(90.0),
                );

                if ui
                    .add(
                        egui::Button::new(
                            RichText::new("⬇ Tải hàng loạt")
                                .color(CatppuccinMocha::CRUST)
                                .strong(),
                        )
                        .fill(CatppuccinMocha::GREEN)
                        .corner_radius(CornerRadius::same(6)),
                    )
                    .clicked()
                {
                    action.start_download = Some(DownloadTaskRequest {
                        source: source_id.to_string(),
                        manga_id: manga.id.clone(),
                        chapter_id: None,
                        chapter_ids: None,
                        chapters: Some(batch_range.clone()),
                        format: *selected_format,
                        output_dir: None,
                    });
                }

                if ui
                    .add(
                        egui::Button::new(RichText::new("Tải toàn bộ").size(12.0))
                            .fill(CatppuccinMocha::SURFACE1)
                            .corner_radius(CornerRadius::same(6)),
                    )
                    .clicked()
                {
                    action.start_download = Some(DownloadTaskRequest {
                        source: source_id.to_string(),
                        manga_id: manga.id.clone(),
                        chapter_id: None,
                        chapter_ids: None,
                        chapters: Some("all".to_string()),
                        format: *selected_format,
                        output_dir: None,
                    });
                }
            });
        });

    ui.add_space(12.0);

    // 4. Chapter List Header & Search
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(format!("Danh sách chương ({})", manga.chapters.len()))
                .size(15.0)
                .strong()
                .color(CatppuccinMocha::TEXT),
        );

        ui.add_space(20.0);
        ui.add(
            egui::TextEdit::singleline(chapter_filter)
                .hint_text("Lọc chương...")
                .desired_width(120.0),
        );
    });

    ui.add_space(6.0);

    // 5. Scrollable Chapters
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            let filter = chapter_filter.trim().to_lowercase();
            for ch in &manga.chapters {
                if !filter.is_empty()
                    && !ch.chapter_number.to_lowercase().contains(&filter)
                    && !ch.title.to_lowercase().contains(&filter)
                {
                    continue;
                }

                let ch_frame = egui::Frame::new()
                    .fill(CatppuccinMocha::BASE)
                    .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(8.0);

                ch_frame.show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new(format!("Chương {}", ch.chapter_number))
                                .size(14.0)
                                .strong()
                                .color(CatppuccinMocha::TEXT),
                        );

                        if !ch.title.is_empty() {
                            ui.label(
                                RichText::new(format!("- {}", ch.title))
                                    .size(13.0)
                                    .color(CatppuccinMocha::SUBTEXT0),
                            );
                        }

                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            // Download ZIP
                            if ui
                                .add(
                                    egui::Button::new(RichText::new("ZIP").size(11.0))
                                        .fill(CatppuccinMocha::SURFACE1)
                                        .corner_radius(CornerRadius::same(4)),
                                )
                                .clicked()
                            {
                                action.start_download = Some(DownloadTaskRequest {
                                    source: source_id.to_string(),
                                    manga_id: manga.id.clone(),
                                    chapter_id: Some(ch.id.clone()),
                                    chapter_ids: None,
                                    chapters: None,
                                    format: OutputFormat::Zip,
                                    output_dir: None,
                                });
                            }

                            // Download CBZ
                            if ui
                                .add(
                                    egui::Button::new(
                                        RichText::new("CBZ")
                                            .size(11.0)
                                            .color(CatppuccinMocha::CRUST)
                                            .strong(),
                                    )
                                    .fill(CatppuccinMocha::LAVENDER)
                                    .corner_radius(CornerRadius::same(4)),
                                )
                                .clicked()
                            {
                                action.start_download = Some(DownloadTaskRequest {
                                    source: source_id.to_string(),
                                    manga_id: manga.id.clone(),
                                    chapter_id: Some(ch.id.clone()),
                                    chapter_ids: None,
                                    chapters: None,
                                    format: OutputFormat::Cbz,
                                    output_dir: None,
                                });
                            }
                        });
                    });
                });

                ui.add_space(4.0);
            }
        });

    action
}
