/// Tensor f32 đầu vào (layout hàng, `shape` theo thứ tự model, ví dụ [1, 3, H, W]).
pub struct TensorIn<'a> {
    pub shape: Vec<usize>,
    pub data: &'a [f32],
}

pub struct TensorOut {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

/// Một model ONNX (hoặc bản giả trong test).
pub trait TensorRunner: Send + Sync {
    /// Đầu vào theo đúng thứ tự khai báo của model.
    fn run(&self, inputs: &[TensorIn<'_>]) -> Result<Vec<TensorOut>, String>;

    /// Kích thước khai báo của input thứ `index` (giá trị <= 0 = động). `None` nếu không biết.
    fn input_dims(&self, _index: usize) -> Option<Vec<i64>> {
        None
    }
}
