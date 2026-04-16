/** Single-line JSON logs for log aggregators (read-only; no secrets). */
export function structuredLog(event: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...payload }));
}

export function botFlowStep(
  telegramUserId: number | undefined,
  step: string,
  extra?: Record<string, unknown>,
): void {
  structuredLog("bot_flow_step", { step, telegramUserId: telegramUserId ?? null, ...extra });
}
