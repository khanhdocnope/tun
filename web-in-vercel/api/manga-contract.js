/**
 * manga-contract.js
 * Chuẩn hóa API Contract & Data Pipeline Specification (V2.0).
 * Cung cấp các hàm tiện ích chuyển đổi hình học, sắp xếp thứ tự đọc Manga/Webtoon
 * và đảm bảo Single Source of Truth cho toàn bộ dự án.
 */

/**
 * @typedef {Object} PixelBounds
 * @property {number} x - Tọa độ X góc trên-trái (pixels)
 * @property {number} y - Tọa độ Y góc trên-trái (pixels)
 * @property {number} width - Chiều rộng (pixels)
 * @property {number} height - Chiều cao (pixels)
 */

/**
 * @typedef {Object} MangaLayer
 * @property {string} id - Mã định danh layer ("bubble_01")
 * @property {number} order_index - Thứ tự đọc (1, 2, 3...)
 * @property {"speech_bubble"|"sfx"|"narrative_box"|"free_text"} type - Loại layer
 * @property {number[]} box_2d - [ymin, xmin, ymax, xmax] thang [0..1000]
 * @property {PixelBounds} pixel_bounds - Tọa độ pixel trên ảnh gốc
 * @property {Object} geometry - { is_pure_white_bg: boolean, polygon?: number[][], confidence: number }
 * @property {Object} typography - { orientation: "vertical"|"horizontal", suggested_font_size_pt: number, text_align: string, font_color: string }
 * @property {Object} content - { original_text: string, translated_text: string, confidence: number }
 */

/**
 * Chuyển đổi tọa độ pixel [x1, y1, x2, y2] sang hệ tọa độ chuẩn hóa [ymin, xmin, ymax, xmax] thang [0..1000].
 * @param {number[]} pixelBox - [x1, y1, x2, y2]
 * @param {number} width - Chiều rộng ảnh gốc
 * @param {number} height - Chiều cao ảnh gốc
 * @returns {number[]} [ymin, xmin, ymax, xmax] trong khoảng [0..1000]
 */
function toNormalizedBox(pixelBox, width, height) {
  const [x1, y1, x2, y2] = pixelBox;
  const wSafe = Math.max(1, width);
  const hSafe = Math.max(1, height);

  const ymin = Math.round(Math.max(0, Math.min(1000, (y1 / hSafe) * 1000)));
  const xmin = Math.round(Math.max(0, Math.min(1000, (x1 / wSafe) * 1000)));
  const ymax = Math.round(Math.max(0, Math.min(1000, (y2 / hSafe) * 1000)));
  const xmax = Math.round(Math.max(0, Math.min(1000, (x2 / wSafe) * 1000)));

  return [
    ymin,
    xmin,
    ymax <= ymin ? Math.min(1000, ymin + 1) : ymax,
    xmax <= xmin ? Math.min(1000, xmin + 1) : xmax,
  ];
}

/**
 * Chuyển đổi [ymin, xmin, ymax, xmax] thang [0..1000] về PixelBounds { x, y, width, height }.
 * @param {number[]} box2d - [ymin, xmin, ymax, xmax]
 * @param {number} width - Chiều rộng ảnh gốc
 * @param {number} height - Chiều cao ảnh gốc
 * @returns {PixelBounds}
 */
function toPixelBounds(box2d, width, height) {
  const [ymin, xmin, ymax, xmax] = box2d;
  const x = Math.round((xmin / 1000) * width);
  const y = Math.round((ymin / 1000) * height);
  const w = Math.max(1, Math.round(((xmax - xmin) / 1000) * width));
  const h = Math.max(1, Math.round(((ymax - ymin) / 1000) * height));
  return { x, y, width: w, height: h };
}

/**
 * Sắp xếp các MangaLayer theo thứ tự đọc tự nhiên chuẩn công nghiệp:
 * - "rtl" (Manga): Trên xuống Dưới, Phải qua Trái.
 * - "ltr" (Comic): Trên xuống Dưới, Trái qua Phải.
 * - "ttb" (Webtoon): Ưu tiên trục dọc Y.
 * @param {MangaLayer[]} layers
 * @param {"rtl"|"ltr"|"ttb"} [readingDirection="rtl"]
 * @param {number} [height=1000]
 * @returns {MangaLayer[]}
 */
