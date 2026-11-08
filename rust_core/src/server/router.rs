use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::server::handlers;
use crate::server::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/health", get(handlers::health))
        .route("/api/sources", get(handlers::get_sources))
        .route("/api/search", get(handlers::search_manga))
        .route(
            "/api/manga/{source}/{manga_id}",
            get(handlers::get_manga_details),
        )
        .route(
            "/api/manga/{source}/chapter/{chapter_id}/pages",
            get(handlers::get_chapter_pages),
        )
        .route("/api/download", post(handlers::start_download))
        .route("/api/download/{task_id}", get(handlers::get_download_progress))
        .route(
            "/api/download/{task_id}/progress",
            get(handlers::get_download_progress),
        )
        .route(
            "/api/download/{task_id}/file",
            get(handlers::get_download_file),
        )
        .route("/api/files/download", get(handlers::download_file_direct))
        .route("/api/files/library", get(handlers::get_library))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
