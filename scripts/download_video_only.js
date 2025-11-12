import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Helper: parse resolution like "720p" -> 720
function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

// Helper: sanitize folder name (remove invalid characters)
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
}

// NEW: fetch title and ID using yt-dlp
function getVideoMetadata(url) {
  try {
    const title = execSync(`yt-dlp --get-title ${url}`, { encoding: "utf8" }).trim();
    const id = execSync(`yt-dlp --get-id ${url}`, { encoding: "utf8" }).trim();
    return { title, id };
  } catch (err) {
    console.error("❌ Failed to fetch video metadata:", err.message);
    return null;
  }
}

function download_video_only(url, basePath, resolution) {
  if (!url) {
    console.error("❌ Error: URL is required.");
    return;
  }

  // Fetch metadata before downloading
  const meta = getVideoMetadata(url);
  if (!meta) return;

  // Build folder structure
  const folderName = sanitizeFileName(`${meta.title}_${meta.id}`);
  const relativePath = path.join(basePath, folderName);

  if (!fs.existsSync(relativePath)) fs.mkdirSync(relativePath, { recursive: true });

  console.log(`📂 Created folder: ${relativePath}`);

  // Same resolution logic as before
  const userH = parseResolutionValue(resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  // Format selection (unchanged)
  let formatSelector;
  if (height) {
    formatSelector = `bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height<=${height}]+bestaudio/best`;
  } else {
    formatSelector = "bestvideo+bestaudio/best";
  }

  const browser = config.defaultBrowser || "chrome";
  const outputTemplate = path.join(relativePath, "%(title)s.%(ext)s");

  const args = [
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "-o", outputTemplate,
    url,
  ];

  const yt = spawn("yt-dlp", args);

  // Spinner + progress bar (same as before)
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
      const pct = parseFloat(m[1]);
      renderProgressBar(pct);
      return;
    }

    if (/\b(Extracting|Downloading|WARNING|Signature|tv client|player|m3u8|info|cookies)\b/i.test(text)) return;

    if (/Destination/i.test(text)) {
      console.log("\n🎯 " + text.trim());
    }
  };

  yt.stdout.on("data", handleData);
  yt.stderr.on("data", handleData);

  yt.on("close", (code) => {
    clearInterval(spinner);
    readline.cursorTo(process.stdout, 0);
    if (code === 0) {
      console.log("\n✅ Download complete!");
    } else {
      console.error(`\n❌ yt-dlp exited with code ${code}`);
    }
  });

  yt.on("error", (err) => {
    clearInterval(spinner);
    console.error("\n❌ Failed to start yt-dlp:", err.message);
  });
}

// Example run
download_video_only(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "./downloads",
  "144p"
);
