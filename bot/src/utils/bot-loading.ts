import type { BotContext } from "../types/session";

async function deleteMessageSafe(
  ctx: BotContext,
  msg: { chat: { id: number }; message_id: number } | undefined,
): Promise<void> {
  if (!msg) {
    return;
  }
  try {
    await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
  } catch {
    // ignore (already deleted or too old)
  }
}

/** Typing indicator + transient “Processing…” message removed after `fn` completes. */
export async function withProcessingReply<T>(ctx: BotContext, fn: () => Promise<T>): Promise<T> {
  await ctx.sendChatAction("typing");
  const loading = await ctx.reply("⏳ Processing...");
  try {
    return await fn();
  } finally {
    await deleteMessageSafe(ctx, loading);
  }
}
