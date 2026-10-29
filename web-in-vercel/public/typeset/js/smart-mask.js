/**
 * Smart Region-based Masking Tool
 * Otsu thresholding + Connected Components / Perimeter check + Morphological Dilation
 * Floating mask editor (Brush / Eraser / Dilation)
 */

export class SmartMaskTool {
  constructor() {
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: true });
    this.originalBinaryMask = null; // Uint8Array before dilation
    this.activeRect = null;
    this.dilation = 3;
    this.isLightBg = true;
  }

  /**
   * Tính ngưỡng Otsu tự động từ mảng grayscale
   */
  computeOtsuThreshold(grayData, w, h) {
    const hist = new Int32Array(256);
    const total = w * h;
    for (let i = 0; i < total; i++) {
      hist[grayData[i]]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * hist[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  /**
   * Kiểm tra độ sáng trung bình của viền khung (Perimeter luminance)
   */
  checkPerimeterLuminance(grayData, w, h) {
    let sum = 0;
    let count = 0;

    // Hàng trên & dưới
    for (let x = 0; x < w; x++) {
      sum += grayData[x];
      sum += grayData[(h - 1) * w + x];
      count += 2;
    }
    // Cột trái & phải
    for (let y = 1; y < h - 1; y++) {
      sum += grayData[y * w];
      sum += grayData[y * w + (w - 1)];
      count += 2;
    }

    const avg = count > 0 ? sum / count : 255;
    return avg > 128; // true = nền sáng (nét chữ tối màu)
  }

  /**
   * Tự động nhận diện nét chữ trong vùng chọn (Auto-snap Mask)
   * @param {HTMLImageElement|HTMLCanvasElement} sourceImage
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {number} dilation
   */
  createSnapMask(sourceImage, rect, dilation = 3) {
    this.activeRect = { ...rect };
    this.dilation = dilation;

    const w = Math.max(10, Math.round(rect.width));
    const h = Math.max(10, Math.round(rect.height));

    this.maskCanvas.width = w;
    this.maskCanvas.height = h;

    // Vẽ vùng cắt từ ảnh gốc lên canvas tạm
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

    tempCtx.drawImage(
      sourceImage,
      Math.max(0, rect.x),
      Math.max(0, rect.y),
      w,
      h,
      0,
      0,
      w,
      h
    );

    const imgData = tempCtx.getImageData(0, 0, w, h);
    const pixels = imgData.data;
    const total = w * h;

    // Chuyển sang Grayscale
    const gray = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      gray[i] = Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
    }

    // Xác định nền sáng hay nền tối
    this.isLightBg = this.checkPerimeterLuminance(gray, w, h);
    const threshold = this.computeOtsuThreshold(gray, w, h);

    // Tạo binary mask: 1 = nét chữ, 0 = nền
    const rawMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (this.isLightBg) {
        // Nền sáng: chữ là pixel tối hơn ngưỡng
        rawMask[i] = gray[i] < threshold - 5 ? 1 : 0;
      } else {
        // Nền tối: chữ là pixel sáng hơn ngưỡng
        rawMask[i] = gray[i] > threshold + 5 ? 1 : 0;
      }
    }

    this.originalBinaryMask = rawMask;
    this.applyDilation(dilation);

    return {
      canvas: this.maskCanvas,
      isLightBg: this.isLightBg,
      rect: this.activeRect,
    };
  }

  /**
   * Áp dụng thuật toán Giãn nở hình thái học (Morphological Dilation)
   */
  applyDilation(dilationRadius) {
    if (!this.originalBinaryMask) return;
    this.dilation = Math.max(0, Math.min(20, dilationRadius));

    const w = this.maskCanvas.width;
    const h = this.maskCanvas.height;
    const total = w * h;
    const dilated = new Uint8Array(total);

    const r = this.dilation;
    if (r === 0) {
      dilated.set(this.originalBinaryMask);
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (this.originalBinaryMask[y * w + x] === 1) {
            // Giãn nở hình tròn bán kính r
            const minX = Math.max(0, x - r);
            const maxX = Math.min(w - 1, x + r);
            const minY = Math.max(0, y - r);
            const maxY = Math.min(h - 1, y + r);
            for (let ny = minY; ny <= maxY; ny++) {
              const dy = ny - y;
              for (let nx = minX; nx <= maxX; nx++) {
                const dx = nx - x;
                if (dx * dx + dy * dy <= r * r) {
                  dilated[ny * w + nx] = 1;
                }
              }
            }
          }
        }
      }
    }

    // Vẽ lên maskCanvas: màu hồng mờ #f43f5e (RGBA: 244, 63, 94, 0.65)
    this.maskCtx.clearRect(0, 0, w, h);
    const outputImgData = this.maskCtx.createImageData(w, h);
    const outData = outputImgData.data;

    for (let i = 0; i < total; i++) {
      if (dilated[i] === 1) {
        const idx = i * 4;
        outData[idx] = 244;     // R
        outData[idx + 1] = 63;  // G
        outData[idx + 2] = 94;  // B
        outData[idx + 3] = 160; // Alpha ~0.63
      }
    }
    this.maskCtx.putImageData(outputImgData, 0, 0);
  }

  /**
   * Vẽ thêm mask bằng cọ Brush
   */
  paintBrush(x, y, brushSize) {
    this.maskCtx.save();
    this.maskCtx.fillStyle = "rgba(244, 63, 94, 0.75)";
    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    this.maskCtx.fill();
    this.maskCtx.restore();
  }

  /**
   * Xóa bớt mask bằng cục tẩy Eraser
   */
  paintEraser(x, y, eraserSize) {
    this.maskCtx.save();
    this.maskCtx.globalCompositeOperation = "destination-out";
    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, eraserSize / 2, 0, Math.PI * 2);
    this.maskCtx.fill();
    this.maskCtx.restore();
  }

  /**
   * Xuất full mask toàn trang dạng Canvas đen trắng (trắng = mask xóa chữ, đen = giữ nguyên)
   */
  exportFullPageMaskCanvas(pageWidth, pageHeight) {
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = pageWidth;
    fullCanvas.height = pageHeight;
    const ctx = fullCanvas.getContext("2d");

    // Nền đen hoàn toàn (0)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    if (this.activeRect && this.maskCanvas.width > 0 && this.maskCanvas.height > 0) {
      // Đọc các pixel có màu trên maskCanvas để vẽ thành màu trắng (#ffffff)
      const w = this.maskCanvas.width;
      const h = this.maskCanvas.height;
      const imgData = this.maskCtx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const monoCanvas = document.createElement("canvas");
      monoCanvas.width = w;
      monoCanvas.height = h;
      const monoCtx = monoCanvas.getContext("2d");
      const monoData = monoCtx.createImageData(w, h);
      const mPixels = monoData.data;

      for (let i = 0; i < w * h; i++) {
        const a = data[i * 4 + 3];
        if (a > 20) {
          mPixels[i * 4] = 255;
          mPixels[i * 4 + 1] = 255;
          mPixels[i * 4 + 2] = 255;
          mPixels[i * 4 + 3] = 255;
        }
      }
      monoCtx.putImageData(monoData, 0, 0);

      ctx.drawImage(monoCanvas, this.activeRect.x, this.activeRect.y);
    }

    return fullCanvas;
  }

  /**
   * Xuất full mask toàn trang dạng Base64 đen trắng (trắng = mask xóa chữ, đen = giữ nguyên)
   * để gửi sang AI Inpainter Backend
   */
  exportFullPageMaskB64(pageWidth, pageHeight) {
    return this.exportFullPageMaskCanvas(pageWidth, pageHeight).toDataURL("image/png");
  }

  /**
   * Trích xuất ảnh crop của vùng chọn để gửi OCR
   */
  cropRegionB64(sourceImage, rect) {
    const w = Math.max(10, Math.round(rect.width));
    const h = Math.max(10, Math.round(rect.height));

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = w;
    cropCanvas.height = h;
    const ctx = cropCanvas.getContext("2d");

    ctx.drawImage(
      sourceImage,
      Math.max(0, rect.x),
      Math.max(0, rect.y),
      w,
      h,
      0,
      0,
      w,
      h
    );

    return cropCanvas.toDataURL("image/jpeg", 0.95);
  }
}
