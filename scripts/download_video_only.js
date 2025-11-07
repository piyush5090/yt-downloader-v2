import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "../config/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

function download_video_only(url, relativePath, resolution) {
  if (!url) {
    console.error("❌ Error: URL is required.");
    return;
  }
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
  const outputTemplate = path.join(relativePath, "%(title)s.%(ext)s");

  const args = [
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "-o", outputTemplate,
    url,
  ];

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

    // Detect progress (like "12.3%")
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      progressActive = true;
      const pct = parseFloat(m[1]);
      renderProgressBar(pct);
      return;
    }

    // Filter: hide unnecessary noise (only show minimal info)
    // Skip lines that are warnings, extracting, downloading metadata, etc.
    if (
      /\b(Extracting|Downloading|WARNING|Signature|tv client|player|m3u8|info|cookies)\b/i.test(text)
    ) return;

    // Show destination message once
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
  "1440p"
);
