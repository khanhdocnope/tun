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

// Serverless API handlers
const healthHandler = require("./api/health");
const cleanHandler = require("./api/clean");
const ocrHandler = require("./api/ocr");
const batchZipHandler = require("./api/batch-zip");
const translateHandler = require("./api/translate");
const visionHandler = require("./api/vision");

app.all("/api/health", (req, res) => healthHandler(req, res));
app.all("/api/clean", (req, res) => cleanHandler(req, res));
app.all("/api/ocr", (req, res) => ocrHandler(req, res));
app.all("/api/batch-zip", (req, res) => batchZipHandler(req, res));
app.all("/api/translate", (req, res) => translateHandler(req, res));
app.all("/api/vision", (req, res) => visionHandler(req, res));

// Serve static frontend files
app.use(express.static(__dirname));

// Fallback to index.html for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 Manga Studio Node.js Server đang chạy!`);
  console.log(`📡 URL cục bộ: http://localhost:${PORT}`);
  console.log(`☁️  Backend API: ${process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space"}`);
  console.log(`=================================================\n`);
});
