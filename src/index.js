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
// Mini App html/css/js fayllarini static tarqatish
app.use(express.static(path.join(__dirname, '../public')));

// Referral va User holatini saqlash
const userDb = new Map();

function getUser(userId) {
  if (!userDb.has(userId)) {
    userDb.set(userId, { referrals: new Set() });
  }
  return userDb.get(userId);
}

// BOTGA SHAXSIYDA YOZILGANDA JAVOB BERMASLIK (Lekin referral va deep linklarni ushlash)
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type === 'private') {
    // Agar start xabari va referral deep link bo'lsa, xafvsiz referralni qayd etamiz
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
      const parts = ctx.message.text.split(' ');
      if (parts.length > 1 && parts[1].startsWith('ref_')) {
        const userId = ctx.from.id;
        const referrerId = parseInt(parts[1].split('_')[1], 10);

        if (referrerId && referrerId !== userId) {
          const referrerData = getUser(referrerId);
          referrerData.referrals.add(userId);
        }
      }
    }
    // Shaxsiy chatda bot HECH QANDAY javob qaytarmaydi
    return;
  }
  return next();
});

// Backend API: Mini App uchun bot username'ini qaytarish
app.get('/api/get-bot-info', (req, res) => {
  res.json({ username: bot.botInfo ? bot.botInfo.username : '' });
});

// Kanal postlari uchun aktiv seanslar
const pendingSessions = {};

// So'raladigan effektlar ro'yxati (Slowed va Reverb/Echo alohida)
const AUDIO_EFFECTS = [
  {
    key: 'slowed',
    title: '🐌 Slowed (Musiqani biroz sekinlashtirish)',
    filter: 'atempo=0.92'
  },
  {
    key: 'bassBoost',
    title: '🔊 Bass Boost (Gumburlash)',
    filter: 'equalizer=f=60:width_type=h:width=50:g=10'
  },
  {
    key: 'noiseReduction',
    title: '🧹 Shovqinni tozalash (Noise Reduction)',
    filter: 'afftdn=nr=12:nf=-25'
  },
  {
    key: 'ebuNormalization',
    title: '📊 Avtomatik EBU R128 (-14 LUFS balandlik tenglashtirish)',
    filter: 'loudnorm=I=-14:LRA=11:TP=-1.5'
  },
  {
    key: 'smoothFade',
    title: '🎚 Smooth Fade-in & Fade-out (Yumshoq boshlanish va tugash)',
    dynamicFilter: (duration) => {
      const dur = duration || 180;
      const fadeOutStart = Math.max(0, dur - 3);
      return `afade=t=in:ss=0:d=2,afade=t=out:st=${fadeOutStart}:d=3`;
    }
  },
  {
    key: 'voiceIsolator',
    title: '🎤 Voice Isolator (Faqat qo\'shiqchi ovozini qoldirish)',
    filter: 'pan=stereo|c0=c0-c1|c1=c0-c1'
  },
  {
    key: 'eightD',
    title: '🎧 8D Audio (Ovozni chap va o\'ng quloqqa tebrantirish)',
    filter: 'apulsator=hz=0.125:amount=1'
  },
  {
    key: 'reverbEcho',
    title: '🏛 Reverb & Echo (Konsert zali aks-sadosi)',
    filter: 'aecho=0.8:0.88:60:0.4'
  }
];

// Cover rasm yo'lini topish
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

// Audio davomiyligini aniqlash
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

// Tanlangan FFmpeg effektlarini qo'llash
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
// KANALDA MUSIQANI BOSHQARISH MANTIQI
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  // A) Text kelganda (Nom yoki Kesish vaqti)
  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

    // 1. Musiqa nomi (Title) kiritilganda
    if (session.step === 'waitingForTitle') {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});

      session.customTitle = `${text} 🎧`;
      session.step = 'askTrim';

      const textTrim = "🎵 **Musiqani kesamizmi?**";
      const keyboardTrim = Markup.inlineKeyboard([
        [
          Markup.button.callback("✂️ Kesamiz", `trim_yes_${chatId}`),
          Markup.button.callback("⏩ Kesmaymiz", `trim_no_${chatId}`)
        ]
      ]);

      await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, textTrim, {
        parse_mode: 'Markdown',
        ...keyboardTrim
      }).catch(() => {});
      return;
    }

    // 2. Musiqa kesish vaqti kiritilganda
    if (session.step === 'waitingForTrimTime' && text.includes(':')) {
      const parts = text.split(':');
      const startTime = parseInt(parts[0]);
      const endTime = parseInt(parts[1]);

      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});

      if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        return;
      }

      session.trimStart = startTime;
      session.trimDuration = endTime - startTime;
      session.isTrimmed = true;

      startEffectsWizard(ctx, chatId);
      return;
    }
  }

  // B) Kanalga yangi audio fayl tushganda
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

      // Asl yuborilgan audio xabarni darhol o'chiramiz
      await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});

      // Yagona boshqaruv xabarini yaratamiz
      const promptMsg = await ctx.telegram.sendMessage(chatId, "✍️ **Musiqa uchun nom (title) yuboring:**", {
        parse_mode: 'Markdown'
      });

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        isTrimmed: false,
        step: 'waitingForTitle',
        promptMessageId: promptMsg.message_id,
        selectedEffects: {},
        currentEffectIndex: 0
      };

    } catch (err) {
      console.error("Audio yuklab olish xatosi:", err);
    }
  }
});