function sortReadingOrder(layers, readingDirection = "rtl", height = 1000) {
  if (!layers || !layers.length) return [];

  const bandHeight = Math.max(50, Math.round(height * 0.1));
  const sorted = [...layers].sort((a, b) => {
    const [aYmin, aXmin, aYmax, aXmax] = a.box_2d || [0, 0, 0, 0];
    const [bYmin, bXmin, bYmax, bXmax] = b.box_2d || [0, 0, 0, 0];

    const aYCenter = (aYmin + aYmax) / 2;
    const aXCenter = (aXmin + aXmax) / 2;
    const bYCenter = (bYmin + bYmax) / 2;
    const bXCenter = (bXmin + bXmax) / 2;

    if (readingDirection === "rtl") {
      const aBand = Math.floor(aYCenter / bandHeight);
      const bBand = Math.floor(bYCenter / bandHeight);
      if (aBand !== bBand) return aBand - bBand;
      // Cùng dải hàng: box bên phải (xCenter lớn hơn) đọc trước
      return bXCenter - aXCenter;
    } else if (readingDirection === "ltr") {
      const aBand = Math.floor(aYCenter / bandHeight);
      const bBand = Math.floor(bYCenter / bandHeight);
      if (aBand !== bBand) return aBand - bBand;
      return aXCenter - bXCenter;
    } else {
      // ttb (Webtoon)
      if (Math.abs(aYCenter - bYCenter) > 10) {
        return aYCenter - bYCenter;
      }
      return aXCenter - bXCenter;
    }
  });

  // Gán lại order_index tuần tự
  return sorted.map((layer, idx) => ({
    ...layer,
    order_index: idx + 1,
  }));
}

/**
 * Đóng gói phản hồi chuẩn MangaPageResponse v2.0 có tương thích ngược hoàn hảo với frontend v1.
 */
function formatMangaPageResponse({
  pageId = "page_001",
  sha256 = "",
  width = 1200,
  height = 1800,
  readingDirection = "rtl",
  timings = {},
  stats = {},
  cleanedImageBase64 = null,
  colorMaskBase64 = null,
  cleanImageUrl = null,
  maskImageUrl = null,
  originalImageUrl = null,
  layers = [],
}) {
  const sortedLayers = sortReadingOrder(layers, readingDirection, height);

  // Chuẩn hóa backward compatibility cho v1
  const legacyBubbles = sortedLayers.map((l) => ({
    id: l.id,
    box_2d: l.box_2d,
    text_original: l.content.original_text || "",
    text_translated: l.content.translated_text || "",
    type: l.type,
    is_pure_white_bg: l.geometry.is_pure_white_bg || false,
    confidence: l.content.confidence || 1.0,
  }));

  return {
    version: "2.0.0",
    status: "success",
    success: true, // Legacy flag
    meta: {
      page_id: pageId,
      sha256,
      dimensions: {
        width,
        height,
        aspect_ratio: width > 0 ? Number((width / height).toFixed(3)) : 1,
      },
      reading_direction: readingDirection,
      timings_ms: timings,
      stats,
    },
    assets: {
      cleanedImageBase64,
      colorMaskBase64,
      clean_image_url: cleanImageUrl,
      mask_image_url: maskImageUrl,
      original_image_url: originalImageUrl,
    },
    // Standard V2 Layered Format
    layers: sortedLayers,
    // V1 Backward Compatibility Aliases:
    cleanedImageBase64,
    colorMaskBase64,
    bubbles: legacyBubbles,
    ocr_lines: sortedLayers.map((l) => l.content.original_text).filter(Boolean),
    vi_lines: sortedLayers.map((l) => l.content.translated_text).filter(Boolean),
  };
}

module.exports = {
  toNormalizedBox,
  toPixelBounds,
  sortReadingOrder,
  formatMangaPageResponse,
};
