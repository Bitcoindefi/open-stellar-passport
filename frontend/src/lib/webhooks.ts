export interface WebhookEventPayload {
  event: string;
  [key: string]: unknown;
}

/**
 * Placeholder webhook emitter since PR #121 is not fully integrated.
 */
export async function emitWebhook(
  agentId: string,
  event: string,
  payload: Omit<WebhookEventPayload, "event">
): Promise<void> {
  const fullPayload = {
    event,
    ...payload,
  };
  // In a real implementation, this would send an HTTP POST to the agent's registered webhook URL.
  // Using console.log to simulate the emission for now.
  console.log(`[Webhook Emitted] Agent: ${agentId}, Event: ${event}`, fullPayload);
}
