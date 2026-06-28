import { afterEach, describe, expect, it, vi } from "vitest";

import { PassportClient } from "./PassportClient";

describe("PassportClient revocation cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isRevoked('active-id') returns false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "active" }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PassportClient({
      baseUrl: "https://api.example.com",
      revocationCacheMs: 60_000,
    });

    const result = await client.isRevoked("active-id");

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/protocol/passport/active-id",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("isRevoked('revoked-id') returns true and caches forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "revoked" }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PassportClient({
      baseUrl: "https://api.example.com",
      revocationCacheMs: 60_000,
    });

    expect(await client.isRevoked("revoked-id")).toBe(true);
    expect(await client.isRevoked("revoked-id")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches active result for cacheMs and only issues one HTTP call on repeated checks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "active" }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PassportClient({
      baseUrl: "https://api.example.com",
      revocationCacheMs: 60_000,
    });

    expect(await client.isRevoked("active-id")).toBe(false);
    expect(await client.isRevoked("active-id")).toBe(false);
    expect(await client.isRevoked("active-id")).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
