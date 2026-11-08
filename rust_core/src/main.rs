use clap::{Parser, Subcommand};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use moeject_core::api::SourceRegistry;
use moeject_core::core::downloader::Downloader;
use moeject_core::core::formats::package_pages;
use moeject_core::gui;
use moeject_core::models::OutputFormat;
use moeject_core::server::router::create_router;
use moeject_core::server::state::AppState;

#[derive(Parser)]
#[command(name = "moeject")]
#[command(author = "MoeJect Developers")]
#[command(version = "1.0.0")]
#[command(about = "High-Performance Native Manga Scraper, Downloader, GUI & REST API in Rust", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Launch the Native Desktop GUI (Default when double-clicked or without arguments)
    Gui {
        #[arg(short, long, default_value = "downloads")]
        downloads_dir: String,
    },

    /// Start the Axum REST API Server
    Serve {
        #[arg(short, long, default_value = "127.0.0.1")]
        host: String,

        #[arg(short, long, default_value_t = 8000)]
        port: u16,

        #[arg(short, long, default_value = "downloads")]
        downloads_dir: String,
    },

    /// Search for manga across sources
    Search {
        #[arg(short, long, default_value = "mangadex")]
        source: String,

        #[arg(short, long, default_value = "")]
        query: String,

        #[arg(short, long, default_value_t = 1)]
        page: u32,
    },

    /// Extract manga information and chapters
    Info {
        #[arg(short, long, default_value = "mangadex")]
        source: String,

        #[arg(short, long)]
        id: String,
    },

    /// Download a chapter directly from CLI
    Download {
        #[arg(short, long, default_value = "mangadex")]
        source: String,

        #[arg(short, long)]
        manga_id: String,

        #[arg(short, long)]
        chapter_id: String,

        #[arg(short, long, default_value = "cbz")]
        format: String,

        #[arg(short, long, default_value = "downloads")]
        output: String,
    },

    /// List all available manga connectors
    Sources,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Setup tracing logger
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    let cli = Cli::parse();

    // Default to Native GUI if no subcommand is supplied
    let command = cli.command.unwrap_or(Commands::Gui {
        downloads_dir: "downloads".to_string(),
    });

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    match command {
        Commands::Gui { downloads_dir } => {
            let out_dir = PathBuf::from(&downloads_dir);
            let _ = std::fs::create_dir_all(&out_dir);

            let registry = Arc::new(SourceRegistry::new());
            let _guard = rt.enter();

            info!("🚀 Launching MoeJect Native Rust GUI...");
            gui::run_gui(registry, out_dir)?;
        }
        Commands::Serve { host, port, downloads_dir } => {
            rt.block_on(async {
                let out_dir = PathBuf::from(&downloads_dir);
                let _ = std::fs::create_dir_all(&out_dir);

                let state = AppState::new(out_dir);
                let app = create_router(state);

                let addr: SocketAddr = format!("{}:{}", host, port).parse()?;
                info!("========================================================");
                info!("🚀 MoeJect Rust Core Engine v1.0.0 is running!");
                info!("⚡ REST API: http://{}", addr);
                info!("📁 Downloads folder: {}", downloads_dir);
                info!("========================================================");

                let listener = tokio::net::TcpListener::bind(addr).await?;
                axum::serve(listener, app).await?;
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;
        }
        Commands::Search { source, query, page } => {
            rt.block_on(async {
                let registry = SourceRegistry::new();
                let src = registry.get(&source)?;
                info!("Searching '{}' on source '{}' (page {})...", query, source, page);
                let results = src.search(&query, page).await?;

                println!("\nFound {} results:", results.len());
                for (i, r) in results.iter().enumerate() {
                    println!(
                        "[{:02}] {} (ID: {}) -> Latest: {}",
                        i + 1,
                        r.title,
                        r.id,
                        r.latest_chapter.as_deref().unwrap_or("N/A")
                    );
                }
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;
        }
        Commands::Info { source, id } => {
            rt.block_on(async {
                let registry = SourceRegistry::new();
                let src = registry.get(&source)?;
                info!("Fetching details for manga '{}' from source '{}'...", id, source);
                let info = src.get_manga_details(&id).await?;

                println!("\nTitle: {}", info.title);
                println!("Authors: {}", info.authors.join(", "));
                println!("Total Chapters: {}", info.chapters.len());
                println!("Chapters list (Top 10):");
                for ch in info.chapters.iter().take(10) {
                    println!(" - [{}] {}", ch.chapter_number, ch.title);
                }
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;
        }
        Commands::Download { source, manga_id, chapter_id, format, output } => {
            rt.block_on(async {
                let out_format: OutputFormat = format.parse().unwrap_or(OutputFormat::Cbz);
                let registry = SourceRegistry::new();
                let src = registry.get(&source)?;

                info!("Fetching manga info and chapter pages...");
                let manga = src.get_manga_details(&manga_id).await?;
                let chapter = manga
                    .chapters
                    .iter()
                    .find(|c| c.id == chapter_id)
                    .cloned()
                    .ok_or("Chapter not found in manga")?;

                let mut pages = chapter.pages.clone();
                if pages.is_empty() {
                    pages = src.get_chapter_pages(&chapter_id).await?;
                }

                info!("Found {} pages. Starting high-speed parallel download...", pages.len());
                let out_dir = PathBuf::from(&output);
                let downloader = Downloader::new(6);
                let downloaded = downloader
                    .download_pages(&pages, None, chapter.drm_data.as_deref(), |done, tot| {
                        print!("\r[Downloading] {}/{} pages...", done, tot);
                        use std::io::Write;
                        let _ = std::io::stdout().flush();
                    })
                    .await?;

                println!("\nDownload completed! Packaging to {:?}...", out_format);
                let packed = package_pages(&out_dir, &manga, &chapter, &downloaded, out_format)?;
                info!("Done! Saved to: {}", packed.display());
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;
        }
        Commands::Sources => {
            let registry = SourceRegistry::new();
            println!("\nAvailable Manga Connectors:");
            for meta in registry.list_metadata() {
                println!(" * [{}] {} ({}) - {}", meta.id, meta.name, meta.language, meta.description);
            }
        }
    }

    Ok(())
}
