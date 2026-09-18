const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');
const { setAutoReactions } = require('./services/telegram');

const bot = new Telegraf(config.botToken);

// Sessiyalar va vaqtinchalik jarayonlarni saqlash uchun xotira
const pendingSessions = {};

// XAVFSIZLIK: Barcha kiruvchi xabarlar uchun tekshiruv (Faqat ADMIN_ID uchun)
bot.use(async (ctx, next) => {
  const fromId = ctx.from ? ctx.from.id : null;
  
  if (ctx.channelPost) {
    return next();
  }

  if (fromId === config.adminId) {
    return next();
  }

  return;
});

bot.start((ctx) => {});
bot.help((ctx) => {});

// Kanalga keladigan barcha postlar (Audio yoki Vaqt matni) shu yerda ushlanadi
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  // 1. Agar foydalanuvchi vaqt yuborgan bo'lsa (Masalan: 90:120)
  if (post.text && session && session.promptMessageId) {
    const text = post.text.trim();
    
    if (text.includes(':')) {
      const parts = text.split(':');
      const startTime = parseInt(parts[0]);
      const endTime = parseInt(parts[1]);

      if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        const errReply = await ctx.telegram.sendMessage(chatId, "❌ Noto'g'ri format! Qaytadan kiriting (Masalan: `130:160`):", { parse_mode: 'Markdown' });
        setTimeout(() => ctx.telegram.deleteMessage(chatId, errReply.message_id).catch(()=>{}), 4000);
        await ctx.telegram.deleteMessage(chatId, post.message_id).catch(() => {});
        return;
      }

      const duration = endTime - startTime;
      const userMessageId = post.message_id;

      // Foydalanuvchi yuborgan vaqt yozilgan xabarni va prompt xabarini o'chiramiz
      await ctx.telegram.deleteMessage(chatId, userMessageId).catch(() => {});
      await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

      const tempDir = path.join(__dirname, '../temp');
      const trimmedPath = path.join(tempDir, `trimmed_${Date.now()}.mp3`);

      // Jonli kutish effekti
      let loadingMsg = await ctx.telegram.sendMessage(chatId, "⏳ Musiqa kesilmoqda 🔄");
      const loadingAnimation = ['⏳ Musiqa kesilmoqda 🔄', '⌛️ Musiqa kesilmoqda 🔄.', '⏳ Musiqa kesilmoqda 🔄..', '⌛️ Musiqa kesilmoqda 🔄...'];
      let animIndex = 0;

      const interval = setInterval(async () => {
        animIndex = (animIndex + 1) % loadingAnimation.length;
        await ctx.telegram.editMessageText(chatId, loadingMsg.message_id, undefined, loadingAnimation[animIndex]).catch(() => {});
      }, 1500);

      try {
        // Kesish jarayoni
        await trimAudio(session.rawPath, trimmedPath, startTime, duration);

        clearInterval(interval);
        await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

        // 1. Kesilgan musiqani yuborish (Faqat caption bilan)
        await ctx.telegram.sendAudio(
          chatId,
          { source: trimmedPath },
          {
            caption: config.captionTemplate,
            parse_mode: 'HTML'
          }
        );

        // 2. To'liq musiqani yuborish
        const taggedPath = path.join(path.dirname(session.rawPath), `tagged_${Date.now()}.mp3`);
        await processAudioWithVoiceTag(session.rawPath, taggedPath, session.startTagPath, session.endTagPath);
        const updatedTitle = await cleanAndInjectMetadata(taggedPath, session.originalTitle);

        const sentFullMessage = await ctx.telegram.sendAudio(
          chatId,
          { source: taggedPath },
          {
            caption: config.captionTemplate,
            parse_mode: 'HTML',
            title: updatedTitle,
            performer: config.defaultArtist
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

  // 2. Agar post ichida audio bo'lsa
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

      pendingSessions[chatId] = {
        rawPath,
        originalTitle: audio.title || audio.file_name,
        startTagPath,
        endTagPath,
        originalMessageId: messageId
      };

      await ctx.telegram.deleteMessage(chatId, messageId);

      await ctx.telegram.sendMessage(chatId, "🎵 Musiqani kesamizmi?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✂️ Kesamiz", callback_data: `trim_yes_${chatId}` },
              { text: "⏩ Kesmaymiz", callback_data: `trim_no_${chatId}` }
            ]
          ]
        }
      });

    } catch (err) {
      console.error("Processing Error:", err);
    }
  }
});

// Inline tugmalar bosilganda (`Kesamiz` / `Kesmaymiz`)
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
    await ctx.deleteMessage().catch(() => {});
    await processAndSendFinalAudio(ctx, chatId, session.rawPath, session.originalTitle, session.startTagPath, session.endTagPath);
    delete pendingSessions[chatId];

  } else if (action === 'yes') {
    await ctx.editMessageText("⏱ Musiqa kesish uchun vaqt oralig'ini yuboring (Masalan: `130:160` formatida):", {
      parse_mode: 'Markdown'
    });
    session.promptMessageId = queryMessageId;
  }
});

// Kesmaymiz bosilganda ishlaydigan funksiya
async function processAndSendFinalAudio(ctx, chatId, rawPath, originalTitle, startTagPath, endTagPath) {
  const tempDir = path.dirname(rawPath);
  const taggedPath = path.join(tempDir, `tagged_${Date.now()}.mp3`);

  try {
    await processAudioWithVoiceTag(rawPath, taggedPath, startTagPath, endTagPath);
    const updatedTitle = await cleanAndInjectMetadata(taggedPath, originalTitle);

    const sentMessage = await ctx.telegram.sendAudio(
      chatId,
      { source: taggedPath },
      {
        caption: config.captionTemplate,
        parse_mode: 'HTML',
        title: updatedTitle,
        performer: config.defaultArtist
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
    [rawPath, taggedPath].forEach(p => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
}

bot.launch().then(() => {
  console.log("MuzXs Bot muvaffaqiyatli ishga tushdi.");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
