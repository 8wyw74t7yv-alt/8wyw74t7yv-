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
// Static fayllar va asosiy sahifa ulanishi
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Foydalanuvchilar va kanaldagi to'liq musiqalar bazasi
const userDb = new Map();
const channelTrackHistory = []; // Kanalga joylangan to'liq musiqalarning file_id lari saqlanadi

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

// BOTGA SHAXSIYDA YOZILGANDA JAVOB BERMASLIK (Referralni ushlash va musiqani yuborish)
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

// API: Mini App uchun bot username
app.get('/api/get-bot-info', (req, res) => {
  res.json({ username: bot.botInfo ? bot.botInfo.username : process.env.BOT_USERNAME || '' });
});

const pendingSessions = {};

// ==========================================
// 2. AVTOMATIK CLEAN & FORMAT TITLE (NOMLARNI TOZALASH)
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
// 3. EFFEKTLAR VA BINAURAL 3D PRESETLAR
// ==========================================
const AUDIO_EFFECTS = [
  { key: 'slowed', title: '🐌 Slowed', filter: 'atempo=0.92' },
  { key: 'bassBoost', title: '🔊 Bass Boost', filter: 'equalizer=f=60:width_type=h:width=50:g=10' },
  { key: 'noiseReduction', title: '🧹 Noise Reduction', filter: 'afftdn=nr=12:nf=-25' },
  { key: 'ebuNormalization', title: '📊 EBU R128 (-14 LUFS)', filter: 'loudnorm=I=-14:LRA=11:TP=-1.5' },
  {
    key: 'smoothFade',
    title: '🎚 Smooth Fade In & Out',
    dynamicFilter: (duration) => {
      const dur = duration || 180;
      const fadeOutStart = Math.max(0, dur - 3);
      return `afade=t=in:ss=0:d=2,afade=t=out:st=${fadeOutStart}:d=3`;
    }
  },
  { key: 'voiceIsolator', title: '🎤 Voice Isolator', filter: 'pan=stereo|c0=c0-c1|c1=c0-c1' },
  { key: 'eightD', title: '🎧 8D Audio', filter: 'apulsator=hz=0.125:amount=1' },
  { key: 'reverbEcho', title: '🏛 Reverb & Echo', filter: 'aecho=0.8:0.88:60:0.4' },
  { key: 'binaural3d', title: '🌌 Binaural 3D Echo Chamber', filter: 'aecho=0.8:0.9:1000|1800:0.3|0.25,apulsator=hz=0.08:amount=0.9' }
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

function applyCustomAudioEffects(inputPath, outputPath, selectedEffects, duration) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);
    const filters = [];

    AUDIO_EFFECTS.forEach(eff => {
      if (selectedEffects[eff.key]) {
        if (eff.filter) {
          filters.push(eff.filter);
        } else if (eff.dynamicFilter) {
          filters.push(eff.dynamicFilter(duration));
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
// 4. KANALDA MUSIQANI BOSHQARISH (CHANNEL POST)
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  // Matnli buyruqlarni va vaqtni qabul qilish
  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

    // Musiqa nomini kiritish bosqichi
    if (session.step === 'waitingForTitle') {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      session.customTitle = `${cleanTrackTitle(text)} 🎧`;
      showMainMenu(ctx, chatId);
      return;
    }

    // ⏱ 30 sekund uchun kiritilgan vaqtni hisoblash
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

  // Audio qabul qilish
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

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        customTitle: cleanedTitle,
        isTrimmed: false,
        trimStart: 0,
        trimDuration: 30,
        step: 'waitingForTitle', // Avval nomini so'rashga o'tadi
        promptMessageId: promptMsg.message_id,
        selectedEffects: {},
        currentEffectIndex: 0
      };

    } catch (err) {
      console.error("Audio yuklab olish xatosi:", err);
    }
  }
});

