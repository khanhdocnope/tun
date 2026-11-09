//! CloudCleaner: gọi HF Space qua `POST {space}/v1/clean` (multipart, trả thẳng ảnh nhị phân).
//! Nếu Space chưa có endpoint này (404/405) thì tự rơi về client Gradio SSE cũ.

use std::time::Duration;

use base64::Engine;
use reqwest::header::AUTHORIZATION;
use reqwest::{multipart, RequestBuilder, StatusCode};

use super::client::HfSpaceCleanerClient;
use super::{sniff_mime, BoxFut, CleanError, CleanOutput, CleanParams, Cleaner};
use crate::models::CleanRequest;

pub struct CloudCleaner {
    http: reqwest::Client,
    base: String,
    token: Option<String>,
}

impl CloudCleaner {
    pub fn new(space_url: &str, token: Option<String>, timeout_secs: u64) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(timeout_secs.max(10)))
            .build()
            .unwrap_or_default();
        Self {
            http,
            base: space_url.trim().trim_end_matches('/').to_string(),
            token: token.filter(|t| !t.trim().is_empty()),
        }
    }

    fn authed(&self, rb: RequestBuilder) -> RequestBuilder {
        match &self.token {
            Some(t) => rb.header(AUTHORIZATION, format!("Bearer {t}")),
            None => rb,
        }
    }

    /// `Ok(None)` = Space chưa có `/v1/clean`, cần dùng đường cũ.
    async fn clean_rest(&self, image: &[u8], p: &CleanParams) -> Result<Option<CleanOutput>, CleanError> {
        let part = multipart::Part::bytes(image.to_vec())
            .file_name("page")
            .mime_str(sniff_mime(image))
            .map_err(|e| CleanError::Invalid(e.to_string()))?;

        let form = multipart::Form::new()
            .part("image", part)
            .text("detector", p.detector.clone())
            .text("inpainter", p.inpainter.clone())
            .text("dilation_offset", p.dilation_offset.to_string())
            .text("clean_mode", p.clean_mode.clone());

        let resp = self
            .authed(self.http.post(format!("{}/v1/clean", self.base)))
            .multipart(form)
            .send()
            .await
            .map_err(|e| CleanError::Network(e.to_string()))?;

        let status = resp.status();
        if status.is_success() {
            let bytes = resp.bytes().await.map_err(|e| CleanError::Network(e.to_string()))?;
            let image = bytes.to_vec();
            let mime = sniff_mime(&image);
            return Ok(Some(CleanOutput { image, mime, backend: "cloud" }));
        }

        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            return Ok(None);
        }

        let body = resp.text().await.unwrap_or_default();
        let body: String = body.chars().take(200).collect();
        Err(match status {
            StatusCode::BAD_REQUEST
            | StatusCode::PAYLOAD_TOO_LARGE
            | StatusCode::UNSUPPORTED_MEDIA_TYPE
            | StatusCode::UNPROCESSABLE_ENTITY => CleanError::Invalid(format!("HTTP {status}: {body}")),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                CleanError::Unavailable(format!("HTTP {status}: kiểm tra HF token / quyền truy cập Space"))
            }
            _ => CleanError::Server(format!("HTTP {status}: {body}")),
        })
    }

    async fn clean_legacy(&self, image: &[u8], p: &CleanParams) -> Result<CleanOutput, CleanError> {
        let legacy = HfSpaceCleanerClient::new(Some(self.base.clone()), self.token.clone());
        let req = CleanRequest {
            image_base64: base64::engine::general_purpose::STANDARD.encode(image),
            detector: p.detector.clone(),
            inpainter: p.inpainter.clone(),
            dilation_offset: p.dilation_offset,
            clean_mode: p.clean_mode.clone(),
            max_dim: None,
        };
        let res = legacy.clean_image(&req).await.map_err(CleanError::Server)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(res.cleaned_image_base64)
            .map_err(|e| CleanError::Server(format!("base64 kết quả lỗi: {e}")))?;
        let mime = sniff_mime(&bytes);
        Ok(CleanOutput { image: bytes, mime, backend: "cloud" })
    }
}

impl Cleaner for CloudCleaner {
    fn id(&self) -> &'static str {
        "cloud"
    }

    fn is_available(&self) -> BoxFut<'_, bool> {
        Box::pin(async move {
            if self.base.is_empty() {
                return false;
            }
            self.authed(self.http.get(format!("{}/health", self.base)))
                .timeout(Duration::from_secs(4))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        })
    }

    fn clean<'a>(&'a self, image: &'a [u8], params: &'a CleanParams) -> BoxFut<'a, Result<CleanOutput, CleanError>> {
        Box::pin(async move {
            if self.base.is_empty() {
                return Err(CleanError::Unavailable("chưa cấu hình Space URL".into()));
            }
            match self.clean_rest(image, params).await? {
                Some(out) => Ok(out),
                None => self.clean_legacy(image, params).await,
            }
        })
    }
}
