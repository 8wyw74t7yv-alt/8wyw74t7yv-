const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
const config = require('./config');
const { processAudioWithVoiceTag, trimAudio, applyCustomAudioEffects, AUDIO_EFFECTS_LIST } = require('./services/audio');
const { cleanAndInjectMetadata } = require('./services/metadata');

const bot = new Telegraf(config.botToken);
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Bot shaxsiy xabarlarga (Private chat) umuman javob bermaydi
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type === 'private') {
    return; // Jim rejim
  }
  return next();
});

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
    console.error("Navbatda xatolik:", err);
  } finally {
    isProcessingQueue = false;
    processNextInQueue();
  }
}

const pendingSessions = {};

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

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

bot.on('callback_query', async (ctx, next) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (error) {}
  return next();
});

// Kanalga musiqa tashlanganda ishga tushadi
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post || !post.audio) return;

  const chatId = post.chat.id;
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

    // Tanlangan effektlar: { effectKey: intensityValue (0-100) }
    const initialEffects = {};

    const promptMsg = await ctx.telegram.sendMessage(
      chatId, 
      "⚡️ **Musiqa yuklandi! Boshqaruv paneli tayyorlanmoqda...**", 
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
      promptMessageId: promptMsg.message_id,
      selectedEffects: initialEffects, // e.g. { binaural3d: 80, bassBoost: 50 }
      currentPage: 1
    };

    await renderMainMenu(ctx, chatId);

  } catch (err) {
    console.error("Audio yuklab olish xatosi:", err);
  }
});

// ==========================================
// YAGONA BIR MENYU INTERFEYSI (EDIT MESSAGE)
// ==========================================

// 1. Asosiy Menyu Render
async function renderMainMenu(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const activeEffectsCount = Object.keys(session.selectedEffects).length;
  const trimInfo = session.isTrimmed ? `🟢 ${formatTime(session.trimStart)} (30s)` : "🔴 O'chirilgan";

  const text = `🎧 **MUSIQA BOSHQARUV PANELI**\n\n` +
               `🎵 **Nomi:** ${session.customTitle}\n` +
               `⏱ **30s Kesish:** ${trimInfo}\n` +
               `🎛 **Faol effektlar:** ${activeEffectsCount} ta\n\n` +
               `👇 *Quyidagi tugmalar orqali sozlashingiz mumkin:*`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⏱ 30s Kesish Sozlamasi", `nav_trim_${chatId}`),
      Markup.button.callback("🎛 Effektlar (21 ta)", `nav_fx_page_1_${chatId}`)
    ],
    [
      Markup.button.callback("🚀 TAYYOR (Kanalga Joylash)", `process_final_${chatId}`)
    ]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// 2. 30 Soniya Kesish Sozlamasi Menyu
async function renderTrimMenu(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const statusText = session.isTrimmed ? `🟢 Yoqilgan` : `🔴 O'chirilgan`;
  const timeText = formatTime(session.trimStart);

  const text = `⏱ **30 SONIYA KESISH SOZLAMASI**\n\n` +
               `📌 **Holati:** ${statusText}\n` +
               `🕒 **Boshlanish vaqti:** \`${timeText}\` (+30 soniya)\n\n` +
               `*Vaqtni o'zgartirish uchun pastdagi tugmalarni bosing:*`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("➖ 15s", `trim_adj_-15_${chatId}`),
      Markup.button.callback("➖ 5s", `trim_adj_-5_${chatId}`),
      Markup.button.callback("➕ 5s", `trim_adj_+5_${chatId}`),
      Markup.button.callback("➕ 15s", `trim_adj_+15_${chatId}`)
    ],
    [
      Markup.button.callback(session.isTrimmed ? "🔴 Kesishni o'chirish" : "🟢 Kesishni yoqish", `trim_toggle_${chatId}`)
    ],
    [
      Markup.button.callback("⬅️ Bosh Menyu", `nav_main_${chatId}`)
    ]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// 3. Effektlar Ro'yxati (2 sahifaga bo'lingan ixcham 2-ustunli dizayn)
