const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const express = require('express');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');

const bot = new Telegraf(config.botToken);
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const userDb = new Map();
const channelTrackHistory = [];

function getUser(userId) {
  if (!userDb.has(userId)) {
    userDb.set(userId, { referrals: new Set() });
  }
  return userDb.get(userId);
}

// ==========================================
// 1. NAVBAT TIZIMI (QUEUE SYSTEM)
// ==========================================
const processingQueue = [];
let isProcessingQueue = false;

function addToQueue(task) {
  processingQueue.push(task);
  processNextInQueue();
}

async function processNextInQueue() {
  if (isProcessingQueue || processingQueue.length === 0) return;
  isProcessingQueue = true;
  
  const currentTask = processingQueue.shift();
  try {
    await currentTask();
  } catch (err) {
    console.error("Queue Task Xatolik:", err);
  } finally {
    isProcessingQueue = false;
    processNextInQueue();
  }
}

bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type === 'private') {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
      const parts = ctx.message.text.split(' ');
      if (parts.length > 1 && parts[1].startsWith('ref_')) {
        const userId = ctx.from.id;
        const referrerId = parseInt(parts[1].split('_')[1], 10);

        if (referrerId && referrerId !== userId) {
          const referrerData = getUser(referrerId);
          referrerData.referrals.add(userId);

          if (channelTrackHistory.length > 0) {
            const randomIndex = Math.floor(Math.random() * channelTrackHistory.length);
            const randomTrack = channelTrackHistory[randomIndex];

            try {
              await bot.telegram.sendAudio(referrerId, randomTrack.file_id, {
                caption: `🎉 **SHART BAJARILDI!**\nDo'stingiz kirdi. Mana kanalingizdagi eksklyuziv to'liq musiqa:`,
                parse_mode: 'Markdown'
              });
            } catch (err) {
              console.error("Musiqa yuborishda xatolik:", err);
            }
          }
        }
      }
    }
    return;
  }
  return next();
});

app.get('/api/get-bot-info', (req, res) => {
  res.json({ username: bot.botInfo ? bot.botInfo.username : process.env.BOT_USERNAME || '' });
});

const pendingSessions = {};

// ==========================================
// 2. AVTOMATIK CLEAN TITLE
// ==========================================
function cleanTrackTitle(rawTitle) {
  if (!rawTitle) return "Track";
  let cleaned = rawTitle
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/official_video_202\d|hq_audio|audio|lyric_video|full_hd/gi, '')
    .replace(/[_]/g, ' ')
    .replace(/\.mp3|\.flac|\.wav/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || "Track";
}

