#!/usr/bin/env node
import readline from "readline";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const scriptMap = {
  "1": "scripts/download_by_video_url.js",
  "2": "scripts/download_by_playlist.js",
  "3": "scripts/download_by_channel.js",
};

async function main() {
  console.log(`
How do you want to perform the download?
  1. By video URL(s)
  2. By playlist URL(s)
  3. By channel URL(s)
`);

  const choice = await question("Enter your choice (1-3): ");

  const scriptPath = scriptMap[choice.trim()];

  if (!scriptPath) {
    console.error("❌ Invalid choice. Please run the script again and select 1, 2, or 3.");
    rl.close();
    return;
  }

  const urls = await question("Enter the URL(s) (comma-separated for multiple): ");

  if (!urls || urls.trim() === "") {
    console.error("❌ No URLs provided. Please run the script again and enter at least one URL.");
    rl.close();
    return;
  }

  rl.close(); // Close the readline interface so the child process can take over

  const child = spawn("node", [path.join(__dirname, scriptPath), urls], {
    stdio: "inherit", // This is key to allow the child script to be interactive
  });

  child.on("close", (code) => {
    console.log(`\nChild process exited with code ${code}.`);
  });

  child.on("error", (err) => {
    console.error("Failed to start child process.", err);
  });
}

main();
