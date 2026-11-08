use eframe::egui::{self, CornerRadius, RichText, Sense};
use std::path::PathBuf;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use crate::gui::state::{ActiveTab, GuiCommand, GuiEvent};
use crate::gui::theme::CatppuccinMocha;
use crate::gui::views::{browse, cleaner, detail, downloads, library, settings};
use crate::models::{
    DownloadTaskStatus, LibraryFileItem, MangaInfo, MangaSearchResult,
    OutputFormat, SourceMetadata,
};

pub struct MoeJectApp {
    pub active_tab: ActiveTab,
    pub sources: Vec<SourceMetadata>,
    pub selected_source_id: String,

    // Browse
    pub search_query: String,
    pub search_results: Vec<MangaSearchResult>,
    pub is_searching: bool,
    pub search_error: Option<String>,

    // Detail
    pub selected_manga: Option<MangaInfo>,
    pub selected_format: OutputFormat,
    pub batch_range: String,
    pub chapter_filter: String,

    // Downloads
    pub downloads_dir: PathBuf,
    pub tasks: Vec<DownloadTaskStatus>,

    // Library
    pub library_files: Vec<LibraryFileItem>,

    // Cleaner
    pub hf_space_url: String,
    pub cleaner_image_path: Option<PathBuf>,
    pub cleaner_image_bytes: Option<Vec<u8>>,
    pub cleaner_result_bytes: Option<Vec<u8>>,
    pub is_cleaning: bool,
    pub cleaner_error: Option<String>,

    // Async Channel
    pub cmd_tx: UnboundedSender<GuiCommand>,
    pub evt_rx: UnboundedReceiver<GuiEvent>,
}

impl MoeJectApp {
    pub fn new(
        _cc: &eframe::CreationContext<'_>,
        cmd_tx: UnboundedSender<GuiCommand>,
        evt_rx: UnboundedReceiver<GuiEvent>,
        downloads_dir: PathBuf,
    ) -> Self {
        // Load initial sources and scan library
        let _ = cmd_tx.send(GuiCommand::LoadSources);
        let _ = cmd_tx.send(GuiCommand::ScanLibrary);

        Self {
            active_tab: ActiveTab::Browse,
            sources: Vec::new(),
            selected_source_id: "mangadex".to_string(),

            search_query: String::new(),
            search_results: Vec::new(),
            is_searching: false,
            search_error: None,

            selected_manga: None,
            selected_format: OutputFormat::Cbz,
            batch_range: "1-5".to_string(),
            chapter_filter: String::new(),

            downloads_dir,
            tasks: Vec::new(),

            library_files: Vec::new(),

            hf_space_url: "https://khanhdocnope-hf-spaces-manga-cleaner.hf.space".to_string(),
            cleaner_image_path: None,
            cleaner_image_bytes: None,
            cleaner_result_bytes: None,
            is_cleaning: false,
            cleaner_error: None,

            cmd_tx,
            evt_rx,
        }
    }

    fn poll_events(&mut self) {
        while let Ok(evt) = self.evt_rx.try_recv() {
            match evt {
                GuiEvent::SourcesLoaded(srcs) => {
                    if let Some(first) = srcs.first() {
                        if self.selected_source_id.is_empty() {
                            self.selected_source_id = first.id.clone();
                        }
                    }
                    self.sources = srcs;
                }
                GuiEvent::SearchResults { results, .. } => {
                    self.is_searching = false;
                    match results {
                        Ok(items) => {
                            self.search_results = items;
                            self.search_error = None;
                        }
                        Err(e) => {
                            self.search_results.clear();
                            self.search_error = Some(e);
                        }
                    }
                }
                GuiEvent::MangaDetails(res) => {
                    match res {
                        Ok(info) => {
                            self.selected_manga = Some(info);
                            self.active_tab = ActiveTab::Detail;
                        }
                        Err(e) => {
                            self.search_error = Some(format!("Không tải được chi tiết truyện: {}", e));
                        }
                    }
                }
                GuiEvent::DownloadStatus(st) => {
                    if let Some(pos) = self.tasks.iter().position(|t| t.task_id == st.task_id) {
                        self.tasks[pos] = st;
                    } else {
                        self.tasks.push(st);
                    }
                    // Refresh library if completed
                    let _ = self.cmd_tx.send(GuiCommand::ScanLibrary);
                }
                GuiEvent::LibraryScanned(items) => {
                    self.library_files = items;
                }
                GuiEvent::CleanCompleted(res) => {
                    self.is_cleaning = false;
                    match res {
                        Ok(bytes) => {
                            self.cleaner_result_bytes = Some(bytes);
                            self.cleaner_error = None;
                        }
                        Err(e) => {
                            self.cleaner_error = Some(e);
                        }
                    }
                }
            }
        }
    }
}

