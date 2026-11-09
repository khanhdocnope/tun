use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tracks active download tasks and allows cancellation from any thread or IPC command.
#[derive(Clone, Default)]
pub struct TaskManager {
    tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new task and obtain its cancellation flag.
    pub async fn register(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut map = self.tokens.lock().await;
        map.insert(task_id.to_string(), flag.clone());
        flag
    }

    /// Request cancellation of a task.
    /// Returns true if the task was active and was signalled to cancel.
    pub async fn cancel(&self, task_id: &str) -> bool {
        let map = self.tokens.lock().await;
        if let Some(flag) = map.get(task_id) {
            flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    /// Check if a task is cancelled.
    pub async fn is_cancelled(&self, task_id: &str) -> bool {
        let map = self.tokens.lock().await;
        map.get(task_id)
            .map(|f| f.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// Unregister a completed or failed task.
    pub async fn unregister(&self, task_id: &str) {
        let mut map = self.tokens.lock().await;
        map.remove(task_id);
    }
}
