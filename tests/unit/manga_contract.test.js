const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  toNormalizedBox,
  toPixelBounds,
  sortReadingOrder,
  formatMangaPageResponse,
} = require(path.join(__dirname, "../../web-in-vercel/api/manga-contract.js"));

test("toNormalizedBox: accurately maps pixel bounds to 0..1000 scale", () => {
  const width = 1000;
  const height = 2000;

  // Box from (100, 200) to (300, 600)
  const norm = toNormalizedBox([100, 200, 300, 600], width, height);
  // ymin: 200 / 2000 * 1000 = 100
  // xmin: 100 / 1000 * 1000 = 100
  // ymax: 600 / 2000 * 1000 = 300
  // xmax: 300 / 1000 * 1000 = 300
  assert.deepEqual(norm, [100, 100, 300, 300]);
});

test("toPixelBounds: converts normalized 0..1000 box back to pixel rectangle", () => {
  const width = 800;
  const height = 1200;

  const box2d = [100, 250, 400, 750]; // [ymin, xmin, ymax, xmax]
  const pb = toPixelBounds(box2d, width, height);

  assert.equal(pb.x, 200);      // 250/1000 * 800
  assert.equal(pb.y, 120);      // 100/1000 * 1200
  assert.equal(pb.width, 400);  // (750 - 250)/1000 * 800
  assert.equal(pb.height, 360); // (400 - 100)/1000 * 1200
});

test("sortReadingOrder: manga (rtl) prioritizes right-to-left within same vertical band", () => {
  const layers = [
    {
      id: "left_bubble",
      box_2d: [100, 100, 200, 300], // Top-left (xmin=100, xmax=300)
    },
    {
      id: "right_bubble",
      box_2d: [100, 700, 200, 900], // Top-right (xmin=700, xmax=900)
    },
    {
      id: "bottom_bubble",
      box_2d: [800, 200, 900, 400], // Bottom
    },
  ];

  const sorted = sortReadingOrder(layers, "rtl", 1000);

  // In Manga (RTL), top-right bubble must be read FIRST
  assert.equal(sorted[0].id, "right_bubble");
  assert.equal(sorted[0].order_index, 1);

  // Then top-left bubble
  assert.equal(sorted[1].id, "left_bubble");
  assert.equal(sorted[1].order_index, 2);

  // Finally bottom bubble
  assert.equal(sorted[2].id, "bottom_bubble");
  assert.equal(sorted[2].order_index, 3);
});

test("sortReadingOrder: webtoon (ttb) strictly prioritizes top-to-bottom", () => {
  const layers = [
    {
      id: "bottom_bubble",
      box_2d: [700, 100, 800, 400],
    },
    {
      id: "top_bubble",
      box_2d: [50, 600, 150, 900],
    },
    {
      id: "middle_bubble",
      box_2d: [350, 200, 450, 500],
    },
  ];

  const sorted = sortReadingOrder(layers, "ttb", 1000);

  assert.equal(sorted[0].id, "top_bubble");
  assert.equal(sorted[1].id, "middle_bubble");
  assert.equal(sorted[2].id, "bottom_bubble");
});

test("formatMangaPageResponse: packages V2 layered schema with complete backward compatibility", () => {
  const res = formatMangaPageResponse({
    pageId: "page_042",
    width: 1000,
    height: 1500,
    readingDirection: "rtl",
    cleanedImageBase64: "data:image/png;base64,mockClean",
    colorMaskBase64: "data:image/png;base64,mockMask",
    layers: [
      {
        id: "b1",
        type: "speech_bubble",
        box_2d: [100, 600, 250, 900],
        geometry: { is_pure_white_bg: true },
        typography: { orientation: "vertical" },
        content: {
          original_text: "待て！",
          translated_text: "Đứng lại!",
        },
      },
    ],
  });

  // Check V2 Standard fields
  assert.equal(res.version, "2.0.0");
  assert.equal(res.status, "success");
  assert.equal(res.meta.page_id, "page_042");
  assert.equal(res.meta.dimensions.aspect_ratio, 0.667);
  assert.equal(res.layers.length, 1);
  assert.equal(res.layers[0].order_index, 1);
  assert.equal(res.layers[0].content.translated_text, "Đứng lại!");

  // Check V1 Backward compatibility aliases
  assert.equal(res.success, true);
  assert.equal(res.cleanedImageBase64, "data:image/png;base64,mockClean");
  assert.equal(res.colorMaskBase64, "data:image/png;base64,mockMask");
  assert.equal(res.bubbles.length, 1);
  assert.equal(res.bubbles[0].text_translated, "Đứng lại!");
  assert.deepEqual(res.vi_lines, ["Đứng lại!"]);
});