// ==========================================
// 3. EFFEKTLAR BAZASI (23 TA EFFEKT - Dynamic Filter Generation)
// ==========================================
const AUDIO_EFFECTS = [
  {
    key: 'slowed',
    title: '🐌 Slowed',
    getFilter: (val) => {
      // 0% -> 1.0, 100% -> 0.5
      const speed = (1.0 - (val / 100) * 0.5).toFixed(2);
      return `atempo=${speed}`;
    }
  },
  {
    key: 'bassBoost',
    title: '🔊 Bass Boost',
    getFilter: (val) => {
      // 0% -> 0dB, 100% -> 25dB
      const gain = Math.round((val / 100) * 25);
      return `equalizer=f=60:width_type=h:width=50:g=${gain}`;
    }
  },
  {
    key: 'ebuNormalization',
    title: '📊 EBU Normalization',
    getFilter: (val) => {
      // 0% -> -24 LUFS, 100% -> -8 LUFS
      const lufs = (-24 + (val / 100) * 16).toFixed(1);
      return `loudnorm=I=${lufs}:LRA=11:TP=-1.5`;
    }
  },
  {
    key: 'smoothFade',
    title: '🎚 Smooth Fade In & Out',
    getFilter: (val, duration) => {
      const dur = duration || 180;
      // 0% -> 0.5s fade, 100% -> 10s fade
      const fadeDur = Math.max(0.5, ((val / 100) * 10)).toFixed(1);
      const fadeOutStart = Math.max(0, dur - fadeDur).toFixed(1);
      return `afade=t=in:ss=0:d=${fadeDur},afade=t=out:st=${fadeOutStart}:d=${fadeDur}`;
    }
  },
  {
    key: 'voiceIsolator',
    title: '🎤 Voice Isolator',
    getFilter: (val) => {
      // High-pass & Low-pass vocal range filter based on intensity
      const hp = Math.round(100 + (val / 100) * 200);
      const lp = Math.round(8000 - (val / 100) * 4000);
      return `highpass=f=${hp},lowpass=f=${lp}`;
    }
  },
  {
    key: 'eightD',
    title: '🎧 8D Audio',
    getFilter: (val) => {
      // 0% -> 0.05 Hz, 100% -> 0.8 Hz
      const hz = (0.05 + (val / 100) * 0.75).toFixed(3);
      return `apulsator=hz=${hz}:amount=1`;
    }
  },
  {
    key: 'reverbEcho',
    title: '🏛 Reverb & Echo',
    getFilter: (val) => {
      const delay = Math.round(20 + (val / 100) * 180);
      const decay = (0.1 + (val / 100) * 0.75).toFixed(2);
      return `aecho=0.8:0.88:${delay}:${decay}`;
    }
  },
  {
    key: 'pure3D',
    title: '🌌 Pure 3D Spatial Audio',
    getFilter: (val) => {
      // 0% -> light 3D spatializing, 100% -> extreme 3D rotation & depth
      const hz = (0.03 + (val / 100) * 0.4).toFixed(3);
      const width = (1.0 + (val / 100) * 2.0).toFixed(2);
      return `apulsator=hz=${hz}:amount=0.85,extrastereo=m=${width}`;
    }
  },
  {
    key: 'nightcore',
    title: '⚡️ Nightcore',
    getFilter: (val) => {
      // 0% -> 1.05x speed, 100% -> 1.6x speed + pitch gain
      const speed = (1.05 + (val / 100) * 0.55).toFixed(2);
      return `asetrate=44100*${speed},aresample=44100,atempo=1.0`;
    }
  },
  {
    key: 'speedUp',
    title: '🚀 Speed Up',
    getFilter: (val) => {
      // 0% -> 1.05x, 100% -> 2.0x
      const speed = (1.05 + (val / 100) * 0.95).toFixed(2);
      return `atempo=${speed}`;
    }
  },
  {
    key: 'trebleBoost',
    title: '🎼 Treble Boost',
    getFilter: (val) => {
      // 0% -> 0dB, 100% -> 20dB at 10kHz
      const gain = Math.round((val / 100) * 20);
      return `equalizer=f=10000:width_type=h:width=1000:g=${gain}`;
    }
  },
  {
    key: 'vaporwave',
    title: '🌴 Vaporwave',
    getFilter: (val) => {
      // 0% -> 0.95x, 100% -> 0.7x + lowpass + reverb
      const speed = (0.95 - (val / 100) * 0.25).toFixed(2);
      return `asetrate=44100*${speed},aresample=44100,lowpass=f=3500`;
    }
  },
  {
    key: 'stereoEnhancer',
    title: '↔️ Stereo Enhancer',
    getFilter: (val) => {
      // 0% -> m=1.1, 100% -> m=3.5
      const m = (1.1 + (val / 100) * 2.4).toFixed(1);
      return `extrastereo=m=${m}`;
    }
  },
  {
    key: 'flanger',
    title: '🌊 Flanger Effect',
    getFilter: (val) => {
      // 0% -> light flange, 100% -> deep jet sweep
      const depth = (1 + (val / 100) * 9).toFixed(1);
      const speed = (0.1 + (val / 100) * 1.9).toFixed(1);
      return `flanger=delay=${depth}:speed=${speed}`;
    }
  },
  {
    key: 'chorus',
    title: '👥 Chorus Ensemble',
    getFilter: (val) => {
      const delay = Math.round(20 + (val / 100) * 40);
      const decay = (0.2 + (val / 100) * 0.6).toFixed(2);
      return `chorus=0.7:0.9:${delay}:${decay}:0.25:2`;
    }
  },
  {
    key: 'telephoneFilter',
    title: '📞 Old Telephone',
    getFilter: (val) => {
      // 0% -> broad phone, 100% -> extreme narrow walkie-talkie band
      const low = Math.round(300 + (val / 100) * 400);
      const high = Math.round(3400 - (val / 100) * 1400);
      return `highpass=f=${low},lowpass=f=${high}`;
    }
  },
  {
    key: 'muffledConcert',
    title: '🚪 Concert Bathroom (Muffled)',
    getFilter: (val) => {
      // 0% -> 2000Hz, 100% -> 400Hz cutoff (extreme underwater/room effect)
      const lp = Math.round(2000 - (val / 100) * 1600);
      return `lowpass=f=${lp},aecho=0.8:0.88:40:0.4`;
    }
  },
  {
    key: 'pitchShiftHigh',
    title: '🐿 Chipmunk Pitch (High)',
    getFilter: (val) => {
      // 0% -> +1 semitone, 100% -> +12 semitones
      const pitch = (1.05 + (val / 100) * 0.95).toFixed(2);
      return `asetrate=44100*${pitch},aresample=44100`;
    }
  },
  {
    key: 'pitchShiftLow',
    title: '👹 Deep Monster Voice',
    getFilter: (val) => {
      // 0% -> -1 semitone, 100% -> -12 semitones
      const pitch = (0.95 - (val / 100) * 0.45).toFixed(2);
      return `asetrate=44100*${pitch},aresample=44100`;
    }
  },
  {
    key: 'phaser',
    title: '🛸 Phaser Space Sweep',
    getFilter: (val) => {
      const speed = (0.1 + (val / 100) * 2.0).toFixed(1);
      const decay = (0.2 + (val / 100) * 0.7).toFixed(2);
      return `aphaser=in_gain=0.8:out_gain=0.74:delay=3:decay=${decay}:speed=${speed}`;
    }
  },
  {
    key: 'distortedOverdrive',
    title: '🎸 Heavy Distortion',
    getFilter: (val) => {
      // 0% -> light warm overdrive, 100% -> extreme heavy fuzz
      const drive = Math.round(5 + (val / 100) * 80);
      return `acrusher=level_in=1:level_out=1:bits=16:mode=log:anti_aliasing=1,volume=${drive}dB`;
    }
  },
  {
    key: 'underwater',
    title: '🌊 Deep Underwater',
    getFilter: (val) => {
      const lp = Math.round(1200 - (val / 100) * 900);
      return `lowpass=f=${lp},volume=1.5`;
    }
  },
  {
    key: 'radioAM',
    title: '📻 AM Vintage Radio',
    getFilter: (val) => {
      const hp = Math.round(400 + (val / 100) * 400);
      const lp = Math.round(2500 - (val / 100) * 1000);
      return `highpass=f=${hp},lowpass=f=${lp},volume=1.3`;
    }
  }
];

