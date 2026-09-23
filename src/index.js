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

// So'raladigan effektlar ro'yxati va ularning FFmpeg filtrlari
const AUDIO_EFFECTS = [
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
      const dur = duration || 180; // Standart taxminiy vaqt (agar topilmasa)
      const fadeOutStart = Math.max(0, dur - 3);
      return `afade=t=in:ss=0:d=2,afade=t=out:st=${fadeOutStart}:d=3`;
    }
  },
  {
    key: 'voiceIsolator',
    title: '🎤 Voice Isolator (Faqat qo\'shiqchi vokalini qoldirish)',
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

// Audio davomiyligini aniqlash yordamchi funksiyasi
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

// Inline tugma bosilganda callback so'rovni yopish
bot.on('callback_query', async (ctx, next) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (error) {
    console.error("Callback query error:", error);
  }
  return next();
});

bot.start((ctx) => ctx.reply("MuzXs Music Automation Bot ishga tushgan. Channel postlarini kuzatmoqda."));
bot.help((ctx) => ctx.reply("Ushbu bot Telegram kanalingizda musiqalarni avtomatik tahrirlab beradi."));

// ==========================================
// KANALDA MUSIQANI BOSHQARISH MANTIQI
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  // A) Text kelganda (Nom yoki Kesish vaqti kiritilayotgan bo'lsa)
  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

    // Musiqa nomi (Title) kiritilmoqda
    if (session.waitingForTitle) {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

      session.customTitle = `${text} 🎧`;
      session.waitingForTitle = false;

      const promptMsg = await ctx.telegram.sendMessage(chatId, "🎵 Musiqani kesamizmi?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✂️ Kesamiz", callback_data: `trim_yes_${chatId}` },
              { text: "⏩ Kesmaymiz", callback_data: `trim_no_${chatId}` }
            ]
          ]
        }
      });
      session.promptMessageId = promptMsg.message_id;
      return;
    }

    // Musiqa kesish vaqti kiritilmoqda
    if (session.waitingForTrimTime && text.includes(':')) {
      const parts = text.split(':');
      const startTime = parseInt(parts[0]);
      const endTime = parseInt(parts[1]);

      if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        const errReply = await ctx.telegram.sendMessage(chatId, "❌ Noto'g'ri format! Qaytadan kiriting (Masalan: `130:160`):", { parse_mode: 'Markdown' });
        setTimeout(() => ctx.telegram.deleteMessage(chatId, errReply.message_id).catch(() => {}), 4000);
        await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
        return;
      }

      const duration = endTime - startTime;

      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

      const tempDir = path.join(__dirname, '../temp');
      const trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp3`);

      const loadingMsg = await ctx.telegram.sendMessage(chatId, "⏳ Musiqa kesilmoqda... 🔄");

      try {
        await trimAudio(session.rawPath, trimmedPath, startTime, duration);
        await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        // Asl rawPath ni kesilgan fayl yo'li bilan almashtiramiz
        if (fs.existsSync(session.rawPath)) fs.unlinkSync(session.rawPath);
        session.rawPath = trimmedPath;

        // Effektlar so'rovnomasini boshlash
        session.waitingForTrimTime = false;
        startEffectsWizard(ctx, chatId);

      } catch (err) {
        await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        console.error("Trim Error:", err);
        await ctx.telegram.sendMessage(chatId, "❌ Xatolik yuz berdi! Musiqani kesib bo'lmadi.");
      }
      return;
    }
  }

  // B) Kanalga yangi audio fayl tashlanganda
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

      const promptMsg = await ctx.telegram.sendMessage(chatId, "✍️ Musiqa uchun **title (nom)** yuboring:", {
        parse_mode: 'Markdown'
      });

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        waitingForTitle: true,
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
    await ctx.deleteMessage().catch(() => {});
    // Direct effektlar so'rovnomasiga o'tamiz
    startEffectsWizard(ctx, chatId);
  } else if (action === 'yes') {
    session.waitingForTrimTime = true;
    await ctx.editMessageText("⏱ Musiqa kesish uchun vaqt oralig'ini yuboring (Masalan: `130:160` formatida):", {
      parse_mode: 'Markdown'
    });
    session.promptMessageId = ctx.callbackQuery.message.message_id;
  }
});

// ==========================================
// EFFEKTLAR INTERAKTIV SO'ROVNOMASI (WIZARD)
// ==========================================
async function startEffectsWizard(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  session.currentEffectIndex = 0;
  await askNextEffect(ctx, chatId);
}

async function askNextEffect(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const index = session.currentEffectIndex;

  if (index >= AUDIO_EFFECTS.length) {
    // Barcha savollar tugadi - Musiqani qayta ishlashni boshlaymiz
    if (session.promptMessageId) {
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});
    }
    await processAndSendFinalAudio(ctx, chatId);
    return;
  }

  const effect = AUDIO_EFFECTS[index];
  const text = `🎛 **Musiqaga ushbu effektni qo'shamizmi?**\n\n📌 **${effect.title}**`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Ha", `fx_yes_${chatId}`),
      Markup.button.callback("❌ Yo'q", `fx_no_${chatId}`)
    ]
  ]);

  if (session.promptMessageId) {
    await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
      parse_mode: 'Markdown',
      ...keyboard
    }).catch(async () => {
      const msg = await ctx.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown', ...keyboard });
      session.promptMessageId = msg.message_id;
    });
  } else {
    const msg = await ctx.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown', ...keyboard });
    session.promptMessageId = msg.message_id;
  }
}

