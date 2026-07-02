// Telegram adapter. Live impl uses Bot API (sendMessage for alerts, sendPhoto/sendMediaGroup
// for card-news). VOBET only had sendMessage(text); sendPhoto/sendMediaGroup are NET-NEW.
// A mock factory (for dry-run/tests) records calls without network.

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export function liveTelegram(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_GROUP_ID;
  function assertWired() {
    if (!token || !chatId) {
      throw new Error('Telegram not wired: set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID (see SECRETS.md)');
    }
  }
  return {
    async alert(text) {
      if (!token || !chatId) { console.warn(`[telegram alert skipped] ${text}`); return { skipped: true }; }
      const res = await fetch(API(token, 'sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      return res.json();
    },
    async sendPhoto({ buffer, caption, chatId: to }) {
      assertWired();
      const form = new FormData();
      form.append('chat_id', to ?? chatId); // `to` = personalized follower DM; default = group
      if (caption) form.append('caption', caption);
      form.append('photo', new Blob([buffer], { type: 'image/png' }), 'card.png');
      const res = await fetch(API(token, 'sendPhoto'), { method: 'POST', body: form });
      const json = await res.json();
      if (!json.ok) throw new Error(`Telegram sendPhoto failed: ${JSON.stringify(json)}`);
      return { messageId: json.result?.message_id };
    },
    async sendMediaGroup(photos) {
      assertWired();
      // photos: [{ buffer, caption }]
      const form = new FormData();
      form.append('chat_id', chatId);
      const media = photos.map((p, i) => ({
        type: 'photo',
        media: `attach://photo${i}`,
        ...(p.caption ? { caption: p.caption } : {}),
      }));
      form.append('media', JSON.stringify(media));
      photos.forEach((p, i) =>
        form.append(`photo${i}`, new Blob([p.buffer], { type: 'image/png' }), `card${i}.png`)
      );
      const res = await fetch(API(token, 'sendMediaGroup'), { method: 'POST', body: form });
      const json = await res.json();
      if (!json.ok) throw new Error(`Telegram sendMediaGroup failed: ${JSON.stringify(json)}`);
      return { messageIds: (json.result ?? []).map((m) => m.message_id) };
    },
  };
}

// Mock for dry-run/tests — records every call, no network.
export function mockTelegram() {
  const calls = { alerts: [], photos: [], groups: [] };
  return {
    calls,
    async alert(text) { calls.alerts.push(text); return { ok: true, mock: true }; },
    async sendPhoto({ buffer, caption, chatId }) {
      if (!buffer || !buffer.length) throw new Error('sendPhoto received empty buffer');
      calls.photos.push({ size: buffer.length, caption, chatId: chatId ?? 'group' });
      return { messageId: calls.photos.length };
    },
    async sendMediaGroup(photos) {
      photos.forEach((p) => { if (!p.buffer?.length) throw new Error('sendMediaGroup empty buffer'); });
      calls.groups.push(photos.map((p) => ({ size: p.buffer.length, caption: p.caption })));
      return { messageIds: photos.map((_, i) => i + 1) };
    },
  };
}
