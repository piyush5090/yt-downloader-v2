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

async function getDownloadPrefs() {
  const section = await question(`Enter channel section (e.g., /videos, /shorts) or press Enter for default (${config.defaultChannelSection}): `);
  
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
  
  return { 
    section: section || config.defaultChannelSection, 
    choice, 
    resolution 
  };
}

function getChannelInfo(channelUrl, section) {
  try {
    // 1. CLEAN THE URL
    let cleanUrl = channelUrl.replace(/\/+$/, "");
    
    // Only add section if it's not already there
    if (!cleanUrl.endsWith(section)) {
      cleanUrl += section;
    }

    console.log(`\nFetching channel info for: ${cleanUrl}`);

    // 2. FETCH FULL PLAYLIST OBJECT (-J instead of -j)
    // -J dumps the whole structure (channel info + videos) as one JSON object
    const output = execSync(`yt-dlp -J --flat-playlist "${cleanUrl}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 50 // Increase buffer to 50MB for large channels
    });

    const data = JSON.parse(output);

    // 3. EXTRACT METADATA FROM THE ROOT
    // 'uploader' is usually the clean channel name (e.g., "PewDiePie")
    // 'title' might contain extra junk (e.g., "PewDiePie - Videos")
    const channelTitle = data.uploader || data.channel || data.title || "untitled_channel";
    const channelId = data.channel_id || data.id || "no_id";

    console.log(`✅ Found Channel: ${channelTitle} (${channelId})`);
    console.log(`📊 Found ${data.entries ? data.entries.length : 0} videos.`);

    if (!data.entries || data.entries.length === 0) {
        console.error("❌ No videos found in this channel section.");
        return null;
    }

    // 4. FORMAT VIDEO LIST
    const videos = data.entries.map(vid => ({
        url: vid.url,
        title: vid.title,
        id: vid.id
    }));

    return {
      title: channelTitle,
      id: channelId,
      videos: videos, 
    };

  } catch (error) {
    console.error(`❌ Failed to fetch channel info: ${error.message}`);
    // Suggest updating if it fails
    console.error("💡 Hint: Try running 'yt-dlp -U' to update if parsing fails.");
    return null;
  }
}


async function processChannel(channelInfo, choice, resolution) {

  const downloadOptions = {
    resolution: resolution || config.defaultResolution,
    thumbnail: ['2', '5', '6', '7'].includes(choice),
    metadata: ['3', '5', '7'].includes(choice),
    subtitles: ['4', '6', '7'].includes(choice),
  };

  const safeChannelTitle = sanitizeName(channelInfo.title);
  const channelFolder = path.join("./downloads/channels", `${safeChannelTitle}_${channelInfo.id}`);
  fs.mkdirSync(channelFolder, { recursive: true });
  console.log(`\n📁 Created download folder: ${channelFolder}`);

  let videoCount = 0;
  
  // FIX: 'video' is now an object { url, title, id }, not just a URL string
  for (const video of channelInfo.videos) { 
    videoCount++;
    console.log(`\n--- Downloading video ${videoCount} of ${channelInfo.videos.length} ---`);
    
    // OPTIMIZATION: We already have title/id from getChannelInfo.
    // We removed the redundant 'getVideoInfo' call here.

    const safeTitle = sanitizeName(video.title);
    const videoFolder = path.join(channelFolder, `${safeTitle}_${video.id}`);
    fs.mkdirSync(videoFolder, { recursive: true });

    let success = false;
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        // PASS video.url instead of the whole object
        success = await download(video.url, videoFolder, video.id, downloadOptions);
        if (success) break;
        if (attempt < config.maxRetries) {
            console.log(`⏳ Retry in ${config.retryDelay / 1000}s...`);
            await sleep(config.retryDelay);
        }
    }

    if (!success) {
        console.error(`❌ All attempts failed for ${video.url}.\n`);
    }
    
    if (videoCount < channelInfo.videos.length) {
        console.log(`\n⏳ Sleeping for 20 seconds before next video...`);
        await sleep(20000);
    }
  }
}

(async () => {
  const channelUrlsArg = process.argv[2];
  if (!channelUrlsArg) {
    console.log("Usage: node scripts/download_by_channel.js <channel_url1,channel_url2,வைக்>");
    rl.close();
    return;
  }

  const channelUrls = channelUrlsArg.split(',');

  const { section, choice, resolution } = await getDownloadPrefs();

  for (const url of channelUrls) {
    const channelInfo = getChannelInfo(url.trim(), section);
    if (channelInfo) {
      await processChannel(channelInfo, choice, resolution);
    }
  }

  console.log("\n\n🎉 All channels processed!");
  rl.close();
})();