function getCoverPath() {
  const possibleDirs = [
    path.join(__dirname, '../assets'),
    path.join(__dirname, '../../assets'),
    path.join(process.cwd(), 'assets')
  ];
  const possibleFiles = ['photo.JPG', 'photo.jpg', 'cover.JPG', 'cover.jpg', 'cover.jpeg', 'cover.png'];
  
  for (const dir of possibleDirs) {
    for (const fileName of possibleFiles) {
      const filePath = path.join(dir, fileName);
      if (fs.existsSync(filePath)) return filePath;
    }
  }
  return null;
}

function getAudioDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        return resolve(0);
      }
      resolve(metadata.format.duration);
    });
  });
}

function applyCustomAudioEffects(inputPath, outputPath, effectIntensities, duration) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);
    const filters = [];

    AUDIO_EFFECTS.forEach(eff => {
      const intensity = effectIntensities[eff.key];
      if (intensity && intensity > 0) {
        const filterStr = eff.getFilter(intensity, duration);
        if (filterStr) {
          filters.push(filterStr);
        }
      }
    });

    if (filters.length > 0) {
      command.audioFilters(filters);
    }

    command
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

bot.on('callback_query', async (ctx, next) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (error) {}
  return next();
});

// ==========================================
// 4. KANAL POSTINI QABUL QILISH
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  // Text inputs handling (Title & Trim time)
  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

    if (session.step === 'waitingForTitle') {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      session.customTitle = `${cleanTrackTitle(text)} 🎧`;
      showMainMenu(ctx, chatId);
      return;
    }

    if (session.step === 'waitingForTrimTime30') {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});

      let minutes = 0;
      let seconds = 0;

      if (text.includes(':')) {
        const parts = text.split(':');
        minutes = parseInt(parts[0], 10) || 0;
        seconds = parseInt(parts[1], 10) || 0;
      } else if (text.includes(' ')) {
        const parts = text.split(/\s+/);
        minutes = parseInt(parts[0], 10) || 0;
        seconds = parseInt(parts[1], 10) || 0;
      } else {
        seconds = parseInt(text, 10) || 0;
      }

      const calculatedStart = (minutes * 60) + seconds;

      session.trimStart = calculatedStart;
      session.trimDuration = 30;
      session.isTrimmed = true;

      showMainMenu(ctx, chatId);
      return;
    }
  }

  // Audio files receiving
  if (post.audio) {
    const messageId = post.message_id;
    const audio = post.audio;

    const tempDir = path.join(__dirname, '../temp');
    const assetsDir = path.join(__dirname, '../assets');

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const rawPath = path.join(tempDir, `raw_${audio.file_id}.mp3`);
    const startTagPath = path.join(assetsDir, 'voicetag_start.mp3');
    const endTagPath = path.join(assetsDir, 'voicetag_end.mp3');

    try {
      const fileLink = await ctx.telegram.getFileLink(audio.file_id);
      const response = await axios({ method: 'get', url: fileLink.href, responseType: 'stream' });
      const writer = fs.createWriteStream(rawPath);

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});

      const rawTitle = audio.title || audio.file_name || "Track";
      const cleanedTitle = `${cleanTrackTitle(rawTitle)} 🎧`;

      const promptMsg = await ctx.telegram.sendMessage(chatId, 
        `✍️ **Musiqa qabul qilindi!**\n\nIltimos, ushbu musiqa uchun **nom (title)** yuboring (masalan: *Artist - Track Name*):`, 
        { parse_mode: 'Markdown' }
      );

      // Har bir effekt uchun default 0 intensivlik holatini yuklaymiz
      const initialEffects = {};
      AUDIO_EFFECTS.forEach(eff => {
        initialEffects[eff.key] = 0;
      });

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        customTitle: cleanedTitle,
        isTrimmed: false,
        trimStart: 0,
        trimDuration: 30,
        step: 'waitingForTitle',
        promptMessageId: promptMsg.message_id,
        effectIntensities: initialEffects,
        currentEffectIndex: 0
      };

    } catch (err) {
      console.error("Audio yuklab olish xatosi:", err);
    }
  }
});

