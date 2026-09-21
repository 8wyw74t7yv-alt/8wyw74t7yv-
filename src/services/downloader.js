const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);

/**
 * YouTube, Instagram yoki TikTok'dan videoni yuklab olish (Maksimal 1080p va 100MB limit bilan)
 */
async function downloadMedia(url, type = 'video') {
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const uniqueId = Date.now();
  const outputTemplate = path.join(tempDir, `media_${uniqueId}.%(ext)s`);
  
  const formatArg = type === 'video' 
    ? 'bv*[height<=1080]+ba/b[height<=1080] / wv*+ba/w' 
    : 'ba';

  const command = `yt-dlp -f "${formatArg}" --max-filesize 100M -o "${outputTemplate}" "${url}"`;

  try {
    await execPromise(command);
    
    // Temp papkasidagi shu uniqueId bilan boshlanuvchi faylni aniq topamiz
    const files = fs.readdirSync(tempDir);
    const targetFile = files.find(file => file.startsWith(`media_${uniqueId}.`));
    
    if (!targetFile) {
      throw new Error("Fayl yuklab olinmadi yoki hajm chekovidan oshib ketdi.");
    }

    return path.join(tempDir, targetFile);
  } catch (error) {
    console.error("yt-dlp execution error:", error.message);
    throw new Error("Videoni yuklab bo'lmadi. Havola noto'g'ri yoki fayl hajmi 100MB dan katta.");
  }
}

/**
 * Havoladan faqat audioni yuklab, 10-soniyasiga voicetag qo'shish va metadata tozalash
 */
async function downloadAudioWithTag(url, startTagPath) {
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const uniqueId = Date.now();
  const rawAudioOutput = path.join(tempDir, `raw_audio_${uniqueId}.%(ext)s`);
  const finalAudioPath = path.join(tempDir, `final_audio_${uniqueId}.mp3`);

  // 1. yt-dlp orqali audioni tortib olish
  const downloadCmd = `yt-dlp -x --audio-format mp3 --audio-quality 192K -o "${rawAudioOutput}" "${url}"`;
  
  try {
    await execPromise(downloadCmd);
    
    // Yuklangan raw audioni aniqlash
    const files = fs.readdirSync(tempDir);
    const targetRaw = files.find(f => f.startsWith(`raw_audio_${uniqueId}`) && (f.endsWith('.mp3') || f.endsWith('.opus') || f.endsWith('.m4a')));
    
    if (!targetRaw) {
      throw new Error("Audio fayl topilmadi.");
    }

    const rawPath = path.join(tempDir, targetRaw);

    // 2. FFmpeg orqali 10-soniyaga voicetag qo'shish
    if (fs.existsSync(startTagPath)) {
      const ffmpegCmd = `ffmpeg -i "${rawPath}" -i "${startTagPath}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]" -map "[a]" -codec:a libmp3lame -b:a 192k "${finalAudioPath}"`;
      await execPromise(ffmpegCmd);
      
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      return finalAudioPath;
    } else {
      return rawPath;
    }

  } catch (error) {
    console.error("Audio download & tag error:", error.message);
    throw new Error("Musiqani yuklab va tahrirlab bo'lmadi.");
  }
}

module.exports = {
  downloadMedia,
  downloadAudioWithTag
};