// Effektlar tugmalari bosilganda (Ha / Yo'q)
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
// YAKUNIY AUDIO QAYTA ISHLASH VA CHIQARISH
// ==========================================
async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);
  const processedFxPath = path.join(tempDir, `fx_${Date.now()}.mp3`);
  const taggedPath = path.join(tempDir, `tagged_${Date.now()}.mp3`);

  const loadingMsg = await ctx.telegram.sendMessage(chatId, "🎛 Musiqaga tanlangan effektlar berilmoqda va ishlov berilmoqda... ⏳");

  try {
    const duration = await getAudioDuration(session.rawPath);

    // 1. Tanlangan FFmpeg effektlarini qo'llash
    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.selectedEffects, duration);

    // 2. Voice tag qo'shish (Start/End)
    await processAudioWithVoiceTag(processedFxPath, taggedPath, session.startTagPath, session.endTagPath);

    // 3. ID3 metadata va cover qo'shish
    const updatedTitle = await cleanAndInjectMetadata(taggedPath, session.customTitle);
    const coverPath = getCoverPath();

    await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

    // 4. Kanalga tayyor musiqani yuborish
    const sentMessage = await ctx.telegram.sendAudio(
      chatId,
      { source: taggedPath },
      {
        caption: config.captionTemplate,
        parse_mode: 'HTML',
        title: updatedTitle,
        performer: config.defaultArtist,
        ...(coverPath && { thumb: { source: coverPath } })
      }
    );

    const notifyMsg = await ctx.telegram.sendMessage(chatId, `🎧 ${config.channelUsername} kanaliga tahrirlab joyladim ✅`);
    setTimeout(async () => {
      await ctx.telegram.deleteMessage(chatId, notifyMsg.message_id).catch(() => {});
    }, 5000);

  } catch (err) {
    console.error("Process Error:", err);
    await ctx.telegram.sendMessage(chatId, "❌ Musiqaga ishlov berishda xatolik yuz berdi!");
  } finally {
    await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    [session.rawPath, processedFxPath, taggedPath].forEach(p => {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    });
    delete pendingSessions[chatId];
  }
}

bot.launch().then(() => {
  console.log("MuzXs Music Automation Bot muvaffaqiyatli ishga tushdi va tayyor.");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
