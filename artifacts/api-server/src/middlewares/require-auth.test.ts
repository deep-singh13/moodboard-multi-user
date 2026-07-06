import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireAuth } from "./require-auth";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("requireAuth", () => {
  it("responds 401 when there is no session user", () => {
    const req = { session: {} } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.user and calls next when the session has a user", () => {
    const req = {
      session: { userId: "user-1", userEmail: "a@example.com" },
    } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(req.user).toEqual({ id: "user-1", email: "a@example.com" });
    expect(next).toHaveBeenCalledOnce();
  });
});