// ==========================================
// 5. YAGONA INLINE MENYU TIZIMI (EDIT MESSAGE ONLY)
// ==========================================
async function showMainMenu(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  session.step = 'mainMenu';

  const activeEffects = AUDIO_EFFECTS
    .filter(e => session.effectIntensities[e.key] > 0)
    .map(e => `${e.title} (${session.effectIntensities[e.key]}%)`);

  const activeText = activeEffects.length > 0 ? activeEffects.join('\n• ') : 'Yo\'q (Standart)';
  const trimStatus = session.isTrimmed ? `✅ ${session.trimStart}s dan +30s` : "❌ Tanlanmadi";

  const text = `🎧 **MUSIQA BOSHQARUV PANELI**\n\n` +
               `🎵 **Nomi:** ${session.customTitle}\n` +
               `⏱ **30s Kesish:** ${trimStatus}\n\n` +
               `🎛 **Faol effektlar:**\n• ${activeText}\n\n` +
               `Kerakli bo'limni tanlang:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⏱ 30s Kesish vaqtini belgilash", `menu_trim30_${chatId}`)],
    [Markup.button.callback("🎛 Effektlarni Sozlash (0-100%)", `menu_fx_select_${chatId}`)],
    [Markup.button.callback("🚀 TAYYOR (Kanalga Joylash)", `process_final_${chatId}`)]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// Kesish sozlamasi tugmasi
bot.action(/menu_trim30_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const session = pendingSessions[chatId];
  if (!session) return;

  session.step = 'waitingForTrimTime30';

  const text = "⏱ **Musiqani qaysi soniyasidan boshlab kesamiz?**\n\nChatga daqiqa va soniyasini yozing (Masalan: `1 30` yoki `1:30`). Bot avtomatik 30 soniya kesib oladi.";
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Ortga", `menu_back_${chatId}`)]
  ]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
});

bot.action(/menu_back_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  showMainMenu(ctx, chatId);
});

// Effektlar ro'yxatiga kirish
bot.action(/menu_fx_select_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const session = pendingSessions[chatId];
  if (!session) return;

  session.currentEffectIndex = 0;
  showEffectControlMenu(ctx, chatId);
});

// EFFEKT INTENSIVLIGINI SOZLASH MENYUSI (YAGONA WINDOW)
async function showEffectControlMenu(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const index = session.currentEffectIndex;
  const effect = AUDIO_EFFECTS[index];
  const currentVal = session.effectIntensities[effect.key] || 0;

  const text = `🎛 **EFFEKTNI SOZLASH (${index + 1}/${AUDIO_EFFECTS.length})**\n\n` +
               `📌 **${effect.title}**\n` +
               `⚡️ **Joriy Kuch:** \`[${currentVal}%]\` ${currentVal === 100 ? '🔥 (O\'TA KUCHLI)' : ''}\n\n` +
               `Tugmalar orqali kuchini 0% dan 100% gacha o'zgartiring:`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("➖ 10%", `fx_adj_${chatId}_-10`),
      Markup.button.callback("➖ 1%", `fx_adj_${chatId}_-1`),
      Markup.button.callback("➕ 1%", `fx_adj_${chatId}_+1`),
      Markup.button.callback("➕ 10%", `fx_adj_${chatId}_+10`)
    ],
    [
      Markup.button.callback("❌ 0% (O'chirish)", `fx_set_${chatId}_0`),
      Markup.button.callback("🔥 100% (Maksimum)", `fx_set_${chatId}_100`)
    ],
    [
      Markup.button.callback("⬅️ Oldingisi", `fx_nav_${chatId}_prev`),
      Markup.button.callback("Keyingisi ➡️", `fx_nav_${chatId}_next`)
    ],
    [
      Markup.button.callback("📋 Bosh Menyuga Qaytish", `menu_back_${chatId}`)
    ]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// Qiymatni + - bilan o'zgartirish