async function renderEffectsMenu(ctx, chatId, page = 1) {
  const session = pendingSessions[chatId];
  if (!session) return;

  session.currentPage = page;
  const itemsPerPage = 10;
  const startIndex = (page - 1) * itemsPerPage;
  const pageEffects = AUDIO_EFFECTS_LIST.slice(startIndex, startIndex + itemsPerPage);

  const buttons = [];
  let row = [];

  pageEffects.forEach((eff) => {
    const intensity = session.selectedEffects[eff.key];
    const isSelected = intensity !== undefined && intensity > 0;
    const badge = isSelected ? `🟢 ${intensity}%` : `🔴`;
    const btnText = `${badge} ${eff.title}`;

    row.push(Markup.button.callback(btnText, `fx_select_${eff.key}_${chatId}`));

    if (row.length === 2) {
      buttons.push(row);
      row = [];
    }
  });
  if (row.length > 0) buttons.push(row);

  // Pagination tugmalari
  const navRow = [];
  if (page > 1) {
    navRow.push(Markup.button.callback("⬅️ 1-Sahifa", `nav_fx_page_1_${chatId}`));
  }
  if (startIndex + itemsPerPage < AUDIO_EFFECTS_LIST.length) {
    navRow.push(Markup.button.callback("2-Sahifa ➡️", `nav_fx_page_2_${chatId}`));
  }
  if (navRow.length > 0) buttons.push(navRow);

  buttons.push([Markup.button.callback("⬅️ Bosh Menyu", `nav_main_${chatId}`)]);

  const text = `🎛 **EFFEKTLAR RO'YXATI (${page}/2)**\n\n` +
               `Effekt ustiga bosib, uning **kuchini (0-100%)** sozlashingiz mumkin:`;

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  }).catch(() => {});
}

// 4. Effekt Kuchini (0-100%) Tanlash Menyu
async function renderEffectDetailMenu(ctx, chatId, effectKey) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const effect = AUDIO_EFFECTS_LIST.find(e => e.key === effectKey);
  if (!effect) return;

  const currentVal = session.selectedEffects[effectKey] || 0;
  const statusBadge = currentVal > 0 ? `🟢 Yoqilgan (${currentVal}%)` : `🔴 O'chirilgan (0%)`;

  const text = `🎛 **EFFEKT SOZLAMASI**\n\n` +
               `✨ **Effekt:** ${effect.title}\n` +
               `📌 **Holati:** ${statusBadge}\n` +
               `📊 **Kuchlilik darajasi:** \`[ ${currentVal}% ]\`\n\n` +
               `0% - o'chirilgan, 100% - maksimal kuchli/tiniq effekt.`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("➖ 20%", `fx_val_${effectKey}_-20_${chatId}`),
      Markup.button.callback("➖ 5%", `fx_val_${effectKey}_-5_${chatId}`),
      Markup.button.callback("➕ 5%", `fx_val_${effectKey}_+5_${chatId}`),
      Markup.button.callback("➕ 20%", `fx_val_${effectKey}_+20_${chatId}`)
    ],
    [
      Markup.button.callback("🔴 0% (O'chirish)", `fx_val_${effectKey}_set0_${chatId}`),
      Markup.button.callback("🔵 50% (Standart)", `fx_val_${effectKey}_set50_${chatId}`),
      Markup.button.callback("🟢 100% (Maksimal)", `fx_val_${effectKey}_set100_${chatId}`)
    ],
    [
      Markup.button.callback("⬅️ Effektlar Ro'yxatiga", `nav_fx_page_${session.currentPage || 1}_${chatId}`)
    ]
  ]);

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, text, {
    parse_mode: 'Markdown',
    ...keyboard
  }).catch(() => {});
}

// ==========================================
// CALLBACK ACTIONS HANDLERS
// ==========================================

// Navigatsiya
bot.action(/nav_main_(.+)/, async (ctx) => renderMainMenu(ctx, ctx.match[1]));
bot.action(/nav_trim_(.+)/, async (ctx) => renderTrimMenu(ctx, ctx.match[1]));
bot.action(/nav_fx_page_(\d+)_(.+)/, async (ctx) => renderEffectsMenu(ctx, ctx.match[2], parseInt(ctx.match[1], 10)));

// Trim Sozlamalari
bot.action(/trim_toggle_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const session = pendingSessions[chatId];
  if (session) {
    session.isTrimmed = !session.isTrimmed;
    renderTrimMenu(ctx, chatId);
  }
});

