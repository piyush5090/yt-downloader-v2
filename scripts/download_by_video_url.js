#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { download, getVideoInfo, sanitizeName, sleep, config } from "./downloader.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function getDownloadChoice() {
  console.log(`
What do you want to download?
  1. Video only
  2. Video and Thumbnail
  3. Video and Metadata
  4. Video and Subtitles
  5. Video, Thumbnail, and Metadata
  6. Video, Thumbnail, and Subtitles
  7. Video, Thumbnail, Subtitles, and Metadata (All)
`);
  const choice = await question("Enter your choice (1-7): ");
  const resolution = await question("Enter video resolution (e.g., 1080p, 720p) or press Enter for default: ");
  return { choice, resolution };
}

async function processVideos(videoUrls, choice, resolution) {

  const downloadOptions = {
    resolution: resolution || config.defaultResolution,
    thumbnail: ['2', '5', '6', '7'].includes(choice),
    metadata: ['3', '5', '7'].includes(choice),
    subtitles: ['4', '6', '7'].includes(choice),
  };

  const baseFolder = path.join("./downloads/by_video_url");
  fs.mkdirSync(baseFolder, { recursive: true });
  console.log(`\n📁 Base download folder: ${baseFolder}`);

  let videoCount = 0;
  for (const videoUrl of videoUrls) {
    videoCount++;
    console.log(`\n--- Downloading video ${videoCount} of ${videoUrls.length} ---`);
    
    const videoInfo = getVideoInfo(videoUrl);
    if (!videoInfo) {
        console.log(`Skipping video, failed to get info.`);
        continue;
    }

    const safeTitle = sanitizeName(videoInfo.title);
    const videoFolder = path.join(baseFolder, `${safeTitle}_${videoInfo.id}`);
    fs.mkdirSync(videoFolder, { recursive: true });

    let success = false;
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        success = await download(videoUrl, videoFolder,videoInfo.id, downloadOptions);
        if (success) break;
        if (attempt < config.maxRetries) {
            console.log(`⏳ Retry in ${config.retryDelay / 1000}s...`);
            await sleep(config.retryDelay);
        }
    }

    if (!success) {
        console.error(`❌ All attempts failed for ${videoUrl}.\n`);
    }
    
    if (videoCount < videoUrls.length) {
        console.log(`\n⏳ Sleeping for 20 seconds before next video...`);
        await sleep(20000);
    }
  }
}

(async () => {
  const videoUrlsArg = process.argv[2];
  if (!videoUrlsArg) {
    console.log("Usage: node scripts/download_by_video_url.js <video_url1,video_url2,רוי>");
    rl.close();
    return;
  }

  const videoUrls = videoUrlsArg.split(',');

  const { choice, resolution } = await getDownloadChoice();

  await processVideos(videoUrls, choice, resolution);

  console.log("\n\n🎉 All videos processed!");
  rl.close();
})();