bot.action(/fx_adj_(.+)_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const delta = parseInt(ctx.match[2], 10);
  const session = pendingSessions[chatId];
  if (!session) return;

  const effect = AUDIO_EFFECTS[session.currentEffectIndex];
  let newVal = (session.effectIntensities[effect.key] || 0) + delta;
  
  if (newVal < 0) newVal = 0;
  if (newVal > 100) newVal = 100;

  session.effectIntensities[effect.key] = newVal;
  showEffectControlMenu(ctx, chatId);
});

// Qiymatni to'g'ridan-to'g'ri o'rnatish (0 yoki 100)
bot.action(/fx_set_(.+)_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const val = parseInt(ctx.match[2], 10);
  const session = pendingSessions[chatId];
  if (!session) return;

  const effect = AUDIO_EFFECTS[session.currentEffectIndex];
  session.effectIntensities[effect.key] = val;
  showEffectControlMenu(ctx, chatId);
});

// Effektlar bo'ylab oldinga/ortga navigatsiya
bot.action(/fx_nav_(.+)_(prev|next)/, async (ctx) => {
  const chatId = ctx.match[1];
  const dir = ctx.match[2];
  const session = pendingSessions[chatId];
  if (!session) return;

  if (dir === 'next') {
    if (session.currentEffectIndex < AUDIO_EFFECTS.length - 1) {
      session.currentEffectIndex += 1;
    } else {
      showMainMenu(ctx, chatId);
      return;
    }
  } else if (dir === 'prev') {
    if (session.currentEffectIndex > 0) {
      session.currentEffectIndex -= 1;
    }
  }

  showEffectControlMenu(ctx, chatId);
});