// ==========================================
// 5. YAGONA O'ZGARMAS INLINE MENYU
// ==========================================
async function showMainMenu(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  session.step = 'mainMenu';

  const trimStatus = session.isTrimmed ? `✅ ${session.trimStart}s dan +30s` : "❌ Tanlanmadi";
  const text = `🎧 **MUSIQA BOSHQARUV PANELI**\n\n` +
               `🎵 **Nomi:** ${session.customTitle}\n` +
               `⏱ **30s Kesish:** ${trimStatus}\n\n` +
               `Kerakli amalni tanlang:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⏱ 30 sekund (Kesish)", `menu_trim30_${chatId}`)],
    [Markup.button.callback("🎛 Effektlarni birma-bir tanlash", `menu_custom_fx_${chatId}`)],
    [Markup.button.callback("🚀 TAYYOR (Kanalga Joylash)", `process_final_${chatId}`)]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// ⏱ 30 sekund tugmasi bosilganda
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

// EFFEKTLARNI BIRMA-BIR TANLASH VIZARDI
bot.action(/menu_custom_fx_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const session = pendingSessions[chatId];
  if (!session) return;

  startEffectsWizard(ctx, chatId);
});

bot.action(/process_final_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  addToQueue(() => processAndSendFinalAudio(ctx, chatId));
});

async function startEffectsWizard(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  session.step = 'effects';
  session.currentEffectIndex = 0;
  await askNextEffect(ctx, chatId);
}

async function askNextEffect(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const index = session.currentEffectIndex;

  // Barcha effektlar ko'rib chiqilgan bo'lsa, asosiy menyuga qaytamiz
  if (index >= AUDIO_EFFECTS.length) {
    showMainMenu(ctx, chatId);
    return;
  }

  const effect = AUDIO_EFFECTS[index];
  const text = `🎛 **Effekt qo'shamizmi? (${index + 1}/${AUDIO_EFFECTS.length})**\n\n📌 **${effect.title}**`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Ha", `fx_yes_${chatId}`),
      Markup.button.callback("❌ Yo'q", `fx_no_${chatId}`)
    ],
    [Markup.button.callback("⬅️ Menyuga qaytish", `menu_back_${chatId}`)]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

bot.action(/fx_(yes|no)_(.+)/, async (ctx) => {
  const choice = ctx.match[1];
  const chatId = ctx.match[2];
  const session = pendingSessions[chatId];

  if (!session) return;

  const currentEffect = AUDIO_EFFECTS[session.currentEffectIndex];
  session.selectedEffects[currentEffect.key] = (choice === 'yes');

  session.currentEffectIndex += 1;
  await askNextEffect(ctx, chatId);
});

// ==========================================
// 6. AUDIO ISHLOV BERISH VA CHATNI TOZALASH
// ==========================================
async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);

  const chosenTitles = AUDIO_EFFECTS
    .filter(eff => session.selectedEffects[eff.key])
    .map(eff => eff.title.split(' ')[1] || eff.title);

  const appliedFxText = chosenTitles.length > 0 
    ? chosenTitles.join(', ')
    : "Standart";

  const loadingText = `⚡️ **Musiqa navbatda va qayta ishlanmoqda...**\n🎛 *Qo'shilgan effektlar:* ${appliedFxText}`;
  
  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, loadingText, {
    parse_mode: 'Markdown',
    ...loadingText // eslint-disable-line
  }).catch(() => {});

  try {
    const duration = await getAudioDuration(session.rawPath);

    let trimmedAudioPath = null;
    if (session.isTrimmed) {
      trimmedAudioPath = path.join(tempDir, `snippet_${Date.now()}.mp3`);
      const tempTrimmed = path.join(tempDir, `raw_trim_${Date.now()}.mp3`);

      await trimAudio(session.rawPath, tempTrimmed, session.trimStart, session.trimDuration);
      await applyCustomAudioEffects(tempTrimmed, trimmedAudioPath, session.selectedEffects, session.trimDuration);
      await cleanAndInjectMetadata(trimmedAudioPath, " ");

      if (fs.existsSync(tempTrimmed)) fs.unlinkSync(tempTrimmed);
    }

    const processedFxPath = path.join(tempDir, `fx_${Date.now()}.mp3`);
    const fullAudioPath = path.join(tempDir, `full_${Date.now()}.mp3`);

    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.selectedEffects, duration);
    await processAudioWithVoiceTag(processedFxPath, fullAudioPath, session.startTagPath, session.endTagPath);
    const updatedTitle = await cleanAndInjectMetadata(fullAudioPath, session.customTitle);
    const coverPath = getCoverPath();

    // Hamma ish yakunlangach, inline menyuni o'chiramiz
    await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

    if (session.isTrimmed && trimmedAudioPath && fs.existsSync(trimmedAudioPath)) {
      await ctx.telegram.sendAudio(
        chatId,
        { source: trimmedAudioPath },
        { title: " ", performer: " " }
      );
      fs.unlinkSync(trimmedAudioPath);
    }

    // "BARABANNI AYLANTIR" inline tugmasi olib tashlandi (reply_markup olib tashlandi)
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
