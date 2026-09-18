const NodeID3 = require('node-id3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('../config');

// Sarlavha tushunarsiz raqamlar yoki belgilardan iboratligini aniqlash
function isGibberishTitle(title) {
  if (!title) return true;
  const clean = title.trim();
  if (clean.length < 2) return true;
  
  const onlyNumbersOrSymbols = /^[\d\s\-_.~!@#$%^&*()+=]+$/;
  const isAudioFilename = /^audio_\d+|^track_\d+|^file_\d+/i;

  return onlyNumbersOrSymbols.test(clean) || isAudioFilename.test(clean);
}

// Shazam/AudD API orqali musiqa nomini aniqlash
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

// Albom rasmining fayl yo'lini topish
function getCoverFilePath() {
  // Bir nechta ehtimoliy papkalarni tekshiramiz (src/assets yoki root/assets)
  const possibleDirs = [
    path.join(__dirname, '../../assets'),
    path.join(__dirname, '../assets'),
    path.join(process.cwd(), 'assets')
  ];
  
  const possibleFiles = ['cover.JPG', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.PNG'];
  
  for (const dir of possibleDirs) {
    for (const fileName of possibleFiles) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return null;
}

// ID3 Metadatalarni yozish
async function cleanAndInjectMetadata(filePath, originalTitle) {
  let finalTitle = originalTitle;

  if (isGibberishTitle(finalTitle)) {
    const identified = await identifyTrackTitle(filePath);
    finalTitle = identified ? identified : config.fallbackTitle;
  }

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

  // Rasmni to'g'ridan-to'g'ri fayl yo'li orqali biriktiramiz
  const coverPath = getCoverFilePath();
  if (coverPath) {
    tags.image = coverPath;
  } else if (config.githubCoverUrl) {
    // Agar local rasm topilmasa, GitHub URL'dan vaqtincha yuklab ishlatish mumkin
    try {
      const response = await axios.get(config.githubCoverUrl, { responseType: 'arraybuffer' });
      const tempCoverPath = path.join(path.dirname(filePath), 'temp_cover.jpg');
      fs.writeFileSync(tempCoverPath, Buffer.from(response.data, 'binary'));
      tags.image = tempCoverPath;
    } catch (err) {
      console.error("GitHub Cover Download Error:", err.message);
    }
  }

  // Teg yozish
  NodeID3.write(tags, filePath);

  // Vaqtinchalik yuklangan rasm bo'lsa tozalash
  const tempCoverPath = path.join(path.dirname(filePath), 'temp_cover.jpg');
  if (fs.existsSync(tempCoverPath)) {
    try { fs.unlinkSync(tempCoverPath); } catch (e) {}
  }

  return finalTitle;
}

module.exports = { cleanAndInjectMetadata };
