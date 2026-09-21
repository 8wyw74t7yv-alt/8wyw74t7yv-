const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');
const { setAutoReactions } = require('./services/telegram');
const { downloadMedia, downloadAudioWithTag } = require('./services/downloader'); // Yangi yuklovchi servis

const bot = new Telegraf(config.botToken);

// Gemini AI sozlamasi
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY });

const pendingSessions = {};
const urlCache = new Map(); // Takroriy yuklanishlarni oldini olish uchun kesh
const userCooldown = new Map(); // Spam va timeout cheklovi uchun

// Havola (URL) tekshirish uchun Regex
const URL_REGEX = /(https?:\/\/(?:www\.)?(?:instagram\.com|youtube\.com|youtu\.be|tiktok\.com)\S+)/i;

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

// ==========================================
// 1. REELS, SHORTS VA TIKTOK MEDIA YUKLOVCHI MANTIQ
// ==========================================
bot.on('message', async (ctx, next) => {
  const msg = ctx.message;
  if (!msg || !msg.text) return next();

  const match = msg.text.match(URL_REGEX);

  // Agar xabarda Instagram, YouTube yoki TikTok havolasi bo'lsa
  if (match) {
    const url = match[0];
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // 1. Timeout / Rate-limit tekshiruvi (15 soniya ichida qayta yuborishni cheklash)
    const lastRequest = userCooldown.get(userId);
    if (lastRequest && Date.now() - lastRequest < 15000) {
      const warnMsg = await ctx.reply("⚠️ Iltimos, keyingi havolani yuborishdan oldin 15 soniya kuting!");
      setTimeout(() => ctx.telegram.deleteMessage(chatId, warnMsg.message_id).catch(() => {}), 5000);
      await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
      return;
    }
    userCooldown.set(userId, Date.now());

    // 2. Foydalanuvchining asl havolasini chatdan o'chirish
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});

    // 3. Inline tugmali vaqtinchalik xabar chiqarish
    const menuMsg = await ctx.reply(
      "🎬 **Media yuklash menyusi**\n\nQuyidagi tugmalardan birini tanlang:",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("🎬 Videosini yuklash", `dl_video_${Date.now()}`),
            Markup.button.callback("🎵 Musiqasini yuklash", `dl_audio_${Date.now()}`)
          ]
        ])
      }
    );

    // Keshga havola ma'lumotlarini vaqtinchalik saqlaymiz
    urlCache.set(`dl_video_${Date.now()}`, { url, chatId, menuMessageId: menuMsg.message_id, type: 'video' });
    urlCache.set(`dl_audio_${Date.now()}`, { url, chatId, menuMessageId: menuMsg.message_id, type: 'audio' });

    return; // Media havola bo'lgani uchun Gemini AI bo'limiga O'TMAYDI
  }

  return next();
});

// Inline tugmalar bosilganda ishlaydigan Callback Handler
bot.action(/dl_(video|audio)_.+/, async (ctx) => {
  const actionKey = ctx.match[0];
  const item = urlCache.get(actionKey);

  if (!item) {
    await ctx.answerCbQuery("⚠️ So'rov vaqti o'tib ketgan yoki eskirgan.").catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  await ctx.answerCbQuery("⏳ Yuklab olish boshlandi...").catch(() => {});
  const { url, chatId, menuMessageId, type } = item;

  // Menyuni status xabariga o'zgartiramiz
  await ctx.telegram.editMessageText(chatId, menuMessageId, undefined, "⏳ Media qayta ishlanmoqda, kuting...").catch(() => {});

  try {
    const captionText = `<b>@muzxs_bot</b> orqali yuklab olindi 🚀\n\n<i>💬 Botga savol berish uchun <b>@muzxs_bot</b> deb yozing, ChatGPT ishga tushadi!</i>\n\n📌 <i>Guruhlarda Instagram va YouTube'dan video yuklab beradi.</i>`;

    const extraButtons = Markup.inlineKeyboard([
      [Markup.button.url("📲 Do'stlarga ulashish", `https://t.me/share/url?url=https://t.me/muzxs_bot&text=Zo'r%20media%20yuklovchi%20bot!`)]
    ]);

    if (type === 'video') {
      // Videoni yuklash va yuborish (1080p va 100MB limit bilan)
      const videoPath = await downloadMedia(url, 'video');
      await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption: captionText,
          parse_mode: 'HTML',
          ...extraButtons
        }
      );
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    } else if (type === 'audio') {
      // Audioni brendlab, tag va muqova qo'shib yuklash
      const coverPath = getCoverPath();
      const startTagPath = path.join(__dirname, '../assets/voicetag_start.mp3');
      
      const audioPath = await downloadAudioWithTag(url, startTagPath);

      await ctx.replyWithAudio(
        { source: audioPath },
        {
          caption: captionText,
          parse_mode: 'HTML',
          title: "MuzXs Music",
          performer: "-MuzXs",
          ...(coverPath && { thumb: { source: coverPath } }),
          ...extraButtons
        }
      );
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    // Ish yakunlangach, status/menyu xabarini butunlay o'chiramiz
    await ctx.telegram.deleteMessage(chatId, menuMessageId).catch(() => {});

  } catch (error) {
    console.error("Downloader Error:", error);
    await ctx.telegram.editMessageText(chatId, menuMessageId, undefined, "❌ Xatolik yuz berdi! Media hajmi juda katta yoki havola noto'g'ri.").catch(() => {});
    setTimeout(() => ctx.telegram.deleteMessage(chatId, menuMessageId).catch(() => {}), 5000);
  } finally {
    urlCache.delete(actionKey);
  }
});

