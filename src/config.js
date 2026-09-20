require('dotenv').config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  geminiApiKey: process.env.GEMINI_API_KEY, // <-- BU QATORNI QO'SHIB QO'YAMIZ
  adminId: parseInt(process.env.ADMIN_ID || "8913846037", 10),
  channelUsername: process.env.CHANNEL_USERNAME || "@muzxs",
  channelLink: process.env.CHANNEL_LINK || "https://t.me/muzxs",
  githubCoverUrl: process.env.GITHUB_COVER_URL || "",
  auddApiKey: process.env.AUDD_API_KEY || "",
  
  // Ruxsat berilgan reaksiyalar
  reactions: ["🔥", "👍"],
  
  // Shablondagi artist va standart nom
  defaultArtist: "-MuzXs",
  fallbackTitle: "MuzXs🎧",
  
  // Post matni shabloni (HTML parse mode)
  captionTemplate: `<b>2 qator reaksiya bosib qo'yamiz…🖤👇</b>\n\n<b>🎧 JOIN ➢ <a href="https://t.me/muzxs">@muzxs</a> 🔥</b>`
};
