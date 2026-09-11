import fs from 'node:fs';
import { config } from '../dist/config.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;
if (!token || !appUrl) throw new Error('TELEGRAM_BOT_TOKEN and APP_URL are required');
const url = new URL(appUrl);
if (url.protocol !== 'https:') throw new Error('APP_URL must use HTTPS');
const channel = '@' + config.channelUsername;
async function telegram(method, payload = {}) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error(`Telegram ${method}: network error; check state before retrying publication`); }
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method}: ${result.description}`);
  return result.result;
}
const bot = await telegram('getMe');
if (bot.username !== config.botUsername) throw new Error('Bot token does not match configured bot');
const membership = await telegram('getChatMember', { chat_id: channel, user_id: bot.id });
if (!membership.can_post_messages) throw new Error('Bot needs the Post messages permission in the test channel');
await telegram('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Каталог авто', web_app: { url: appUrl } } });
const menu = await telegram('getChatMenuButton');
if (menu.web_app?.url !== appUrl) throw new Error('Menu URL verification failed');
const text = 'FORMULA · АВТОСАЛОН, НОВОВОЛИНСЬК\n\nОновлений каталог: автомобілі з фото та характеристиками, фільтри, обране і порівняння до трьох авто.\n\nПерегляд, підбір, обмін та консультація щодо фінансування — залишайте заявку просто в Mini App.\n\nЩоб відкрити: перейдіть до бота, натисніть «Почати», потім «Каталог авто» біля поля повідомлення.\n\nТестовий запуск: заявки зберігаються та надходять призначеному тестовому менеджеру.';
const markup = { inline_keyboard: [
  [{ text: '🚘 Відкрити бота → Каталог авто', url: `https://t.me/${bot.username}` }],
  [{ text: '🌐 Переглянути каталог у браузері', url: appUrl }],
] };
let messageId = process.env.TELEGRAM_POST_ID;
if (messageId) {
  try { await telegram('editMessageText', { chat_id: channel, message_id: Number(messageId), text, reply_markup: markup, link_preview_options: { is_disabled: true } }); }
  catch (error) { if (!error.message.includes('message is not modified')) throw error; }
} else if (process.env.PUBLISH_CHANNEL_POST === 'true') {
  const post = await telegram('sendMessage', { chat_id: channel, text, reply_markup: markup, disable_notification: true, link_preview_options: { is_disabled: true } });
  messageId = post.message_id;
}
const summary = `Bot menu configured: https://t.me/${bot.username}\nApp: ${appUrl}\n${messageId ? `Channel post: https://t.me/${config.channelUsername}/${messageId}\nSave TELEGRAM_POST_ID=${messageId} as a repository variable to update the same post.\n` : 'No new channel post requested.\n'}`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