bot.action(/trim_adj_([+-]\d+)_(.+)/, async (ctx) => {
  const delta = parseInt(ctx.match[1], 10);
  const chatId = ctx.match[2];
  const session = pendingSessions[chatId];
  if (session) {
    session.trimStart = Math.max(0, session.trimStart + delta);
    session.isTrimmed = true;
    renderTrimMenu(ctx, chatId);
  }
});

// Effekt Tanlash va Kuchini O'zgartirish
bot.action(/fx_select_([a-zA-Z0-9]+)_(.+)/, async (ctx) => {
  const effectKey = ctx.match[1];
  const chatId = ctx.match[2];
  renderEffectDetailMenu(ctx, chatId, effectKey);
});

bot.action(/fx_val_([a-zA-Z0-9]+)_([+-]\d+|set0|set50|set100)_(.+)/, async (ctx) => {
  const effectKey = ctx.match[1];
  const action = ctx.match[2];
  const chatId = ctx.match[3];
  const session = pendingSessions[chatId];

  if (session) {
    let current = session.selectedEffects[effectKey] || 0;

    if (action === 'set0') current = 0;
    else if (action === 'set50') current = 50;
    else if (action === 'set100') current = 100;
    else {
      const delta = parseInt(action, 10);
      current = Math.min(100, Math.max(0, current + delta));
    }

    if (current === 0) {
      delete session.selectedEffects[effectKey];
    } else {
      session.selectedEffects[effectKey] = current;
    }

    renderEffectDetailMenu(ctx, chatId, effectKey);
  }
});

// ==========================================
// TAYYOR AMALINI BAJARISH
// ==========================================
bot.action(/process_final_(.+)/, async (ctx) => {
  const chatId = ctx.match[1];
  addToQueue(() => processAndSendFinalAudio(ctx, chatId));
});

async function processAndSendFinalAudio(ctx, chatId) {
  const session = pendingSessions[chatId];
  if (!session) return;

  const tempDir = path.dirname(session.rawPath);

  const appliedList = Object.entries(session.selectedEffects)
    .filter(([_, val]) => val > 0)
    .map(([key, val]) => {
      const eff = AUDIO_EFFECTS_LIST.find(e => e.key === key);
      return `${eff ? eff.title : key} (${val}%)`;
    });

  const appliedFxText = appliedList.length > 0 ? appliedList.join(', ') : "Standart (Toza)";

  const loadingText = `⚡️ **Musiqa qayta ishlanmoqda...**\n\n` +
                      `🎛 **Qo'llanilgan effektlar:**\n${appliedFxText}`;

  await ctx.telegram.editMessageText(chatId, session.promptMessageId, undefined, loadingText, {
    parse_mode: 'Markdown'
  }).catch(() => {});

  try {
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

    await applyCustomAudioEffects(session.rawPath, processedFxPath, session.selectedEffects);
    await processAudioWithVoiceTag(processedFxPath, fullAudioPath, session.startTagPath, session.endTagPath);
    const updatedTitle = await cleanAndInjectMetadata(fullAudioPath, session.customTitle);
    const coverPath = getCoverPath();

    // Barcha ishlar yakunlangach menyuni o'chiramiz
    await ctx.telegram.deleteMessage(chatId, session.promptMessageId).catch(() => {});

    if (session.isTrimmed && trimmedAudioPath && fs.existsSync(trimmedAudioPath)) {
      await ctx.telegram.sendAudio(
        chatId,
        { source: trimmedAudioPath },
        { title: "30s Snippet", performer: " " }
      );
      if (fs.existsSync(trimmedAudioPath)) fs.unlinkSync(trimmedAudioPath);
    }

    await ctx.telegram.sendAudio(
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

    if (fs.existsSync(processedFxPath)) fs.unlinkSync(processedFxPath);
    if (fs.existsSync(fullAudioPath)) fs.unlinkSync(fullAudioPath);

  } catch (err) {
    console.error("Ishlov berish xatosi:", err);
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
    console.log("MuzXs Bot tayyor va ishlamoqda.");
  } catch (err) {
    console.error("Botni ishga tushirishda xatolik:", err);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
