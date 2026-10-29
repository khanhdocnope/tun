require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "60mb" }));
app.use(express.urlencoded({ extended: true, limit: "60mb" }));

// Serverless API handlers (Core Manga Studio)
const healthHandler = require("./api/health");
const cleanHandler = require("./api/clean");
const ocrHandler = require("./api/ocr");
const batchZipHandler = require("./api/batch-zip");
const translateHandler = require("./api/translate");
const visionHandler = require("./api/vision");
const detectBoxesHandler = require("./api/detect-boxes");

// Serverless API handlers (Batch Studio Pro Sub-Web)
const configHandler = require("./api/config");
const processBatchHandler = require("./api/process-batch");
const translateTextHandler = require("./api/translate-text");
const downloadScriptHandler = require("./api/download-script");

app.all("/api/health", (req, res) => healthHandler(req, res));
app.all("/api/clean", (req, res) => cleanHandler(req, res));
app.all("/api/ocr", (req, res) => ocrHandler(req, res));
app.all("/api/detect-boxes", (req, res) => detectBoxesHandler(req, res));
app.all("/api/batch-zip", (req, res) => batchZipHandler(req, res));
app.all("/api/translate", (req, res) => translateHandler(req, res));
app.all("/api/vision", (req, res) => visionHandler(req, res));

// Batch Studio Pro routes
app.all("/api/config", (req, res) => configHandler(req, res));
app.all("/api/process-batch", (req, res) => processBatchHandler(req, res));
app.all("/api/translate-text", (req, res) => translateTextHandler(req, res));
app.all("/api/download-script", (req, res) => downloadScriptHandler(req, res));

// Batch Studio Pro route (hỗ trợ trang chủ /, /batch-studio, và alias .html)
app.get(["/", "/batch-studio", "/batch-studio/", "/batch-studio.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "batch-studio", "index.html"));
});

// Phục vụ tĩnh độc quyền từ public/ (chuẩn Vercel)
app.use(express.static(path.join(__dirname, "public")));

// Fallback to Batch Studio
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "batch-studio", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Batch Studio Pro Node.js Server đang chạy!`);
  console.log(`📡 Trang chủ (Batch Studio): http://localhost:${PORT}`);
  console.log(`📚 Đường dẫn trực tiếp: http://localhost:${PORT}/batch-studio`);
  console.log(`☁️  Backend API: ${process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space"}`);
  console.log(`=================================================\n`);
});
