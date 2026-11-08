use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MoeJectError {
    #[error("Network/HTTP error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Zip compression error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("Source '{0}' not found or unsupported")]
    SourceNotFound(String),

    #[error("Manga or chapter not found: {0}")]
    NotFound(String),

    #[error("Scraper/Parse error: {0}")]
    Parse(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Internal engine error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, MoeJectError>;

impl IntoResponse for MoeJectError {
    fn into_response(self) -> Response {
        let (status, err_msg) = match self {
            MoeJectError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            MoeJectError::SourceNotFound(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            MoeJectError::InvalidRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = json!({
            "error": true,
            "message": err_msg
        });

        (status, axum::Json(body)).into_response()
    }
}
