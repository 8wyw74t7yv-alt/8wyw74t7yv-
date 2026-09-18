const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { processAudioWithVoiceTag } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');
const { setAutoReactions } = require('./services/telegram');

const bot = new Telegraf(config.botToken);

// XAVFSIZLIK: Barcha kiruvchi xabarlar uchun tekshiruv (Faqat ADMIN_ID uchun)
bot.use(async (ctx, next) => {
  const fromId = ctx.from ? ctx.from.id : null;
  
  // Kanal postlari (channel_post) bot o'zi ulangan kanallardan keladi
  if (ctx.channelPost) {
    return next();
  }

  // Shaxsiy xabarlarda faqat belgilangan ID bilan ishlaydi
  if (fromId === config.adminId) {
    return next();
  }

  // Begonalarga hech qanday javob va belgi berilmaydi (To'liq yashirin)
  return;
});

// /start yoki boshqa buyruqlarda HECH NARSANi ko'rsatmaslik (Yashirin rejim)
bot.start((ctx) => {});
bot.help((ctx) => {});

// Kanalga musiqa joylanganda ushlab olish (channel_post)
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;

  // Agar post ichida audio bo'lsa
  if (post && post.audio) {
    const chatId = post.chat.id;
    const messageId = post.message_id;
    const audio = post.audio;

    const tempDir = path.join(__dirname, '../temp');
    const assetsDir = path.join(__dirname, '../assets');

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const rawPath = path.join(tempDir, `raw_${audio.file_id}.mp3`);
    const taggedPath = path.join(tempDir, `tagged_${audio.file_id}.mp3`);
    const finalPath = path.join(tempDir, `final_${audio.file_id}.mp3`);

    const startTagPath = path.join(assetsDir, 'voicetag_start.mp3');
    const endTagPath = path.join(assetsDir, 'voicetag_end.mp3');

    try {
      // 1. Fayl havolasini olish va yuklab olish
      const fileLink = await ctx.telegram.getFileLink(audio.file_id);
      const response = await axios({ method: 'get', url: fileLink.href, responseType: 'stream' });
      const writer = fs.createWriteStream(rawPath);

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 2. Audio faylga Voice Taglarni ulash
      await processAudioWithVoiceTag(rawPath, taggedPath, startTagPath, endTagPath);

      // 3. ID3 teglarni (-MuzXs, Title, Album Cover) yangilash va tozalash
      const updatedTitle = await cleanAndInjectMetadata(taggedPath, audio.title || audio.file_name);

      // 4. Asl xabarni kanaldan o'chirish
      await ctx.telegram.deleteMessage(chatId, messageId);

      // 5. Yangilangan va tahrirlangan musiqani kanalga yuborish
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

      // 6. Avtomatik reaksiyalarni (🔥, 🖤, 🎧, ⚡️, 🤙) bosish
      await setAutoReactions(ctx.telegram, chatId, sentMessage.message_id);

    } catch (err) {
      console.error("Processing Error:", err);
    } finally {
      // Vaqtinchalik fayllarni o'chirish (Server xotirasini tejash)
      [rawPath, taggedPath, finalPath].forEach(p => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
    }
  }
});

bot.launch().then(() => {
  console.log("MuzXs Bot muvaffaqiyatli ishga tushdi.");
});

// Resurslarni xavfsiz tozalash
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
