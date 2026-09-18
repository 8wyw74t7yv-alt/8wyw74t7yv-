const NodeID3 = require('node-id3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('../config');

function isGibberishTitle(title) {
  if (!title) return true;
  const clean = title.trim();
  if (clean.length < 2) return true;
  
  const onlyNumbersOrSymbols = /^[\d\s\-_.~!@#$\%^&*()+=]+$/;
  const isAudioFilename = /^audio_\d+|^track_\d+|^file_\d+/i;

  return onlyNumbersOrSymbols.test(clean) || isAudioFilename.test(clean);
}

async function identifyTrackTitle(filePath) {
  if (!config.auddApiKey) return null;
  
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('api_token', config.auddApiKey);

    const res = await axios.post('https://api.audd.io/', formData, {
      headers: formData.getHeaders()
    });

    if (res.data && res.data.result && res.data.result.title) {
      return res.data.result.title;
    }
  } catch (err) {
    console.error("AudD API Error:", err.message);
  }
  return null;
}

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

async function cleanAndInjectMetadata(filePath, originalTitle) {
  let finalTitle = originalTitle;

  if (isGibberishTitle(finalTitle)) {
    const identified = await identifyTrackTitle(filePath);
    finalTitle = identified ? identified : config.fallbackTitle;
  }

  // Avval eski metadatalarni tozalab tashlaymiz (-1)
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
        id: 3, // 3 - Front Cover
        name: "front cover"
      },
      description: "MuzXs Cover",
      data: imageBuffer
    };
  }

  // ID3v2.3 formatida yozish Telegram pleyerida rasm chiqishini kafolatlaydi
  const success = NodeID3.write(tags, filePath, {
    id3v2Version: 3
  });

  if (!success) {
    console.error("[Metadata Error] ID3 teglarni yozib bo'lmadi!");
  }

  return finalTitle;
}

module.exports = { cleanAndInjectMetadata };
