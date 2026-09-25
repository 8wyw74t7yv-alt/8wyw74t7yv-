const NodeID3 = require('node-id3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Sifatsiz yoki bo'sh sarlavhani aniqlash
function isGibberishTitle(title) {
  if (!title) return true;
  const clean = title.trim();
  if (clean.length < 2) return true;
  
  const onlyNumbersOrSymbols = /^[\d\s\-_.~!@#$\%^&*()+=]+$/;
  const isAudioFilename = /^audio_\d+|^track_\d+|^file_\d+/i;

  return onlyNumbersOrSymbols.test(clean) || isAudioFilename.test(clean);
}

// Albom rasmini (Cover) assets papkasidan o'qish
function getCoverBuffer() {
  const possibleDirs = [
    path.join(__dirname, '../../assets'),
    path.join(__dirname, '../assets'),
    path.join(process.cwd(), 'assets')
  ];
  
  const possibleFiles = ['photo.JPG', 'photo.jpg', 'cover.JPG', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.PNG'];
  
  for (const dir of possibleDirs) {
    for (const fileName of possibleFiles) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          console.log(`[Cover Log] Albom rasmi topildi: ${filePath}`);
          return fs.readFileSync(filePath);
        } catch (e) {
          console.error(`[Cover Log] Rasmni o'qishda xatolik: ${e.message}`);
        }
      }
    }
  }
  console.log("[Cover Log] OGOHLANTIRISH: assets papkasida rasm topilmadi!");
  return null;
}

// Metama'lumotlarni tozalash va yangi teglar yozish
async function cleanAndInjectMetadata(filePath, originalTitle) {
  let finalTitle = originalTitle;

  if (isGibberishTitle(finalTitle)) {
    finalTitle = config.fallbackTitle;
  }

  // Avval eski metadatalarni tozalab tashlaymiz
  NodeID3.removeTags(filePath);

  const tags = {
    title: finalTitle,
    artist: config.defaultArtist,
    album: config.channelUsername,
    composer: config.channelUsername,
    copyright: config.channelUsername,
    comment: {
      language: "eng",
      text: config.channelLink
    }
  };

  const imageBuffer = getCoverBuffer();

  if (imageBuffer) {
    tags.image = {
      mime: "image/jpeg",
      type: {
        id: 3, // Front Cover
        name: "front cover"
      },
      description: "MuzXs Cover",
      data: imageBuffer
    };
  }

  // ID3v2.3 formatida yozish Telegram pleyerida rasm va sarlavha to'g'ri ko'rinishini ta'minlaydi
  const success = NodeID3.write(tags, filePath, {
    id3v2Version: 3
  });

  if (!success) {
    console.error("[Metadata Error] ID3 teglarni yozib bo'lmadi!");
  }

  return finalTitle;
}

module.exports = { cleanAndInjectMetadata };