// Kesish tugmalari uchun callback
bot.action(/trim_(yes|no)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const chatId = ctx.match[2];
  const session = pendingSessions[chatId];

  if (!session) return;

  if (action === 'no') {
    session.isTrimmed = false;
    startEffectsWizard(ctx, chatId);
  } else if (action === 'yes') {
    session.isTrimmed = true;
    session.step = 'waitingForTrimTime';
    await ctx.editMessageText("⏱ **Musiqani kesish vaqtini yuboring (Masalan: `130:160`):**", {
      parse_mode: 'Markdown'
    }).catch(() => {});
  }
});

// ==========================================
// EFFEKTLAR WIZARD (Boshqaruv menyusi)
// ==========================================
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

  if (index >= AUDIO_EFFECTS.length) {
    await processAndSendFinalAudio(ctx, chatId);
    return;
  }

  const effect = AUDIO_EFFECTS[index];
  const text = `🎛 **Effekt qo'shamizmi?**\n\n📌 **${effect.title}**`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Ha", `fx_yes_${chatId}`),
      Markup.button.callback("❌ Yo'q", `fx_no_${chatId}`)
    ]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// Effektlar tugmalari (Ha / Yo'q)
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
// YAKUNIY PROCESS (Kesilgan va To'liq musiqani yuborish)
// ==========================================
async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);

  // Tanlangan effektlar ro'yxatini shakllantirish
  const chosenTitles = AUDIO_EFFECTS
    .filter(eff => session.selectedEffects[eff.key])
    .map(eff => eff.title.split(' ')[1] || eff.title);

  const appliedFxText = chosenTitles.length > 0 
    ? chosenTitles.join(', ')
    : "Standart";

  const loadingText = `⚡️ **Musiqa tayyorlanmoqda...**\n🎛 *Qo'shildi:* ${appliedFxText}`;
  
  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, loadingText, {
    parse_mode: 'Markdown'
  }).catch(() => {});

  try {
    const duration = await getAudioDuration(session.rawPath);

    // 1. Agar kesilgan (snippet) kerak bo'lsa
    let trimmedAudioPath = null;
    if (session.isTrimmed) {
      trimmedAudioPath = path.join(tempDir, `snippet_${Date.now()}.mp3`);
      const tempTrimmed = path.join(tempDir, `raw_trim_${Date.now()}.mp3`);

      // Avval kesib olamiz
      await trimAudio(session.rawPath, tempTrimmed, session.trimStart, session.trimDuration);
      // Effektlarni beramiz (Voice tag qo'shilmaydi!)
      await applyCustomAudioEffects(tempTrimmed, trimmedAudioPath, session.selectedEffects, session.trimDuration);
      
      // Metadatalarini bo'shatamiz
      await cleanAndInjectMetadata(trimmedAudioPath, " ");

      if (fs.existsSync(tempTrimmed)) fs.unlinkSync(tempTrimmed);
    }

    // 2. To'liq musiqa uchun jarayon
    const processedFxPath = path.join(tempDir, `fx_${Date.now()}.mp3`);
    const fullAudioPath = path.join(tempDir, `full_${Date.now()}.mp3`);

    // Effektlarni beramiz
    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.selectedEffects, duration);
    // Voice tag qo'shamiz
    await processAudioWithVoiceTag(processedFxPath, fullAudioPath, session.startTagPath, session.endTagPath);
    // Metadata va title qo'shamiz
    const updatedTitle = await cleanAndInjectMetadata(fullAudioPath, session.customTitle);
    const coverPath = getCoverPath();

    // 3. Boshqaruv so'rovnoma xabarini o'chiramiz
    await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

    // 4. A) Agar kesilgan (snippet) bo'lsa, avval uni yuboramiz (faqat audio, metadata bo'sh, rasm va caption yo'q)
    if (session.isTrimmed && trimmedAudioPath && fs.existsSync(trimmedAudioPath)) {
      await ctx.telegram.sendAudio(
        chatId,
        { source: trimmedAudioPath },
        {
          title: " ",
          performer: " "
        }
      );
      fs.unlinkSync(trimmedAudioPath);
    }

    // 4. B) Ketidan to'liq musiqani yuboramiz (caption, cover va voice taglar bilan)
    await ctx.telegram.sendAudio(
      chatId,
      { source: fullAudioPath },
      {
        caption: config.captionTemplate,
        parse_mode: 'HTML',
        title: updatedTitle,
        performer: config.defaultArtist,
        ...(coverPath && { thumb: { source: coverPath } })
      }
    );

  } catch (err) {
    console.error("Process Error:", err);
    await ctx.telegram.sendMessage(chatId, "❌ Ishlov berishda xatolik yuz berdi!").catch(() => {});
  } finally {
    if (session.rawPath && fs.existsSync(session.rawPath)) fs.unlinkSync(session.rawPath);
    delete pendingSessions[chatId];
  }
}

// Server va Botni ishga tushirish
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishga tushdi.`);
  await bot.launch();
  console.log("MuzXs Bot va Express Mini App tayyor va ishlamoqda.");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
