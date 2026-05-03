import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// @imgly/background-removal pulls in onnxruntime-web at module eval and
// is too heavy to load in happy-dom; stub it.
vi.mock("@imgly/background-removal", () => ({
  preload: vi.fn(),
}));

import { registerServiceWorker } from "./register-sw";

describe("registerServiceWorker", () => {
  const realSW = (navigator as unknown as { serviceWorker?: unknown })
    .serviceWorker;
  const register = vi.fn();

  beforeEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, controller: null },
    });
    register.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: realSW,
    });
  });

  it("bails early in dev so vite-plugin-pwa's dev shim doesn't race HMR", async () => {
    // Vitest evaluates with import.meta.env.DEV === true; the bail is
    // exactly the contract this test locks in.
    expect(import.meta.env.DEV).toBe(true);
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });
});
