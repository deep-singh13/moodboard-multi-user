import { describe, it, expect, afterEach } from "vitest";
import { createSessionMiddleware } from "./session";

describe("createSessionMiddleware", () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("throws when SESSION_SECRET is not set", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createSessionMiddleware()).toThrow(/SESSION_SECRET/);
  });

  it("returns a middleware function when SESSION_SECRET is set", () => {
    process.env.SESSION_SECRET = "test-secret";
    const middleware = createSessionMiddleware();
    expect(typeof middleware).toBe("function");
  });
});
