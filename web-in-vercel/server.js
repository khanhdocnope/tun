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

// Serverless API handlers (Clean Core)
const healthHandler = require("./api/health");
const cleanHandler = require("./api/clean");
const aiVisionHandler = require("./api/ai-vision");
const configHandler = require("./api/config");
const downloadScriptHandler = require("./api/download-script");
const proxyImageHandler = require("./api/proxy-image");

app.all("/api/health", (req, res) => healthHandler(req, res));
app.all("/api/clean", (req, res) => cleanHandler(req, res));
app.all("/api/ai-vision", (req, res) => aiVisionHandler(req, res));
app.all("/api/process-batch", (req, res) => aiVisionHandler(req, res)); // Alias backwards compatibility
app.all("/api/config", (req, res) => configHandler(req, res));
app.all("/api/download-script", (req, res) => downloadScriptHandler(req, res));
app.all("/api/proxy-image", (req, res) => proxyImageHandler(req, res));

// Trang chủ phục vụ public/index.html (Manga Studio với 3 Tabs chính)
app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Batch Studio Direct Link
app.get(["/batch-studio", "/batch-studio/", "/batch-studio.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "batch-studio", "index.html"));
});

// Bookmarklet Extractor Direct Link
app.get(["/bookmarklet", "/bookmarklet/", "/bookmarklet/index.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "bookmarklet", "index.html"));
});

// Phục vụ tĩnh độc quyền từ public/ (chuẩn Vercel)
app.use(express.static(path.join(__dirname, "public")));

// Fallback to index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Manga Translation & Typeset Studio đang chạy!`);
  console.log(`📡 Trang chủ: http://localhost:${PORT}`);
  console.log(`📚 Batch Studio: http://localhost:${PORT}/batch-studio`);
  console.log(`☁️  Backend API: ${process.env.BACKEND_URL || "https://dobietdc-manga-text-cleaner.hf.space"}`);
  console.log(`=================================================\n`);
});
