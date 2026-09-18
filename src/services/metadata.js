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

// Albom rasmini assets papkasidan qidirib topish
function getCoverBuffer() {
  const possibleDirs = [
    path.join(__dirname, '../../assets'),
    path.join(__dirname, '../assets'),
    path.join(process.cwd(), 'assets')
  ];
  
  // photo.JPG va boshqa nomlar
  const possibleFiles = ['photo.JPG', 'photo.jpg', 'cover.JPG', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.PNG'];
  
  for (const dir of possibleDirs) {
    for (const fileName of possibleFiles) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          return fs.readFileSync(filePath);
        } catch (e) {}
      }
    }
  }
  return null;
}

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

  // Faqat lokal assets papkasidan rasmni olamiz (GitHub shart emas)
  const imageBuffer = getCoverBuffer();

  if (imageBuffer) {
    tags.image = {
      mime: "image/jpeg",
      type: {
        id: 3,
        name: "front cover"
      },
      description: "Cover",
      data: imageBuffer 
    };
  }

  // Tegni faylga yozamiz
  NodeID3.write(tags, filePath);

  return finalTitle;
}

module.exports = { cleanAndInjectMetadata };
