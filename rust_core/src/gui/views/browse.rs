use eframe::egui::{self, CornerRadius, RichText, Sense, Stroke, Vec2};

use crate::gui::theme::CatppuccinMocha;
use crate::models::{MangaSearchResult, SourceMetadata};

pub struct BrowseAction {
    pub select_manga: Option<(String, String)>, // (source, manga_id)
    pub do_search: Option<(String, String)>,     // (source, query)
}

pub fn render_browse_view(
    ui: &mut egui::Ui,
    sources: &[SourceMetadata],
    selected_source_id: &mut String,
    search_query: &mut String,
    results: &[MangaSearchResult],
    is_searching: bool,
    error_msg: Option<&str>,
) -> BrowseAction {
    let mut action = BrowseAction {
        select_manga: None,
        do_search: None,
    };

    // 1. Top Search & Filter Bar
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(10.0, 0.0);

        // Source Dropdown
        egui::ComboBox::from_id_salt("source_select")
            .selected_text(
                sources
                    .iter()
                    .find(|s| s.id == *selected_source_id)
                    .map(|s| s.name.as_str())
                    .unwrap_or("Chọn nguồn..."),
            )
            .width(160.0)
            .show_ui(ui, |ui| {
                for src in sources {
                    ui.selectable_value(selected_source_id, src.id.clone(), &src.name);
                }
            });

        // Search Input
        let text_edit = ui.add(
            egui::TextEdit::singleline(search_query)
                .hint_text("Nhập tên truyện cần tìm (ví dụ: Frieren, Naruto, Solo Leveling)...")
                .desired_width(ui.available_width() - 110.0),
        );

        let search_clicked = ui
            .add(
                egui::Button::new(
                    RichText::new("🔍 Tìm kiếm")
                        .color(CatppuccinMocha::CRUST)
                        .strong(),
                )
                .fill(CatppuccinMocha::LAVENDER)
                .corner_radius(CornerRadius::same(6)),
            )
            .clicked();

        if (text_edit.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)))
            || search_clicked
        {
            if !search_query.trim().is_empty() || *selected_source_id == "hitomi" {
                action.do_search =
                    Some((selected_source_id.clone(), search_query.trim().to_string()));
            }
        }
    });

    ui.add_space(12.0);

    // 2. Status / Error bar
    if is_searching {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.label(
                RichText::new(format!(
                    "Đang tra cứu trên {}...",
                    selected_source_id.to_uppercase()
                ))
                .color(CatppuccinMocha::LAVENDER),
            );
        });
        ui.add_space(8.0);
    } else if let Some(err) = error_msg {
        ui.horizontal(|ui| {
            ui.label(RichText::new("⚠️ Lỗi:").color(CatppuccinMocha::RED).strong());
            ui.label(RichText::new(err).color(CatppuccinMocha::SUBTEXT1));
        });
        ui.add_space(8.0);
    }

    // 3. Manga Results List / Grid
    if results.is_empty() && !is_searching {
        ui.vertical_centered(|ui| {
            ui.add_space(80.0);
            ui.label(
                RichText::new("📖 Nhập tên truyện và nhấn Tìm kiếm để bắt đầu khám phá!")
                    .size(16.0)
                    .color(CatppuccinMocha::SUBTEXT0),
            );
            ui.add_space(8.0);
            ui.label(
                RichText::new("Hỗ trợ: MangaDex, Comick, Hitomi.la, Cứu Truyện")
                    .size(13.0)
                    .color(CatppuccinMocha::OVERLAY0),
            );
        });
        return action;
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            let available_w = ui.available_width();

            for manga in results {
                let frame = egui::Frame::group(ui.style())
                    .fill(CatppuccinMocha::BASE)
                    .stroke(Stroke::new(1.0, CatppuccinMocha::SURFACE0))
                    .corner_radius(CornerRadius::same(8))
                    .inner_margin(8.0);

                let card_resp = frame.show(ui, |ui| {
                    ui.set_width(available_w - 20.0);
                    ui.horizontal(|ui| {
                        // Thumbnail preview
                        if let Some(ref cover) = manga.cover_url {
                            ui.add(
                                egui::Image::from_uri(cover)
                                    .fit_to_exact_size(Vec2::new(70.0, 95.0))
                                    .corner_radius(CornerRadius::same(4)),
                            );
                        } else {
                            let (rect, _) = ui.allocate_exact_size(Vec2::new(70.0, 95.0), Sense::hover());
                            ui.painter().rect_filled(rect, CornerRadius::same(4), CatppuccinMocha::SURFACE0);
                        }

                        ui.add_space(10.0);

                        // Manga Info
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(&manga.title)
                                    .size(15.0)
                                    .strong()
                                    .color(CatppuccinMocha::TEXT),
                            );

                            ui.add_space(4.0);

                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("Nguồn: {}", selected_source_id.to_uppercase()))
                                        .size(11.0)
                                        .color(CatppuccinMocha::SAPPHIRE),
                                );
                                if let Some(ref ch) = manga.latest_chapter {
                                    ui.label(
                                        RichText::new(format!("• Mới nhất: Ch. {}", ch))
                                            .size(11.0)
                                            .color(CatppuccinMocha::GREEN),
                                    );
                                }
                            });

                            if let Some(ref desc) = manga.description {
                                ui.add_space(4.0);
                                let truncated = if desc.chars().count() > 140 {
                                    format!("{}...", desc.chars().take(140).collect::<String>())
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

                // Make card clickable
                let interact = ui.interact(card_resp.response.rect, card_resp.response.id, Sense::click());
                if interact.hovered() {
                    ui.output_mut(|o| o.cursor_icon = egui::CursorIcon::PointingHand);
                }
                if interact.clicked() {
                    action.select_manga = Some((selected_source_id.clone(), manga.id.clone()));
                }

                ui.add_space(8.0);
            }
        });

    action
}
