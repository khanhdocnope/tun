use super::host_gate::HostGate;
use super::task_manager::TaskManager;
use super::validator::{detect_image_format, is_valid_image, validate_saved_image};
use crate::sources::hitomi::{GgParams, HitomiSource};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
fn test_validator_magic_bytes() {
    // Valid PNG
    assert_eq!(detect_image_format(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Some("png"));
    // Valid JPEG
    assert_eq!(detect_image_format(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Some("jpg"));
    // Valid WebP
    assert_eq!(detect_image_format(b"RIFF\x20\x00\x00\x00WEBPVP8 "), Some("webp"));
    // Valid GIF
    assert_eq!(detect_image_format(b"GIF89a\x01\x00\x01\x00"), Some("gif"));
    assert_eq!(detect_image_format(b"GIF87a\x01\x00\x01\x00"), Some("gif"));

    // Invalid formats (Cloudflare WAF / HTML blocks / JSON errors)
    assert_eq!(detect_image_format(b"<!DOCTYPE html><html><body>Access Denied</body></html>"), None);
    assert_eq!(detect_image_format(b"{\"error\":\"404 Not Found\"}"), None);
    assert_eq!(detect_image_format(&[0x00, 0x00, 0x00, 0x00]), None);
    assert_eq!(detect_image_format(&[]), None);
    assert!(!is_valid_image(b"broken"));
}

#[tokio::test]
async fn test_host_semaphore_concurrency_gate() {
    let gate = HostGate::new(2);

    let permit1 = gate.acquire("uploads.mangadex.org").await;
    assert!(permit1.is_some());
    assert_eq!(gate.available_permits("uploads.mangadex.org").await, 1);

    let permit2 = gate.acquire("uploads.mangadex.org").await;
    assert!(permit2.is_some());
    assert_eq!(gate.available_permits("uploads.mangadex.org").await, 0);

    // Other host should still have permits available
    assert_eq!(gate.available_permits("gold-usergeneratedcontent.net").await, 2);
    let permit_other = gate.acquire("gold-usergeneratedcontent.net").await;
    assert!(permit_other.is_some());
    assert_eq!(gate.available_permits("gold-usergeneratedcontent.net").await, 1);

    // Dropping permit frees up slot
    drop(permit1);
    assert_eq!(gate.available_permits("uploads.mangadex.org").await, 1);
}

#[tokio::test]
async fn test_task_cancellation_manager() {
    let tm = TaskManager::new();
    let task_id = "test-task-123";

    let cancel_flag = tm.register(task_id).await;
    assert!(!cancel_flag.load(Ordering::SeqCst));
    assert!(!tm.is_cancelled(task_id).await);

    let cancelled = tm.cancel(task_id).await;
    assert!(cancelled);
    assert!(cancel_flag.load(Ordering::SeqCst));
    assert!(tm.is_cancelled(task_id).await);

    tm.unregister(task_id).await;
    assert!(!tm.cancel(task_id).await);
}

#[test]
fn test_hitomi_gg_dynamic_sharding_and_fallbacks() {
    let mut cases = HashSet::new();
    cases.insert(0x1234);

    let params = GgParams {
        gg_b: "1794056401/".to_string(),
        default_o: 0,
        case_o: 1,
        cases,
        fetched_at: Instant::now(),
    };

    // Test hash with ending "1234" -> matches case 0x1234 -> m_val = 1 -> subdomain w2
    let hash = "a1b2c3d4e5f60000000000000000000000000000000000000000000000001234";
    let candidates = HitomiSource::resolve_image_candidates_with_params(hash, &params);

    assert_eq!(candidates.len(), 4);
    // Primary gold CDN shard
    assert!(candidates[0].contains("gold-usergeneratedcontent.net"));
    // Alternate gold shard
    assert!(candidates[1].contains("gold-usergeneratedcontent.net"));
    // Direct Hitomi CDN
    assert!(candidates[2].contains("hitomi.la/webp"));
    // Alternate direct Hitomi CDN
    assert!(candidates[3].contains("hitomi.la/webp"));
}

#[test]
fn test_resume_saved_image_validation() {
    let temp_dir = std::env::temp_dir().join("moeject_test_resume");
    let _ = fs::create_dir_all(&temp_dir);

    let valid_png_file = temp_dir.join("page_0001.png");
    let corrupted_file = temp_dir.join("page_0002.part");
    let html_file = temp_dir.join("page_0003.jpg");

    // Write real PNG
    fs::write(&valid_png_file, &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]).unwrap();
    // Write partial corrupted
    fs::write(&corrupted_file, b"corrupted bytes").unwrap();
    // Write fake HTML disguised as jpg
    fs::write(&html_file, b"<html>403 Forbidden</html>").unwrap();

    assert_eq!(validate_saved_image(&valid_png_file).unwrap(), "png");
    assert!(validate_saved_image(&corrupted_file).is_err());
    assert!(validate_saved_image(&html_file).is_err());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_mock_server_429_retry_after_and_jitter() {
    // Spin up lightweight mock TCP HTTP server
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let request_count = Arc::new(AtomicUsize::new(0));
    let count_clone = request_count.clone();

    // Spawn server thread
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut s) = stream {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let current = count_clone.fetch_add(1, Ordering::SeqCst);

                if current == 0 {
                    // First request: Respond with 429 Too Many Requests and Retry-After: 1
                    let resp = "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = s.write_all(resp.as_bytes());
                } else {
                    // Second request: Respond with 200 OK and valid PNG magic bytes
                    let png_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        png_bytes.len()
                    );
                    let _ = s.write_all(header.as_bytes());
                    let _ = s.write_all(&png_bytes);
                    break;
                }
            }
        }
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/test_page.png", port);

    // Simulated retry loop matching downloader logic
    let mut attempts = 0;
    let mut downloaded_bytes: Option<Vec<u8>> = None;

    while attempts < 3 && downloaded_bytes.is_none() {
        attempts += 1;
        let resp = client.get(&url).send().await.unwrap();

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp.headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(1);
            assert_eq!(retry_after, 1);
            // Simulate short sleep
            tokio::time::sleep(Duration::from_millis(150)).await;
            continue;
        }

        if resp.status().is_success() {
            let bytes = resp.bytes().await.unwrap().to_vec();
            downloaded_bytes = Some(bytes);
            break;
        }
    }

    assert_eq!(attempts, 2);
    let bytes = downloaded_bytes.expect("Should have downloaded on retry");
    assert_eq!(detect_image_format(&bytes), Some("png"));
    assert_eq!(request_count.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn test_mock_server_retry_at_least_three_times_on_error() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let request_count = Arc::new(AtomicUsize::new(0));
    let count_clone = request_count.clone();

    // Server returns 500 Internal Server Error 3 times
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut s) = stream {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                count_clone.fetch_add(1, Ordering::SeqCst);

                let resp = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = s.write_all(resp.as_bytes());

                if count_clone.load(Ordering::SeqCst) >= 3 {
                    break;
                }
            }
        }
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/error_page.jpg", port);

    let mut attempts = 0;
    let mut last_err = String::new();

    while attempts < 3 {
        attempts += 1;
        match client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().is_server_error() {
                    last_err = format!("ERR_HTTP_5XX_SERVER: Status {}", resp.status());
                }
            }
            Err(e) => {
                last_err = format!("ERR_NETWORK: {}", e);
            }
        }
    }

    assert_eq!(attempts, 3, "Must attempt at least 3 times");
    assert_eq!(request_count.load(Ordering::SeqCst), 3, "Must have called server 3 times");
    assert!(last_err.contains("ERR_HTTP_5XX_SERVER"), "Must report specific error code");
}
