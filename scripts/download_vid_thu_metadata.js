#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "../config/config.json");

// ---- CONFIG ----
let config = {
  defaultResolution: "720",
  defaultBrowser: "chrome",
  maxRetries: 3,
  retryDelay: 5000,
};
if (fs.existsSync(configPath)) {
  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config = { ...config, ...userConfig };
  } catch {
    console.warn("⚠️ Could not read config.json, using defaults.");
  }
}

// ---- HELPERS ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 _-]/g, "_").trim();
}

// ---- Fetch video info ----
function getVideoInfo(url) {
  try {
    const output = execSync(`yt-dlp --skip-download --print-json "${url}"`, {
      encoding: "utf8",
    });
    const info = JSON.parse(output);
    return { title: info.title || "unknown_title", id: info.id || "noid" };
  } catch {
    console.error("❌ Failed to fetch video info.");
    return null;
  }
}

// ---- Download video + thumbnail ----
function download_video_and_thumbnail(url, relativePath, resolution) {
  if (!url) return Promise.resolve(false);
  if (!fs.existsSync(relativePath)) fs.mkdirSync(relativePath, { recursive: true });

  const userH = parseResolutionValue(resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  const formatSelector = height
    ? `bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height<=${height}]+bestaudio/best/best`
    : "bestvideo+bestaudio/best";

  const browser = config.defaultBrowser || "chrome";
  const outputTemplate = path.join(relativePath, "%(title)s.%(ext)s");

  const args = [
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "--write-thumbnail",
    "--convert-thumbnails", "jpg",
    "--progress",
    "-o", outputTemplate,
    url,
  ];

  return new Promise((resolve) => {
    const yt = spawn("yt-dlp", args);
    const spinnerFrames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    let spinnerIndex = 0;
    let lastUpdate = Date.now();

    const renderProgressBar = (percent) => {
      const barLength = 30;
      const filled = Math.round((percent / 100) * barLength);
      const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`📦 [${bar}] ${percent.toFixed(1)}%`);
    };

    const spinner = setInterval(() => {
      const now = Date.now();
      if (now - lastUpdate > 800) {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(spinnerFrames[(spinnerIndex = ++spinnerIndex % spinnerFrames.length)] + " Preparing download...");
      }
    }, 100);

    yt.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) {
        lastUpdate = Date.now();
        renderProgressBar(parseFloat(m[1]));
      }
    });

    yt.stderr.on("data", () => {}); // ignore stderr warnings

    yt.on("close", (code) => {
      clearInterval(spinner);
      readline.cursorTo(process.stdout, 0);
      if (code === 0) {
        console.log("\n✅ Download complete!");
        resolve(true);
      } else {
        console.error("\n❌ Download failed.");
        resolve(false);
      }
    });

    yt.on("error", () => {
      clearInterval(spinner);
      console.error("\n❌ yt-dlp failed to start.");
      resolve(false);
    });
  });
}

// ---- Save Metadata ----
function saveMetadata(url, folderPath) {
  try {
    const metadata = execSync(`yt-dlp --dump-json "${url}"`, { encoding: "utf8" });
    fs.writeFileSync(path.join(folderPath, "metadata.json"), metadata, "utf8");
    console.log("🧾 Metadata saved!");
  } catch (err) {
    console.error("⚠️ Failed to fetch metadata:", err.message);
  }
}

// ---- Extract Important Metadata ----
function extractImportantMetadata(folderPath) {
  const metaFile = path.join(folderPath, "metadata.json");
  const impFile = path.join(folderPath, "imp_data.json");

  if (!fs.existsSync(metaFile)) return console.warn("⚠️ No metadata.json found to process.");

  try {
    const raw = fs.readFileSync(metaFile, "utf8");
    const data = JSON.parse(raw);

    const important = {
      id: data.id,
      title: data.title,
      description: data.description, // keep full text
      channel: data.channel,
      channel_id: data.channel_id,
      uploader: data.uploader,
      upload_date: data.upload_date,
      duration: data.duration,
      view_count: data.view_count,
      like_count: data.like_count,
      categories: data.categories,
      tags: data.tags,
    };

    fs.writeFileSync(impFile, JSON.stringify(important, null, 2), "utf8");
    console.log("✨ imp_data.json created successfully!");

    // Delete metadata.json after success
    fs.unlinkSync(metaFile);
    console.log("🧹 metadata.json deleted.");
  } catch (err) {
    console.error("❌ Failed to extract important metadata:", err.message);
  }
}

// ---- Wrapper with folder + retry logic ----
async function downloadWithFolderAndRetry(url, relativePath, resolution) {
  const info = getVideoInfo(url);
  if (!info) return;

  const safeTitle = sanitizeName(info.title);
  const videoFolder = path.join(relativePath, `${safeTitle}_${info.id}`);
  fs.mkdirSync(videoFolder, { recursive: true });

  console.log(`📁 ${safeTitle}_${info.id}`);

  let success = false;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    success = await download_video_and_thumbnail(url, videoFolder, resolution);
    if (success) break;
    if (attempt < config.maxRetries) {
      console.log(`⏳ Retry in ${config.retryDelay / 1000}s...`);
      await sleep(config.retryDelay);
    }
  }

  if (success) {
    saveMetadata(url, videoFolder);
    extractImportantMetadata(videoFolder);
  } else {
    console.error("❌ All attempts failed.\n");
  }
}

// ---- Example Usage ----
(async () => {
  await downloadWithFolderAndRetry(
    "https://www.youtube.com/watch?v=qN4ttFbUM4k",
    "./downloads",
    "144p"
  );
})();
