//! Adapter ONNX Runtime (crate `ort`) cho `TensorRunner`.
//!
//! CHÚ Ý: API của `ort` 2.0 còn là release-candidate và đổi giữa các bản rc. File này viết cho
//! `ort = "=2.0.0-rc.10"` (đã ghim trong Cargo.toml) và là CHỖ DUY NHẤT chạm vào crate đó; nếu
//! nâng cấp `ort` chỉ cần sửa ở đây. Chỉ hỗ trợ tensor f32 (model fp16 phải giữ IO ở f32).
//!
//! Android: bản mặc định tải ONNX Runtime cho desktop khi build. Với APK cần cấu hình riêng
//! (feature `load-dynamic` + thư viện `libonnxruntime.so` theo ABI, hoặc execution provider NNAPI).

use std::path::Path;
use std::sync::Mutex;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::{Tensor, ValueType};

use super::runner::{TensorIn, TensorOut, TensorRunner};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub struct OrtRunner {
    session: Mutex<Session>,
    input_names: Vec<String>,
    input_dims: Vec<Vec<i64>>,
}

impl OrtRunner {
    pub fn load(path: &Path, threads: usize) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(err)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(err)?
            .with_intra_threads(threads)
            .map_err(err)?
            .commit_from_file(path)
            .map_err(|e| format!("không nạp được {}: {}", path.display(), e))?;

        let input_names = session.inputs.iter().map(|i| i.name.clone()).collect();
        let input_dims = session
            .inputs
            .iter()
            .map(|i| match &i.input_type {
                ValueType::Tensor { shape, .. } => shape.iter().copied().collect(),
                _ => Vec::new(),
            })
            .collect();

        Ok(Self { session: Mutex::new(session), input_names, input_dims })
    }
}

impl TensorRunner for OrtRunner {
    fn run(&self, inputs: &[TensorIn<'_>]) -> Result<Vec<TensorOut>, String> {
        if inputs.len() != self.input_names.len() {
            return Err(format!("model cần {} input, nhận {}", self.input_names.len(), inputs.len()));
        }
        let tensors: Vec<Tensor<f32>> = inputs
            .iter()
            .map(|i| Tensor::from_array((i.shape.clone(), i.data.to_vec())).map_err(err))
            .collect::<Result<_, _>>()?;

        let mut session = self.session.lock().map_err(|_| "khóa session bị hỏng".to_string())?;
        let outputs = match tensors.len() {
            1 => session.run(ort::inputs![self.input_names[0].as_str() => &tensors[0]]).map_err(err)?,
            2 => session
                .run(ort::inputs![
                    self.input_names[0].as_str() => &tensors[0],
                    self.input_names[1].as_str() => &tensors[1]
                ])
                .map_err(err)?,
            n => return Err(format!("OrtRunner chỉ hỗ trợ 1-2 input, nhận {n}")),
        };

        let mut result = Vec::new();
        for (_, value) in outputs.iter() {
            let (shape, data) = value.try_extract_tensor::<f32>().map_err(err)?;
            result.push(TensorOut {
                shape: shape.iter().map(|&d| d as usize).collect(),
                data: data.to_vec(),
            });
        }
        Ok(result)
    }

    fn input_dims(&self, index: usize) -> Option<Vec<i64>> {
        self.input_dims.get(index).filter(|d| !d.is_empty()).cloned()
    }
}
