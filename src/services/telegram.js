const config = require('../config');

// Telegram xabariga avtomatik reaksiyalar bosish
async function setAutoReactions(telegram, chatId, messageId) {
  try {
    await telegram.callApi('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: config.reactions.map(emoji => ({ type: 'emoji', emoji }))
    });
  } catch (err) {
    console.error("Auto Reaction Error:", err.message);
  }
}

module.exports = { setAutoReactions };