bot.action(/process_final_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  addToQueue(() => processAndSendFinalAudio(ctx, chatId));
});

// ==========================================
// 6. ISHLOV BERISH VA YAKUNIY CHAT TOZALASH
// ==========================================
async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);

  const appliedList = AUDIO_EFFECTS
    .filter(eff => session.effectIntensities[eff.key] > 0)
    .map(eff => `${eff.title} (${session.effectIntensities[eff.key]}%)`);

  const appliedFxText = appliedList.length > 0 ? appliedList.join(', ') : "Standart";

  const loadingText = `⚡️ **Musiqa navbatda va qayta ishlanmoqda...**\n🎛 *Qo'shilgan effektlar:* ${appliedFxText}`;
  
  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, loadingText, {
    parse_mode: 'Markdown'
  }).catch(() => {});

  try {
    const duration = await getAudioDuration(session.rawPath);

    let trimmedAudioPath = null;
    if (session.isTrimmed) {
      trimmedAudioPath = path.join(tempDir, `snippet_${Date.now()}.mp3`);
      const tempTrimmed = path.join(tempDir, `raw_trim_${Date.now()}.mp3`);

      await trimAudio(session.rawPath, tempTrimmed, session.trimStart, session.trimDuration);
      await applyCustomAudioEffects(tempTrimmed, trimmedAudioPath, session.effectIntensities, session.trimDuration);
      await cleanAndInjectMetadata(trimmedAudioPath, " ");

      if (fs.existsSync(tempTrimmed)) fs.unlinkSync(tempTrimmed);
    }

    const processedFxPath = path.join(tempDir, `fx_${Date.now()}.mp3`);
    const fullAudioPath = path.join(tempDir, `full_${Date.now()}.mp3`);

    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.effectIntensities, duration);
    await processAudioWithVoiceTag(processedFxPath, fullAudioPath, session.startTagPath, session.endTagPath);
    const updatedTitle = await cleanAndInjectMetadata(fullAudioPath, session.customTitle);
    const coverPath = getCoverPath();

    // Tugallangach inline menyu xabarini o'chirib chatni toza tutamiz
    await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

    if (session.isTrimmed && trimmedAudioPath && fs.existsSync(trimmedAudioPath)) {
      await ctx.telegram.sendAudio(
        chatId,
        { source: trimmedAudioPath },
        { title: " ", performer: " " }
      );
      fs.unlinkSync(trimmedAudioPath);
    }

    const sentAudio = await ctx.telegram.sendAudio(
      chatId,
      { source: fullAudioPath },
      {
        caption: config.captionTemplate,
        parse_mode: 'HTML',
        title: updatedTitle,
        performer: config.defaultArtist,
        ...(coverPath && { thumbnail: { source: coverPath } })
      }
    );

    if (sentAudio && sentAudio.audio) {
      channelTrackHistory.push({ file_id: sentAudio.audio.file_id });
    }

  } catch (err) {
    console.error("Process Error:", err);
    await ctx.telegram.sendMessage(chatId, "❌ Ishlov berishda xatolik yuz berdi!").catch(() => {});
  } finally {
    if (session.rawPath && fs.existsSync(session.rawPath)) fs.unlinkSync(session.rawPath);
    delete pendingSessions[chatId];
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server ${PORT}-portda ishga tushdi.`);
  try {
    await bot.launch();
    console.log("MuzXs Bot va Express Mini App tayyor va ishlamoqda.");
  } catch (err) {
    console.error("Botni ishga tushirishda xatolik:", err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
