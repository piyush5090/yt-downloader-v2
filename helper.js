import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

/**
 * Parse resolution strings like "720p" or "720" -> returns number (720) or null
 */
function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

/**
 * New download function that constructs safer format selectors.
 */
function download_video_only(url, relativePath, resolution) {
  if (!url) {
    console.error("❌ Error: URL is required.");
    return;
  }
  if (!fs.existsSync(relativePath)) fs.mkdirSync(relativePath, { recursive: true });

  // resolve resolution number (fallback to config)
  const userH = parseResolutionValue(resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  // build a robust -f selector:
  // 1) prefer exact match: bestvideo[height=HEIGHT]+bestaudio/best[height=HEIGHT]
  // 2) fallback to <=HEIGHT
  // 3) final fallback to bestvideo+bestaudio/best
  let formatSelector;
  if (height) {
    // try exact, then <=, then best
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

  // spawn yt-dlp
  const yt = spawn("yt-dlp", args);

  // progress UI
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

  // yt-dlp prints progress either to stdout or stderr depending on platform/version.
  // Listen to both; prefer parsing percentages from any stream.
  const handleData = (chunk) => {
    const text = chunk.toString();
    // common progress patterns include "xx.x%" or "[download] 12.3%" etc.
    const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      progressActive = true;
      const pct = parseFloat(m[1]);
      renderProgressBar(pct);
    } else {
      // optionally show other useful lines (like "Destination: ..." or format selection)
      const trimmed = text.trim();
      if (trimmed) {
        // move cursor to newline and print a short message, then re-render progress (if any)
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (!progressActive) {
          process.stdout.write(trimmed + "\n");
        } else {
          // keep progress bar visible
          renderProgressBar(0); // no-op to keep bar visible
        }
      }
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
      console.error("ℹ️ Check the earlier yt-dlp messages above for details (cookie access, video restrictions, etc.)");
    }
  });

  yt.on("error", (err) => {
    clearInterval(spinner);
    console.error("\n❌ Failed to start yt-dlp:", err.message);
  });
}

// Example quick-run
download_video_only(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "./videos",
  ""
);

// export { download_video_only };