// ==========================================
// 2. GURUHDAGI XABARLAR UCHUN GEMINI AI MANTIQI
// ==========================================
bot.on('message', async (ctx, next) => {
  const msg = ctx.message;
  if (!msg || !msg.text) return next();

  const chatType = msg.chat.type;

  if (chatType === 'group' || chatType === 'supergroup') {
    try {
      if (msg.from && msg.from.is_bot) return;

      const userMessage = msg.text.toLowerCase();
      const botUsername = ctx.botInfo.username.toLowerCase();

      // Gemini har bir xabarga javob bermaydi!
      // Faqat botga murojaat qilinganda (reply) yoki kalit so'zlar bo'lganda ishlaydi
      const isRepliedToBot = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.id === ctx.botInfo.id;
      const isMentioned = userMessage.includes(`@${botUsername}`) || userMessage.startsWith('bot') || userMessage.startsWith('chatgpt') || userMessage.startsWith('gpt');

      if (!isRepliedToBot && !isMentioned) return next();

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: msg.text,
        config: {
          systemInstruction: "Siz Telegram guruhidagi aqlli, do'stona va yordamchi sun'iy intellekt botisiz. Sizning egangiz @muz_xs-Ruslan buni esingizdan chiqarmang, va hamma javob oxirida aytib turing. Berilgan savollarga qisqa, tushunarli va o'zbek tilida javob bering."
        }
      });

      const aiReply = response.text;

      await ctx.reply(aiReply, {
        reply_to_message_id: msg.message_id
      });
      return;
    } catch (error) {
      console.error("Gemini AI xatoligi:", error);
    }
  }

  return next();
});

// Admin yoki boshqa shaxsiy xabarlar uchun umumiy filter
bot.use(async (ctx, next) => {
  const fromId = ctx.from ? ctx.from.id : null;
  if (ctx.channelPost) return next();
  if (fromId === config.adminId) return next();
  return;
});

bot.start((ctx) => {});
bot.help((ctx) => {});

// ==========================================
// 3. KANALDA MUSIQANI BOSHQARISH MANTIQI
// ==========================================
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id;
  const session = pendingSessions[chatId];

  if (post.text && session) {
    const text = post.text.trim();
    const userMessageId = post.message_id;

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

        await ctx.telegram.sendAudio(
          chatId,
          { source: trimmedPath },
          { title: " ", performer: " " }
        );

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
    await ctx.deleteMessage().catch(() => {});
    await processAndSendFinalAudio(ctx, chatId, session.rawPath, session.customTitle, session.startTagPath, session.endTagPath);
    delete pendingSessions[chatId];
  } else if (action === 'yes') {
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
      await ctx.telegram.deleteMessage(ctx.chat.id, notifyMsg.message_id).catch(() => {});
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
  console.log("MuzXs Bot muvaffaqiyatli ishga tushdi va tayyor.");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
