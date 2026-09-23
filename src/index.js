const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');

const bot = new Telegraf(config.botToken);

// Kanal postlari uchun aktiv seanslar
const pendingSessions = {};

// So'raladigan effektlar ro'yxati (Slowed va Reverb/Echo alohida qilindi)
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

bot.start((ctx) => ctx.reply("MuzXs Music Automation Bot ishga tushgan."));
bot.help((ctx) => ctx.reply("Ushbu bot Telegram kanalingizda musiqalarni avtomatik tahrirlab beradi."));

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

      // Xabarni yangilaymiz (yangi xabar ochilmaydi)
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

      const duration = endTime - startTime;
      const tempDir = path.join(__dirname, '../temp');
      const trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp3`);

      try {
        await trimAudio(session.rawPath, trimmedPath, startTime, duration);
        if (fs.existsSync(session.rawPath)) fs.unlinkSync(session.rawPath);
        session.rawPath = trimmedPath;
        session.isTrimmed = true; // Bu kesilgan musiqa ekanini belgilaymiz

        startEffectsWizard(ctx, chatId);
      } catch (err) {
        console.error("Trim Error:", err);
      }
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

      // Asl yuborilgan audio xabarni o'chiramiz
      await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});

      // Yagona boshqaruv xabarini yaratamiz
      const promptMsg = await ctx.telegram.sendMessage(chatId, "✍️ **Musiqa uchun nom (title) yuboring:**", {
        parse_mode: 'Markdown'
      });

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        isTrimmed: false, // Dastlab to'liq deb belgilanadi
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
// YAKUNIY PROCESS
// ==========================================
async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);
  const processedFxPath = path.join(tempDir, `fx_${Date.now()}.mp3`);
  const finalAudioPath = path.join(tempDir, `final_${Date.now()}.mp3`);

  // Tanlangan effektlar ro'yxatini shakllantirish
  const chosenTitles = AUDIO_EFFECTS
    .filter(eff => session.selectedEffects[eff.key])
    .map(eff => eff.title.split(' ')[1] || eff.title);

  const appliedFxText = chosenTitles.length > 0 
    ? chosenTitles.join(', ')
    : "Standart";

  // Qisqa va emojili yuklanish xabari
  const loadingText = `⚡️ **Musiqa tayyorlanmoqda...**\n🎛 *Qo'shildi:* ${appliedFxText}`;
  
  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, loadingText, {
    parse_mode: 'Markdown'
  }).catch(() => {});

  try {
    const duration = await getAudioDuration(session.rawPath);

    // 1. Tanlangan effektlarni berish
    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.selectedEffects, duration);

    // 2. Voice tag faqat TO'LIQ (kesilmagan) musiqaga qo'shiladi
    if (!session.isTrimmed) {
      await processAudioWithVoiceTag(processedFxPath, finalAudioPath, session.startTagPath, session.endTagPath);
    } else {
      // Kesilgan musiqaga voice tag kerak emas, shunchaki nusxalaymiz
      fs.copyFileSync(processedFxPath, finalAudioPath);
    }

    // 3. Metadata va to'liq ma'lumotlarni sozlash
    let updatedTitle = session.customTitle;
    let coverPath = null;
    let caption = config.captionTemplate;
    let performer = config.defaultArtist;

    if (session.isTrimmed) {
      // Kesilgan musiqa uchun: barcha metadatalar bo'sh (bo'sh joy), cover va caption yo'q
      await cleanAndInjectMetadata(finalAudioPath, " ");
      updatedTitle = " ";
      performer = " ";
      caption = undefined;
      coverPath = null;
    } else {
      // To'liq musiqa uchun: barcha ma'lumotlar va cover o'z joyida
      updatedTitle = await cleanAndInjectMetadata(finalAudioPath, session.customTitle);
      coverPath = getCoverPath();
    }

    // 4. Boshqaruv so'rovnoma xabarini kanal chatidan sezdirilmasdan o'chirish
    await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

    // 5. Tayyor musiqani kanalga yuborish
    await ctx.telegram.sendAudio(
      chatId,
      { source: finalAudioPath },
      {
        ...(caption && { caption, parse_mode: 'HTML' }),
        title: updatedTitle,
        performer: performer,
        ...(coverPath && { thumb: { source: coverPath } })
      }
    );

  } catch (err) {
    console.error("Process Error:", err);
    await ctx.telegram.sendMessage(chatId, "❌ Ishlov berishda xatolik yuz berdi!").catch(() => {});
  } finally {
    [session.rawPath, processedFxPath, finalAudioPath].forEach(p => {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    });
    delete pendingSessions[chatId];
  }
}

bot.launch().then(() => console.log("MuzXs Bot tayyor va ishlamoqda."));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
