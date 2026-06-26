export type PassportEvent = "passport.issued" | "passport.revoked" | "passport.expired";

export interface WebhookSubscription {
  id: string;
  url: string;
  events: PassportEvent[];
  secret: string;
}

export interface IssuedPassport {
  id: string; // passportId
  agentId: string;
  expiresAt: number;
  expired: boolean;
  revoked: boolean;
}

const subscriptions = new Map<string, WebhookSubscription>();
const issuedPassports = new Map<string, IssuedPassport>();

export function addSubscription(
  url: string,
  events: PassportEvent[],
  secret: string
): WebhookSubscription {
  const sub: WebhookSubscription = {
    id: crypto.randomUUID(),
    url,
    events,
    secret,
  };
  subscriptions.set(sub.id, sub);
  return sub;
}

export function getSubscriptionsForEvent(event: PassportEvent): WebhookSubscription[] {
  return Array.from(subscriptions.values()).filter((sub) =>
    sub.events.includes(event)
  );
}

export function registerPassport(
  passportId: string,
  agentId: string,
  expiresAt?: number
): IssuedPassport {
  const passport: IssuedPassport = {
    id: passportId,
    agentId,
    expiresAt: expiresAt ?? Date.now() + 3600_000, // default 1 hour
    expired: false,
    revoked: false,
  };
  issuedPassports.set(passportId, passport);
  return passport;
}

export function revokePassport(passportId: string): IssuedPassport | undefined {
  const p = issuedPassports.get(passportId);
  if (!p) return undefined;
  p.revoked = true;
  return p;
}

export function getPassport(passportId: string): IssuedPassport | undefined {
  return issuedPassports.get(passportId);
}

export function checkAndExpirePassports(): IssuedPassport[] {
  const now = Date.now();
  const expired: IssuedPassport[] = [];
  for (const p of issuedPassports.values()) {
    if (!p.expired && !p.revoked && p.expiresAt <= now) {
      p.expired = true;
      expired.push(p);
    }
  }
  return expired;
}

export function _reset(): void {
  subscriptions.clear();
  issuedPassports.clear();
}
