import { preload } from "@imgly/background-removal";
import { setOfflineStatus } from "./offline-status";

// Register the service worker, then warm up the imgly model in the
// background so the app is fully usable offline after the first visit.
//
// First-visit reload: the SW must be controlling the page for COOP/COEP
// headers (and threaded WASM) to take effect. If we don't have a
// controller yet, reload once the new SW activates.
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // SW only runs in production builds. In dev, Vite sets COOP/COEP via
  // server.headers (see vite.config.ts), so we don't need the SW for
  // cross-origin isolation. We also actively unregister any SW left
  // over from prior dev sessions (or from a previous version of this
  // app that did register one in dev) — otherwise it keeps controlling
  // the page, intercepting fetches, and serving stale HTML that breaks
  // HMR.
  if (import.meta.env.DEV) {
    void unregisterAllAndClearCaches();
    return;
  }

  setOfflineStatus({ kind: "registering" });

  try {
    const base = import.meta.env.BASE_URL;
    const swUrl = `${base}sw.js`;
    const reg = await navigator.serviceWorker.register(swUrl, {
      type: "module",
      scope: base,
    });

    // No controller yet → first install. Wait for activate, then reload
    // so this page is in scope and gets COI headers.
    if (!navigator.serviceWorker.controller) {
      const waitForActive = new Promise<void>((resolve) => {
        const sw = reg.installing ?? reg.waiting ?? reg.active;
        if (!sw) return resolve();
        if (sw.state === "activated") return resolve();
        sw.addEventListener("statechange", () => {
          if (sw.state === "activated") resolve();
        });
      });
      await waitForActive;
      // One-shot reload guard so we don't loop if something goes sideways.
      if (!sessionStorage.getItem("clearcut-sw-reloaded")) {
        sessionStorage.setItem("clearcut-sw-reloaded", "1");
        window.location.reload();
        return;
      }
    }

    void warmupModel();
  } catch (err) {
    console.error("Service worker registration failed:", err);
    setOfflineStatus({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Dev-only cleanup: nuke any service worker + caches that were
// installed by an earlier version of this app (or by vite-plugin-pwa's
// dev shim). After unregistering we reload once so the page detaches
// from the old controller. Guarded by sessionStorage to avoid a loop.
async function unregisterAllAndClearCaches() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length === 0) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in self) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    if (!sessionStorage.getItem("clearcut-dev-sw-cleaned")) {
      sessionStorage.setItem("clearcut-dev-sw-cleaned", "1");
      window.location.reload();
    }
  } catch (err) {
    console.warn("Dev SW cleanup failed:", err);
  }
}

// Trigger imgly's preload so the model files land in the SW's CacheFirst
// store. We mirror the same model and progress key parsing as home.tsx.
async function warmupModel() {
  setOfflineStatus({ kind: "downloading", progress: 0 });
  try {
    await preload({
      model: "isnet_quint8",
      progress: (key, current, total) => {
        // Only count the model fetch — we don't care about inference
        // engine init for "ready offline" status, but it's downloaded
        // anyway so reporting it is fine.
        if (!key.startsWith("fetch:")) return;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        setOfflineStatus({ kind: "downloading", progress: pct });
      },
    });
    setOfflineStatus({ kind: "ready" });
  } catch (err) {
    console.error("Model preload failed:", err);
    setOfflineStatus({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
