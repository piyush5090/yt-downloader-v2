#!/usr/bin/env node

/**
 * YouTube Video Downloader (Video Only)
 * -------------------------------------
 * - Downloads video (no thumbnail)
 * - Saves metadata.json (full dump)
 * - Extracts imp_data.json (keeps full description)
 * - Deletes metadata.json and any yt-dlp *.info.json files afterward
 * - Retries and progress feedback
 * - Handles invalid Windows filenames safely
 */

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
function sanitizeName(name) {
  return name
    .normalize("NFKD")          // split accents
    .replace(/[^\x00-\x7F]/g, "") // remove non-ASCII
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") 
    .replace(/\s+/g, " ")
    .trim();
}

function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

// ---- Fetch basic info ----
function getVideoInfo(url) {
  try {
    const output = execSync(`yt-dlp --skip-download --print-json "${url}"`, {
      encoding: "utf8",
    });
    return JSON.parse(output);
  } catch (err) {
    console.error("❌ Failed to fetch video info.");
    return null;
  }
}

// ---- Save metadata.json ----
function saveMetadata(folderPath, metadata) {
  const filePath = path.join(folderPath, "metadata.json");
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), "utf8");
}

// ---- Extract imp_data.json (and delete metadata.json + *.info.json) ----
function extractImportantMetadata(folderPath) {
  const metaPath = path.join(folderPath, "metadata.json");
  const impPath = path.join(folderPath, "imp_data.json");

  if (!fs.existsSync(metaPath)) return;

  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));

    const important = {
      id: metadata.id,
      title: metadata.title,
      description: metadata.description,
      channel: metadata.channel,
      channel_id: metadata.channel_id,
      uploader: metadata.uploader,
      upload_date: metadata.upload_date,
      duration: metadata.duration,
      view_count: metadata.view_count,
      like_count: metadata.like_count,
      categories: metadata.categories,
      tags: metadata.tags,
      webpage_url: metadata.webpage_url,
    };

    fs.writeFileSync(impPath, JSON.stringify(important, null, 2), "utf8");
    console.log("✨ imp_data.json created successfully!");

    // Delete metadata.json
    try {
      fs.unlinkSync(metaPath);
      console.log("🧹 metadata.json deleted.");
    } catch (e) {
      console.warn("⚠️ Could not delete metadata.json:", e.message);
    }

    // Also remove any yt-dlp generated .info.json files
    try {
      const files = fs.readdirSync(folderPath);
      const infoFiles = files.filter((f) => f.endsWith(".info.json"));
      for (const f of infoFiles) {
        try {
          fs.unlinkSync(path.join(folderPath, f));
          console.log(`🧹 ${f} deleted.`);
        } catch (e) {
          console.warn(`⚠️ Could not delete ${f}:`, e.message);
        }
      }
    } catch (e) {
      console.warn("⚠️ Failed to scan folder for .info.json files:", e.message);
    }
  } catch (err) {
    console.error("❌ Failed to extract important metadata:", err.message);
  }
}

// ---- Core download (video only) ----
function downloadVideoOnly(url, folderPath, resolution) {
  const userH = parseResolutionValue(resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  let formatSelector;
  if (height) {
    formatSelector = `bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height<=${height}]+bestaudio/best`;
  } else {
    formatSelector = "bestvideo+bestaudio/best";
  }

  return new Promise((resolve) => {
    const outputTemplate = path.join(folderPath, "%(title).70s.%(ext)s"); // shorter safe name
    const args = [
      "--windows-filenames",
      "-f",
      formatSelector,
      "--merge-output-format",
      "mp4",
      "--cookies-from-browser",
      config.defaultBrowser,
      "--write-info-json",
      "--no-warnings",
      "-o",
      outputTemplate,
      url,
    ];

    const yt = spawn("yt-dlp", args);
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinnerIndex = 0;
    let progressActive = false;
    let stderrData = "";

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
        process.stdout.write(
          spinnerFrames[(spinnerIndex = ++spinnerIndex % spinnerFrames.length)] +
            " Preparing download..."
        );
      }
    }, 100);

    const handleData = (chunk) => {
      const text = chunk.toString();
      const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) {
        progressActive = true;
        renderProgressBar(parseFloat(m[1]));
      }
    };

    yt.stdout.on("data", handleData);
    yt.stderr.on("data", (chunk) => {
      handleData(chunk);
      stderrData += chunk.toString();
    });

    yt.on("close", (code) => {
      clearInterval(spinner);
      readline.cursorTo(process.stdout, 0);
      if (code === 0) {
        console.log("\n✅ Download complete!");
        resolve(true);
      } else {
        console.error("\n❌ Download failed.");
        if (stderrData.trim()) {
          console.error("\n🔍 Full yt-dlp error log:\n" + stderrData.trim());
        }
        resolve(false);
      }
    });

    yt.on("error", (err) => {
      clearInterval(spinner);
      console.error("\n❌ yt-dlp failed to start:", err.message);
      resolve(false);
    });
  });
}

// ---- Wrapper: folder setup + retry logic ----
async function download_video_and_metadata(url, relativePath, resolution) {
  const info = getVideoInfo(url);
  if (!info) return;

  const safeTitle = sanitizeName(info.title);
  const videoFolder = path.join(relativePath, `${safeTitle}_${info.id}`);
  fs.mkdirSync(videoFolder, { recursive: true });

  console.log(`📁 ${safeTitle}_${info.id}`);

  saveMetadata(videoFolder, info);

  let success = false;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    success = await downloadVideoOnly(url, videoFolder, resolution);
    if (success) break;
    if (attempt < config.maxRetries) {
      console.log(`⏳ Retry in ${config.retryDelay / 1000}s...`);
      await sleep(config.retryDelay);
    }
  }

  if (success) extractImportantMetadata(videoFolder);
  else console.error("❌ All attempts failed.\n");
}

// ---- Example usage ----
(async () => {
  await download_video_and_metadata(
    "https://www.youtube.com/watch?v=CohCbBfgO0o",
    "./downloads",
    "144p"
  );
})();
