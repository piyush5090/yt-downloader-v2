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
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseResolutionValue(res) {
  if (!res) return null;
  const m = String(res).trim().match(/^(\d+)\s*p?$/i);
  return m ? Number(m[1]) : null;
}

export function sanitizeName(name) {
  return name
    .normalize("NFKD")          // split accents
    .replace(/[^\x00-\x7F]/g, "") // remove non-ASCII
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") 
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Fetch video info ----
export function getVideoInfo(url) {
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

// ---- Save Metadata ----
export function saveMetadata(url, folderPath) {
  try {
    const metadata = execSync(`yt-dlp --dump-json "${url}"`, { encoding: "utf8" });
    fs.writeFileSync(path.join(folderPath, "metadata.json"), metadata, "utf8");
    console.log("🧾 Metadata saved!");
  } catch (err) {
    console.error("⚠️ Failed to fetch metadata:", err.message);
  }
}

// ---- Extract Important Metadata ----
export function extractImportantMetadata(folderPath) {
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

/**
 * The main download function.
 * @param {string} url - The video URL.
 * @param {string} outputPath - The folder to save the files in.
 * @param {object} options - Download options.
 * @param {string} [options.resolution] - e.g., "1080p"
 * @param {boolean} [options.thumbnail=false] - Download thumbnail?
 * @param {boolean} [options.subtitles=false] - Download subtitles?
 * @param {boolean} [options.metadata=false] - Download metadata?
 */
export async function download(url, outputPath, options = {}) {
  if (!url) return false;
  if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });

  const userH = parseResolutionValue(options.resolution);
  const defaultH = parseResolutionValue(config.defaultResolution);
  const height = userH || defaultH || null;

  const formatSelector = height
    ? `bestvideo[height=${height}]+bestaudio/best[height=${height}]/bestvideo[height<=${height}]+bestaudio/best/best`
    : "bestvideo+bestaudio/best";

  const browser = config.defaultBrowser || "chrome";
  const outputTemplate = path.join(outputPath, "% (title)s.%(ext)s");

  const args = [
    "-f", formatSelector,
    "--merge-output-format", "mp4",
    "--cookies-from-browser", browser,
    "--no-warnings",
    "--progress",
    "-o", outputTemplate,
    url,
  ];

  if (options.thumbnail) {
    args.push("--write-thumbnail", "--convert-thumbnails", "jpg");
  }
  if (options.subtitles) {
    args.push("--write-subs", "--write-auto-subs", "--sub-langs", "en.*", "--embed-subs");
  }

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
        if (options.metadata) {
          saveMetadata(url, outputPath);
          extractImportantMetadata(outputPath);
        }
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

export { config }; // Export config for potential external use
