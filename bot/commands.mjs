// Telegram bot command layer (②). Parses /follow /unfollow /myfeed and applies them to the
// subscription store. processUpdate() is pure-ish (store I/O injected) so it is unit-testable
// without a live bot. The live long-poll/webhook loop calls processUpdate per incoming update.
import { applyCommand } from '../lib/subscriptions.mjs';

export function parseCommand(text) {
  const m = String(text ?? '').trim().match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
  if (!m) return null;
  return { command: m[1].toLowerCase(), arg: (m[2] ?? '').trim() };
}

// update: { chatId, text, lang? }. store: { read(): subs[], write(subs): void }.
// Returns the reply string (also persists mutations via store.write).
export function processUpdate(update, store) {
  const parsed = parseCommand(update.text);
  if (!parsed) return null; // not a command — ignore
  const subs = store.read();
  const { subs: next, reply } = applyCommand(subs, {
    chatId: String(update.chatId),
    command: parsed.command,
    arg: parsed.arg,
    lang: update.lang,
  });
  store.write(next);
  return reply;
}
