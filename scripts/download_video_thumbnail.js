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

// ---- Fetch basic info ----
function getVideoInfo(url) {
  try {
    const output = execSync(`yt-dlp --skip-download --print-json "${url}"`, { encoding: "utf8" });
    const info = JSON.parse(output);
    return { title: info.title || "unknown_title", id: info.id || "noid" };
  } catch {
    console.error("❌ Failed to fetch video info.");
    return null;
  }
}

// ---- Core download function ----
function download_video_thumbnail(url, relativePath, resolution) {
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
    "--no-warnings",
    "-o", outputTemplate,
    url,
  ];

  return new Promise((resolve) => {
    const yt = spawn("yt-dlp", args);
    const spinnerFrames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    let spinnerIndex = 0;
    let progressActive = false;

    const renderProgressBar = (percent) => {
      const barLength = 30;
      const filled = Math.round((percent / 100) * barLength);
      const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`📦 [${bar}] ${percent.toFixed(1)}%`);
    };

    const spinner = setInterval(() => {
      if (!progressActive) {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(spinnerFrames[(spinnerIndex = ++spinnerIndex % spinnerFrames.length)] + " Preparing download...");
      }
    }, 100);

    const handleData = (chunk) => {
      const text = chunk.toString();
      const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) {
        progressActive = true;
        renderProgressBar(parseFloat(m[1]));
      }
      // Hide all verbose lines like warnings, cookies, metadata, etc.
      // Only show final progress info.
    };

    yt.stdout.on("data", handleData);
    yt.stderr.on("data", handleData);

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
    success = await download_video_thumbnail(url, videoFolder, resolution);
    if (success) break;
    if (attempt < config.maxRetries) {
      console.log(`⏳ Retry in ${config.retryDelay / 1000}s...`);
      await sleep(config.retryDelay);
    }
  }

  if (!success) console.error("❌ All attempts failed.\n");
}

// ---- Example Usage ----
(async () => {
  await downloadWithFolderAndRetry(
    "https://www.youtube.com/watch?v=zoq0_HSfXZ8",
    "./downloads",
    "720p"
  );
})();