impl eframe::App for MoeJectApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.poll_events();

        // 1. Left Navigation Panel
        egui::Panel::left("nav_panel")
            .resizable(false)
            .exact_size(220.0)
            .frame(
                egui::Frame::new()
                    .fill(CatppuccinMocha::CRUST)
                    .inner_margin(16.0),
            )
            .show(ui, |ui| {
                // App Logo
                ui.horizontal(|ui| {
                    ui.label(RichText::new("🌸").size(24.0));
                    ui.label(
                        RichText::new("MoeJect")
                            .size(22.0)
                            .strong()
                            .color(CatppuccinMocha::LAVENDER),
                    );
                });
                ui.label(
                    RichText::new("Native Rust Manga Reader")
                        .size(11.0)
                        .color(CatppuccinMocha::SUBTEXT0),
                );

                ui.add_space(24.0);

                // Nav item helper
                let mut nav_item = |ui: &mut egui::Ui, tab: ActiveTab, label: &str, icon: &str, badge: Option<usize>| {
                    let is_active = self.active_tab == tab;
                    let bg = if is_active {
                        CatppuccinMocha::SURFACE0
                    } else {
                        egui::Color32::TRANSPARENT
                    };
                    let text_color = if is_active {
                        CatppuccinMocha::LAVENDER
                    } else {
                        CatppuccinMocha::SUBTEXT1
                    };

                    let frame = egui::Frame::new()
                        .fill(bg)
                        .corner_radius(CornerRadius::same(6))
                        .inner_margin(egui::Margin::symmetric(10, 8));

                    let resp = frame.show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(icon).size(15.0));
                            ui.label(RichText::new(label).size(13.0).strong().color(text_color));

                            if let Some(b) = badge {
                                if b > 0 {
                                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                        let b_frame = egui::Frame::new()
                                            .fill(CatppuccinMocha::LAVENDER)
                                            .corner_radius(CornerRadius::same(10))
                                            .inner_margin(egui::Margin::symmetric(6, 1));
                                        b_frame.show(ui, |ui| {
                                            ui.label(
                                                RichText::new(b.to_string())
                                                    .size(10.0)
                                                    .strong()
                                                    .color(CatppuccinMocha::CRUST),
                                            );
                                        });
                                    });
                                }
                            }
                        });
                    });

                    let interact = ui.interact(resp.response.rect, resp.response.id, Sense::click());
                    if interact.hovered() {
                        ui.output_mut(|o| o.cursor_icon = egui::CursorIcon::PointingHand);
                    }
                    if interact.clicked() {
                        self.active_tab = tab;
                    }
                    ui.add_space(4.0);
                };

                let running_tasks = self.tasks.iter().filter(|t| t.status == "running").count();

                nav_item(ui, ActiveTab::Browse, "Khám phá", "📖", None);
                nav_item(ui, ActiveTab::Downloads, "Tải về", "⬇️", Some(running_tasks));
                nav_item(ui, ActiveTab::Library, "Thư viện", "📚", None);
                nav_item(ui, ActiveTab::Cleaner, "Tẩy thoại AI", "🪄", None);
                nav_item(ui, ActiveTab::Settings, "Cài đặt", "⚙️", None);

                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    ui.label(
                        RichText::new("v1.0.0 • Pure Rust Engine")
                            .size(10.0)
                            .color(CatppuccinMocha::OVERLAY0),
                    );
                });
            });

        // 2. Central Content Panel
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(CatppuccinMocha::MANTLE)
                    .inner_margin(16.0),
            )
            .show(ui, |ui| {
                match self.active_tab {
                    ActiveTab::Browse => {
                        let action = browse::render_browse_view(
                            ui,
                            &self.sources,
                            &mut self.selected_source_id,
                            &mut self.search_query,
                            &self.search_results,
                            self.is_searching,
                            self.search_error.as_deref(),
                        );

                        if let Some((src, q)) = action.do_search {
                            self.is_searching = true;
                            let _ = self.cmd_tx.send(GuiCommand::Search { source: src, query: q });
                        }

                        if let Some((src, m_id)) = action.select_manga {
                            let _ = self.cmd_tx.send(GuiCommand::GetDetails {
                                source: src,
                                manga_id: m_id,
                            });
                        }
                    }
                    ActiveTab::Detail => {
                        if let Some(ref manga) = self.selected_manga {
                            let action = detail::render_detail_view(
                                ui,
                                &self.selected_source_id,
                                manga,
                                &mut self.selected_format,
                                &mut self.batch_range,
                                &mut self.chapter_filter,
                            );

                            if action.go_back {
                                self.active_tab = ActiveTab::Browse;
                            }

                            if let Some(req) = action.start_download {
                                let _ = self.cmd_tx.send(GuiCommand::StartDownload { request: req });
                                self.active_tab = ActiveTab::Downloads;
                            }
                        } else {
                            self.active_tab = ActiveTab::Browse;
                        }
                    }
                    ActiveTab::Downloads => {
                        downloads::render_downloads_view(ui, &self.tasks, &self.downloads_dir);
                    }
                    ActiveTab::Library => {
                        let action = library::render_library_view(ui, &self.library_files, &self.downloads_dir);
                        if let Some(act) = action {
                            match act {
                                library::LibraryAction::Refresh => {
                                    let _ = self.cmd_tx.send(GuiCommand::ScanLibrary);
                                }
                                library::LibraryAction::DeleteFile(path) => {
                                    let _ = std::fs::remove_file(path);
                                    let _ = self.cmd_tx.send(GuiCommand::ScanLibrary);
                                }
                            }
                        }
                    }
                    ActiveTab::Cleaner => {
                        let action = cleaner::render_cleaner_view(
                            ui,
                            &mut self.hf_space_url,
                            self.cleaner_image_path.as_ref(),
                            self.cleaner_image_bytes.as_deref(),
                            self.cleaner_result_bytes.as_deref(),
                            self.is_cleaning,
                            self.cleaner_error.as_deref(),
                        );

                        if let Some(act) = action {
                            match act {
                                cleaner::CleanerAction::PickImage => {
                                    if let Some(file) = rfd::FileDialog::new()
                                        .add_filter("Manga Images", &["png", "jpg", "jpeg", "webp"])
                                        .pick_file()
                                    {
                                        if let Ok(bytes) = std::fs::read(&file) {
                                            self.cleaner_image_path = Some(file);
                                            self.cleaner_image_bytes = Some(bytes);
                                            self.cleaner_result_bytes = None;
                                            self.cleaner_error = None;
                                        }
                                    }
                                }
                                cleaner::CleanerAction::StartClean { image_bytes, hf_url } => {
                                    self.is_cleaning = true;
                                    self.cleaner_error = None;
                                    let _ = self.cmd_tx.send(GuiCommand::CleanImage { image_bytes, hf_url });
                                }
                                cleaner::CleanerAction::SaveCleaned(bytes) => {
                                    if let Some(dest) = rfd::FileDialog::new()
                                        .set_file_name("manga_cleaned.jpg")
                                        .save_file()
                                    {
                                        let _ = std::fs::write(dest, bytes);
                                    }
                                }
                            }
                        }
                    }
                    ActiveTab::Settings => {
                        let action = settings::render_settings_view(ui, &self.downloads_dir);
                        if let Some(act) = action {
                            match act {
                                settings::SettingsAction::ChangeDownloadDir(new_dir) => {
                                    self.downloads_dir = new_dir;
                                    let _ = self.cmd_tx.send(GuiCommand::ScanLibrary);
                                }
                                settings::SettingsAction::ClearCache => {}
                            }
                        }
                    }
                }
            });

        // Request repaint if background downloads or cleaning are in progress
        let has_active_work = self.tasks.iter().any(|t| t.status == "running") || self.is_cleaning;
        if has_active_work {
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(200));
        }
    }
}
