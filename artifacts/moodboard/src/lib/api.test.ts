import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchItems, createItem, deleteItem, patchItemComplete } from "./api";

function mockFetchOnce(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("lib/api credentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchItems sends credentials: include", async () => {
    mockFetchOnce([]);
    await fetchItems("moodboard");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/items"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("createItem sends credentials: include", async () => {
    mockFetchOnce({ id: "1" });
    await createItem({ id: "1", type: "link", url: "https://example.com", addedAt: "now" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("deleteItem sends credentials: include", async () => {
    mockFetchOnce({ ok: true });
    await deleteItem("1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("patchItemComplete sends credentials: include", async () => {
    mockFetchOnce({ ok: true });
    await patchItemComplete("1", true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });
});
