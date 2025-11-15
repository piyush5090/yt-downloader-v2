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

// ✅ Uniform, stronger sanitization (same as first script)
function sanitizeName(name) {
  return name
    .normalize("NFKD")          // split accents
    .replace(/[^\x00-\x7F]/g, "") // remove non-ASCII
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") 
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Fetch basic info ----
function getVideoInfo(url) {
  try {
    const output = execSync(`yt-dlp --skip-download --print-json "${url}"`, {
      encoding: "utf8",
    });
    const info = JSON.parse(output);
    const title = sanitizeName(info.title || "unknown_title");
    const id = sanitizeName(info.id || "noid");
    return { title, id };
  } catch {
    console.error("❌ Failed to fetch video info.");
    return null;
  }
}

// ---- Core download function ----
function download_video_sub(url, relativePath, resolution) {
  if (!url) return Promise.resolve(false);
  if (!fs.existsSync(relativePath)) fs.mkdirSync(relativePath, { recursive: true });

  const userH = parseResolutionValue(resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  let formatSelector;
  if (height) {
    formatSelector = `bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height<=${height}]+bestaudio/best`;
  } else {
    formatSelector = "bestvideo+bestaudio/best";
  }

  const browser = config.defaultBrowser || "chrome";

  // ✅ Use safe, sanitized output template
  const outputTemplate = path.join(relativePath, "%(title).70s.%(ext)s");

  const args = [
    "--windows-filenames",
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*",
    "--embed-subs",
    "--no-warnings",
    "-o", outputTemplate,
    url,
  ];

  return new Promise((resolve) => {
    const yt = spawn("yt-dlp", args);
    const spinnerFrames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
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

        const subFiles = fs.readdirSync(relativePath).filter(f =>
          f.endsWith(".vtt") || f.endsWith(".srt") || f.endsWith(".ass")
        );

        if (subFiles.length > 0) {
          console.log("🎬 Subtitles downloaded successfully!");
        } else {
          console.log("⚠️ No subtitles found for this video.");
        }

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

// ---- Wrapper with folder + retry logic ----
async function download_vid_and_subtitle(url, relativePath, resolution) {
  const info = getVideoInfo(url);
  if (!info) return;

  const safeTitle = sanitizeName(info.title);
  const videoFolder = path.join(relativePath, `${safeTitle}_${info.id}`);
  fs.mkdirSync(videoFolder, { recursive: true });

  console.log(`📁 ${safeTitle}_${info.id}`);

  let success = false;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    success = await download_video_sub(url, videoFolder, resolution);
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
  await download_vid_and_subtitle(
    "https://www.youtube.com/watch?v=CohCbBfgO0o",
    "./downloads",
    "144p"
  );
})();
