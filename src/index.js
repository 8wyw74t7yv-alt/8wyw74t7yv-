const { Telegraf } = require('telegraf');
const { GoogleGenAI } = require('@google/genai'); // Gemini AI uchun qo'shildi
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');
const { setAutoReactions } = require('./services/telegram');

const bot = new Telegraf(config.botToken);

// Gemini AI ni sozlash (API kalit config yoki environment'dan olinadi)
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY });

const pendingSessions = {};

// Cover rasm yo'lini topish yordamchi funksiyasi
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

bot.use(async (ctx, next) => {
  const fromId = ctx.from ? ctx.from.id : null;
  // Agar guruhdan xabar kelsa yoki admin yozsa o'tkazib yuboramiz (Gemini uchun guruh xabarlarini tutamiz)
  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) return next();
  if (ctx.channelPost) return next();
  if (fromId === config.adminId) return next();
  return;
});

bot.start((ctx) => {});
bot.help((ctx) => {});

// ==========================================
// GEMINI AI GURUHDA ISHLASH MANTIQI (YANGI)
// ==========================================
bot.on('message', async (ctx, next) => {
  const msg = ctx.message;
  if (!msg || !msg.text) return next();

  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  // Faqat guruh va superguruhlarda ishlashi uchun
  if (chatType === 'group' || chatType === 'supergroup') {
    try {
      // Botning o'z xabariga javob bermasligi uchun
      if (msg.from && msg.from.is_bot) return;

      const userMessage = msg.text;

      // Gemini AI orqali javob generatsiya qilish
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userMessage,
        config: {
          systemInstruction: "Siz Telegram guruhidagi aqlli, do'stona va yordamchi sun'iy intellekt botisiz. Berilgan savollarga qisqa, tushunarli va o'zbek tilida javob bering."
        }
      });

      const aiReply = response.text;

      // Guruhdagi xabarga reply tarzida yuborish
      await ctx.reply(aiReply, {
        reply_to_message_id: msg.message_id
      });

    } catch (error) {
      console.error("Gemini AI xatoligi:", error);
    }
  }
  
  return next();
});

