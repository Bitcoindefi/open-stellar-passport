import crypto from "crypto";
import { PassportEvent, getSubscriptionsForEvent } from "./webhook-store";

export async function deliverWebhook(
  url: string,
  secret: string,
  payload: unknown,
  maxRetries = 5,
  initialDelayMs = 100
) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Open-Stellar-Signature": signature,
        },
        body,
      });

      if (response.ok) {
        return { success: true, attempt };
      }
    } catch {
      // ignore and retry
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff
    }
  }

  return { success: false, attempt: maxRetries };
}

export async function notifyPassportEvent(
  event: PassportEvent,
  passportId: string,
  agentId: string
) {
  const webhooks = getSubscriptionsForEvent(event);
  const payload = {
    event,
    passportId,
    agentId,
    timestamp: Date.now(),
  };

  const deliveries = webhooks.map((wh) =>
    deliverWebhook(wh.url, wh.secret, payload)
  );

  return Promise.all(deliveries);
}
