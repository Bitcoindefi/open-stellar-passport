import { describe, expect, it, beforeEach } from "vitest";
import {
  addCredential,
  findExpiringSoon,
  getLastWarned,
  setLastWarned,
  _reset,
} from "./credential-expiry-store";

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function makeCredential(id: string, passportId: string, expiresInDays: number) {
  return addCredential({
    id,
    passportId,
    expiresAt: NOW + expiresInDays * DAY_MS,
  });
}

describe("credential-expiry-store", () => {
  beforeEach(() => _reset());

  it("findExpiringSoon returns credentials within the window", () => {
    makeCredential("cred-3d", "passport-1", 3);
    makeCredential("cred-7d", "passport-2", 7);
    makeCredential("cred-8d", "passport-3", 8); // outside window ✗
    makeCredential("cred-0d", "passport-4", 0); // already expired ✗

    const result = findExpiringSoon(NOW, NOW + 7 * DAY_MS);

    expect(result.map((c) => c.id).sort()).toEqual(["cred-3d", "cred-7d"]);
  });

  it("getLastWarned returns undefined when no warning has been recorded", () => {
    makeCredential("cred-new", "passport-1", 3);
    expect(getLastWarned("cred-new")).toBeUndefined();
  });

  it("setLastWarned and getLastWarned round-trip correctly", () => {
    setLastWarned("cred-1", NOW);
    const entry = getLastWarned("cred-1");
    expect(entry).toEqual({ credentialId: "cred-1", warnedAt: NOW });
  });
});