use super::runner::{TensorIn, TensorOut, TensorRunner};

type RunFn = dyn Fn(&[TensorIn<'_>]) -> Result<Vec<TensorOut>, String> + Send + Sync;

/// Runner giả cho test: chạy closure thay cho model thật.
pub struct MockRunner {
    f: Box<RunFn>,
    dims: Option<Vec<i64>>,
}

impl MockRunner {
    pub fn new(f: impl Fn(&[TensorIn<'_>]) -> Result<Vec<TensorOut>, String> + Send + Sync + 'static) -> Self {
        Self { f: Box::new(f), dims: None }
    }

    pub fn with_dims(mut self, dims: Vec<i64>) -> Self {
        self.dims = Some(dims);
        self
    }
}

impl TensorRunner for MockRunner {
    fn run(&self, inputs: &[TensorIn<'_>]) -> Result<Vec<TensorOut>, String> {
        (self.f)(inputs)
    }

    fn input_dims(&self, index: usize) -> Option<Vec<i64>> {
        if index == 0 {
            self.dims.clone()
        } else {
            None
        }
    }
}
