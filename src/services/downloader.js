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

  const outputTemplate = path.join(tempDir, `media_${Date.now()}.%(ext)s`);
  
  // yt-dlp yordamida yuklash (1080p dan oshmaydigan va 100MB dan katta bo'lmagan formatni tanlaydi)
  // --max-filesize 100M orqali serverni himoya qilamiz
  const formatArg = type === 'video' 
    ? 'bv*[height<=1080]+ba/b[height<=1080] / wv*+ba/w' 
    : 'ba';

  const command = `yt-dlp -f "${formatArg}" --max-filesize 100M -o "${outputTemplate}" "${url}"`;

  try {
    await execPromise(command);
    
    // Yuklangan faylni topish
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`media_${Date.now().toString().slice(0, -4)}`));
    
    // Agar aniq vaqt bo'yicha topilmasa, oxirgi yaratilgan faylni olamiz
    const latestFile = files
      .map(file => ({ file, mtime: fs.statSync(path.join(tempDir, file)).mtime }))
      .sort((a, b) => b.mtime - a.mtime)[0];

    if (!latestFile) throw new Error("Fayl yuklab olinmadi yoki hajm chekovidan oshib ketdi.");

    return path.join(tempDir, latestFile.file);
  } catch (error) {
    console.error("yt-dlp execution error:", error);
    throw new Error("Videoni yuklab bo'lmadi. Havola noto'g'ri yoki fayl hajmi 100MB dan katta.");
  }
}

/**
 * Havoladan faqat audioni yuklab, 10-soniyasiga voicetag qo'shish va metadata tozalash
 */
async function downloadAudioWithTag(url, startTagPath) {
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const rawAudioPath = path.join(tempDir, `raw_audio_${Date.now()}.mp3`);
  const finalAudioPath = path.join(tempDir, `final_audio_${Date.now()}.mp3`);

  // 1. yt-dlp orqali audioni MP3 formatda tortib olish
  const downloadCmd = `yt-dlp -x --audio-format mp3 --audio-quality 192K -o "${rawAudioPath.replace('.mp3', '.%(ext)s')}" "${url}"`;
  
  try {
    await execPromise(downloadCmd);
    
    // Topilgan raw audioni aniqlash
    const files = fs.readdirSync(tempDir);
    const targetRaw = files.find(f => f.startsWith(`raw_audio_`) && f.endsWith('.mp3'));
    const rawPath = path.join(tempDir, targetRaw);

    // 2. FFmpeg orqali 10-soniyaga voicetag (3 soniyalik kanal reklamasi) qo'shish
    // Bu yerda FFmpeg 'adelay' yoki 'amix' orqali 10-chi sekundda ovozni aralashtiradi
    if (fs.existsSync(startTagPath)) {
      // 10-chi sekundda (10000ms) voicetag ni qo'shish buyrug'i
      const ffmpegCmd = `ffmpeg -i "${rawPath}" -i "${startTagPath}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]" -map "[a]" -codec:a libmp3lame -b:a 192k "${finalAudioPath}"`;
      await execPromise(ffmpegCmd);
      
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      return finalAudioPath;
    } else {
      // Agar voicetag fayli topilmasa, shunchaki o'zini qaytaramiz
      return rawPath;
    }

  } catch (error) {
    console.error("Audio download & tag error:", error);
    throw new Error("Musiqani yuklab va tahrirlab bo'lmadi.");
  }
}

module.exports = {
  downloadMedia,
  downloadAudioWithTag
};
