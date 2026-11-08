use crate::models::{CleanRequest, CleanResponse};
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct HfSpaceCleanerClient {
    client: reqwest::Client,
    space_url: String,
    token: Option<String>,
}

impl HfSpaceCleanerClient {
    pub fn new(space_url: Option<String>, token: Option<String>) -> Self {
        let base = space_url.unwrap_or_else(|| "https://dobietdc-manga-text-cleaner.hf.space".to_string());
        let client = reqwest::Client::builder().build().unwrap_or_default();
        Self {
            client,
            space_url: base.trim_end_matches('/').to_string(),
            token,
        }
    }

    pub async fn clean_image(&self, req: &CleanRequest) -> Result<CleanResponse, String> {
        let start_time = std::time::Instant::now();
        let image_bytes = base64::engine::general_purpose::STANDARD
            .decode(&req.image_base64)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;

        let mut headers = HeaderMap::new();
        if let Some(ref t) = self.token {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", t)) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        // 1. Upload to /gradio_api/upload
        let part = reqwest::multipart::Part::bytes(image_bytes)
            .file_name("page.webp")
            .mime_str("image/webp")
            .map_err(|e| e.to_string())?;

        let form = reqwest::multipart::Form::new().part("files", part);

        let upload_url = format!("{}/gradio_api/upload", self.space_url);
        let up_resp = self.client.post(&upload_url)
            .headers(headers.clone())
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload to space failed: {}", e))?;

        if !up_resp.status().is_success() {
            return Err(format!("Upload returned status: {}", up_resp.status()));
        }

        let up_json: Value = up_resp.json().await.map_err(|e| e.to_string())?;
        let remote_path = up_json.as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .ok_or("No file path in upload response")?
            .to_string();

        // 2. Join queue
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        let session_hash = format!("moeject_{}", now_ms);

        let file_data = json!({
            "path": remote_path,
            "meta": { "_type": "gradio.FileData" }
        });

        let payload = json!({
            "data": [
                file_data,
                req.detector,
                req.inpainter,
                req.dilation_offset,
                req.clean_mode
            ],
            "fn_index": 0,
            "session_hash": session_hash
        });

        let join_url = format!("{}/gradio_api/queue/join", self.space_url);
        let join_resp = self.client.post(&join_url)
            .headers(headers.clone())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Join queue failed: {}", e))?;

        if !join_resp.status().is_success() {
            return Err(format!("Join queue returned status: {}", join_resp.status()));
        }

        // 3. Listen to SSE queue stream
        let stream_url = format!("{}/gradio_api/queue/data?session_hash={}", self.space_url, session_hash);
        let s_resp = self.client.get(&stream_url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| format!("Connect SSE stream failed: {}", e))?;

        let text = s_resp.text().await.map_err(|e| format!("Read SSE stream failed: {}", e))?;
        let mut download_path = String::new();

        for line in text.lines() {
            if let Some(data_str) = line.strip_prefix("data: ") {
                if let Ok(msg) = serde_json::from_str::<Value>(data_str) {
                    if msg["msg"] == "process_completed" {
                        if let Some(path) = msg["output"]["data"][0]["path"].as_str() {
                            download_path = path.to_string();
                            break;
                        } else if let Some(url) = msg["output"]["data"][0]["url"].as_str() {
                            download_path = url.to_string();
                            break;
                        }
                    }
                }
            }
        }

        if download_path.is_empty() {
            return Err("HF Space completed without returning output file path".to_string());
        }

        // 4. Download result
        let dl_url = if download_path.starts_with("http") {
            download_path
        } else {
            format!("{}/gradio_api/file={}", self.space_url, download_path)
        };

        let dl_resp = self.client.get(&dl_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Download cleaned image failed: {}", e))?;

        let cleaned_bytes = dl_resp.bytes().await.map_err(|e| e.to_string())?;
        let cleaned_b64 = base64::engine::general_purpose::STANDARD.encode(cleaned_bytes);
        let elapsed = format!("{:.2}s", start_time.elapsed().as_secs_f32());

        Ok(CleanResponse {
            cleaned_image_base64: cleaned_b64,
            time_taken: Some(elapsed),
        })
    }
}
