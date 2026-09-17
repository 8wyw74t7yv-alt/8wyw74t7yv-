const NodeID3 = require('node-id3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Sarlavha tushunarsiz raqamlar yoki belgilardan iboratligini aniqlash
function isGibberishTitle(title) {
  if (!title) return true;
  const clean = title.trim();
  if (clean.length < 2) return true;
  
  // Faqat raqamlar, tushunarsiz simvollar yoki fayl kengaytmasi bo'lsa
  const onlyNumbersOrSymbols = /^[\d\s\-_.~!@#$%^&*()+=]+$/;
  const isAudioFilename = /^audio_\d+|^track_\d+|^file_\d+/i;

  return onlyNumbersOrSymbols.test(clean) || isAudioFilename.test(clean);
}

// Shazam/AudD API orqali musiqa nomini aniqlash (Agar kalit bo'lsa)
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

// Local assets papkasidan (cover.JPG / cover.jpg) yoki GitHub'dan albom rasmini olish
async function fetchCoverBuffer(url) {
  const assetsDir = path.join(__dirname, '../../assets');
  const possibleFiles = ['cover.JPG', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.PNG'];
  
  // 1. Birinchi navbatda local assets/ papkasidagi rasmlarni tekshiramiz
  for (const fileName of possibleFiles) {
    const filePath = path.join(assetsDir, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }

  // 2. Agar local papkada rasm topilmasa, GitHub URL orqali yuklaydi
  if (url) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(response.data, 'binary');
    } catch (err) {
      console.error("Cover Download Error:", err.message);
    }
  }
  return null;
}

// ID3 Metadatalarni to'liq qayta yozish va tozalash
async function cleanAndInjectMetadata(filePath, originalTitle) {
  let finalTitle = originalTitle;

  if (isGibberishTitle(finalTitle)) {
    const identified = await identifyTrackTitle(filePath);
    finalTitle = identified ? identified : config.fallbackTitle;
  }

  const imageBuffer = await fetchCoverBuffer(config.githubCoverUrl);

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

  if (imageBuffer) {
    tags.image = {
      mime: "image/jpeg",
      type: { id: 3, name: 'front cover' },
      description: 'Album Cover',
      imageBuffer: imageBuffer
    };
  }

  // Eski barcha teglarni tozalab, yangisini yozamiz
  NodeID3.clearTags(filePath);
  NodeID3.write(tags, filePath);

  return finalTitle;
}

module.exports = { cleanAndInjectMetadata };
