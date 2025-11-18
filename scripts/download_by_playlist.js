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

function getPlaylistInfo(playlistUrl) {
  try {
    console.log(`\nFetching playlist info for: ${playlistUrl}`);
    const output = execSync(`yt-dlp --flat-playlist -j "${playlistUrl}"`, {
      encoding: "utf8",
    });
    const lines = output.trim().split('\n');
    const playlistJson = lines.map(line => JSON.parse(line));
    
    if (playlistJson.length === 0) {
        console.error("❌ No videos found in the playlist.");
        return null;
    }

    const firstVideo = playlistJson[0];
    const playlistTitle = firstVideo.playlist_title || firstVideo.playlist || "untitled_playlist";
    const playlistId = firstVideo.playlist_id || "no_id";

    const videoUrls = playlistJson.map(vid => vid.url);

    return {
      title: playlistTitle,
      id: playlistId,
      videos: videoUrls,
    };
  } catch (error) {
    console.error(`❌ Failed to fetch playlist info: ${error.message}`);
    return null;
  }
}

async function processPlaylist(playlistUrl) {
  const playlistInfo = getPlaylistInfo(playlistUrl);
  if (!playlistInfo) return;

  const { choice, resolution } = await getDownloadChoice();

  const downloadOptions = {
    resolution: resolution || config.defaultResolution,
    thumbnail: ['2', '5', '6', '7'].includes(choice),
    metadata: ['3', '5', '7'].includes(choice),
    subtitles: ['4', '6', '7'].includes(choice),
  };

  const safePlaylistTitle = sanitizeName(playlistInfo.title);
  const playlistFolder = path.join("./downloads/playlists", `${safePlaylistTitle}_${playlistInfo.id}`);
  fs.mkdirSync(playlistFolder, { recursive: true });
  console.log(`\n📁 Created download folder: ${playlistFolder}`);

  let videoCount = 0;
  for (const videoUrl of playlistInfo.videos) {
    videoCount++;
    console.log(`\n--- Downloading video ${videoCount} of ${playlistInfo.videos.length} ---`);
    
    const videoInfo = getVideoInfo(videoUrl);
    if (!videoInfo) {
        console.log(`Skipping video, failed to get info.`);
        continue;
    }

    const safeTitle = sanitizeName(videoInfo.title);
    const videoFolder = path.join(playlistFolder, `${safeTitle}_${videoInfo.id}`);
    fs.mkdirSync(videoFolder, { recursive: true });  // Ensure folder exists

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
    
    if (videoCount < playlistInfo.videos.length) {
        console.log(`\n⏳ Sleeping for 20 seconds before next video...`);
        await sleep(20000);
    }
  }
}

(async () => {
  const playlistUrlsArg = process.argv[2];
  if (!playlistUrlsArg) {
    console.log("Usage: node scripts/download_by_playlist.js <playlist_url1,playlist_url2,...>");
    rl.close();
    return;
  }

  const playlistUrls = playlistUrlsArg.split(',');

  for (const url of playlistUrls) {
    await processPlaylist(url.trim());
  }

  console.log("\n\n🎉 All playlists processed!");
  rl.close();
})();