// ==========================================
// ASOSIY MUSIQA BOTI MANTIQI (O'ZGARISHSIZ)
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

    // 1. Musiqa tashlangandan keyin BIRINCHI NAVBATDA title so'ralgandagi holat:
    if (session.waitingForTitle) {
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

      // Title oxiriga 🎧 qo'shib saqlab qo'yamiz
      session.customTitle = `${text} 🎧`;
      session.waitingForTitle = false;

      // Endi tugmalarni chiqaramiz: Kesamiz / Kesmaymiz
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

    // 2. "Kesamiz" bosilgandan keyin VAQT ORALIG'I yuborilgandagi holat:
    if (session.waitingForTrimTime && text.includes(':')) {
      const parts = text.split(':');
      const startTime = parseInt(parts[0]);
      const endTime = parseInt(parts[1]);

      if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        const errReply = await ctx.telegram.sendMessage(chatId, "❌ Noto'g'ri format! Qaytadan kiriting (Masalan: `130:160`):", { parse_mode: 'Markdown' });
        setTimeout(() => ctx.telegram.deleteMessage(chatId, errReply.message_id).catch(()=>{}), 4000);
        await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
        return;
      }

      const duration = endTime - startTime;

      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

      const tempDir = path.join(__dirname, '../temp');
      const trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp3`);

      let loadingMsg = await ctx.telegram.sendMessage(chatId, "⏳ Musiqa kesilmoqda 🔄");
      const loadingAnimation = ['⏳ Musiqa kesilmoqda 🔄', '⌛️ Musiqa kesilmoqda 🔄.', '⏳ Musiqa kesilmoqda 🔄..', '⌛️ Musiqa kesilmoqda 🔄...'];
      let animIndex = 0;

      const interval = setInterval(async () => {
        animIndex = (animIndex + 1) % loadingAnimation.length;
        await ctx.telegram.editMessageText(chatId, loadingMsg.message_id, undefined, loadingAnimation[animIndex]).catch(() => {});
      }, 1500);

      try {
        await trimAudio(session.rawPath, trimmedPath, startTime, duration);

        clearInterval(interval);
        await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        // Tepadagi kesilgan musiqa (bo'sh title/performer bilan)
        await ctx.telegram.sendAudio(
          chatId,
          { source: trimmedPath },
          {
            title: " ",
            performer: " "
          }
        );

        // Pastdagi to'liq musiqa (foydalanuvchi kiritgan custom title bilan)
        const taggedPath = path.join(path.dirname(session.rawPath), `tagged_${Date.now()}.mp3`);
        await processAudioWithVoiceTag(session.rawPath, taggedPath, session.startTagPath, session.endTagPath);
        const updatedTitle = await cleanAndInjectMetadata(taggedPath, session.customTitle);
        const coverPath = getCoverPath();

        const sentFullMessage = await ctx.telegram.sendAudio(
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

        await setAutoReactions(ctx.telegram, chatId, sentFullMessage.message_id);

        const notifyMsg = await ctx.telegram.sendMessage(chatId, `🎧 ${config.channelUsername} kanaliga tahrirlab joyladim✅`);
        setTimeout(async () => {
          await ctx.telegram.deleteMessage(chatId, notifyMsg.message_id).catch(() => {});
        }, 5000);

        [trimmedPath, taggedPath, session.rawPath].forEach(p => {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });

        delete pendingSessions[chatId];

      } catch (err) {
        clearInterval(interval);
        console.error("Trim & Process Error:", err);
        await ctx.telegram.sendMessage(chatId, "❌ Xatolik yuz berdi! Musiqani kesib bo'lmadi.");
      }
      return;
    }
  }

  // Musiqa kelganda birinchi bo'lib title so'raymiz
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

      // Eski musiqaning o'zini o'chiramiz
      await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});

      // Sessionalarni saqlaymiz va title so'rashni boshlaymiz
      const promptMsg = await ctx.telegram.sendMessage(chatId, "✍️ Musiqa uchun **title (nom)** yuboring:", {
        parse_mode: 'Markdown'
      });

      pendingSessions[chatId] = {
        rawPath,
        startTagPath,
        endTagPath,
        waitingForTitle: true,
        promptMessageId: promptMsg.message_id
      };

    } catch (err) {
      console.error("Processing Error:", err);
    }
  }
});

bot.action(/trim_(yes|no)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const chatId = ctx.match[2];
  const session = pendingSessions[chatId];
  const queryMessageId = ctx.callbackQuery.message.message_id;

  if (!session) {
    await ctx.answerCbQuery("⚠️ Ma'lumot topilmadi yoki eskirgan.").catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  await ctx.answerCbQuery().catch(() => {});

  if (action === 'no') {
    // Kesmaymiz bosilsa, to'g'ridan-to'g'ri o'sha kiritilgan custom title bilan yuboramiz
    await ctx.deleteMessage().catch(() => {});
    await processAndSendFinalAudio(ctx, chatId, session.rawPath, session.customTitle, session.startTagPath, session.endTagPath);
    delete pendingSessions[chatId];

  } else if (action === 'yes') {
    // Kesamiz bosilsa, vaqt oralig'ini so'raymiz
    session.waitingForTrimTime = true;
    await ctx.editMessageText("⏱ Musiqa kesish uchun vaqt oralig'ini yuboring (Masalan: `130:160` formatida):", {
      parse_mode: 'Markdown'
    });
    session.promptMessageId = queryMessageId;
  }
});

async function processAndSendFinalAudio(ctx, chatId, rawPath, customTitle, startTagPath, endTagPath) {
  const tempDir = path.dirname(rawPath);
  const taggedPath = path.join(tempDir, `tagged_${Date.now()}.mp3`);

  try {
    await processAudioWithVoiceTag(rawPath, taggedPath, startTagPath, endTagPath);
    const updatedTitle = await cleanAndInjectMetadata(taggedPath, customTitle);
    const coverPath = getCoverPath();

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

    await setAutoReactions(ctx.telegram, chatId, sentMessage.message_id);

    const notifyMsg = await ctx.telegram.sendMessage(chatId, `🎧 ${config.channelUsername} kanaliga tahrirlab joyladim✅`);
    setTimeout(async () => {
      await ctx.telegram.deleteMessage(chatId, notifyMsg.message_id).catch(() => {});
    }, 5000);

  } catch (err) {
    console.error("Process Error:", err);
  } finally {
    [rawPath, taggedPath].filter(Boolean).forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
}

bot.launch().then(() => {
  console.log("MuzXs Bot muvaffaqiyatli ishga tushdi.");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
