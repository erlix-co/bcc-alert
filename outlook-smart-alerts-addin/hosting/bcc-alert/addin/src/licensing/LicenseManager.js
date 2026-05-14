/**
 * Email-based license resolution for BCC Alert Outlook add-in.
 *
 * Outlook Desktop keeps the JS runtime alive across network changes. This module therefore:
 * - Treats **network/API failure as distinct from EXPIRED** — we never downgrade to "expired"
 *   because of timeouts, offline, DNS, or invalid JSON.
 * - Enters **EXPIRED** only after a **successful HTTP response** whose JSON body explicitly
 *   contains `"status": "expired"` (then persisted to cache).
 * - While the network is down but we still have a last-known **active** or **expiring_soon**
 *   cache entry (any age after a prior server success), we use **OFFLINE_GRACE**: protection
 *   stays on, with informational logs only (no subscription "scary" banners).
 * - With **no cache** and API unreachable: default to **ACTIVE** so dev/local and pre-backend
 *   production never silently lose protection; log clearly.
 *
 * Logging prefix: [LICENSE]
 */

/* global Office */

const CACHE_KEY = "erlix_license_cache";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LICENSE_API_TIMEOUT_MS = 5000;
const LICENSE_STATUS_ENDPOINT = "https://erlix.net/api/license-status";

/** @typedef {{ status: string, expiresAt?: string, daysLeft?: number, offlineGrace?: boolean }} LicenseResolvedState */

/** @typedef {{ status: string, expiresAt?: string, daysLeft?: number }} LicenseApiPayload */

/**
 * True when running from a typical local dev host (sideload / Express).
 * @returns {boolean}
 */
function isDevRuntime() {
  try {
    const h = typeof window !== "undefined" && window.location?.hostname;
    if (!h) return false;
    const lower = String(h).toLowerCase();
    return lower === "localhost" || lower === "127.0.0.1" || lower.endsWith(".local");
  } catch (_e) {
    return false;
  }
}

class LicenseManager {
  constructor() {
    /** @type {LicenseResolvedState | null} */
    this._resolved = null;
    /** @type {boolean} */
    this._onlineListenerAttached = false;
    this._attachOnlineRecoveryListenerOnce();
  }

  /**
   * Clears in-memory resolution so the next `resolveState()` performs a fresh network attempt.
   * Called when the browser reports `online` after connectivity loss (Outlook Desktop recovery).
   */
  clearInMemoryStateForRecovery() {
    this._resolved = null;
    console.log("[LICENSE] Cleared in-memory license state for network recovery");
  }

  _attachOnlineRecoveryListenerOnce() {
    if (this._onlineListenerAttached) return;
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    this._onlineListenerAttached = true;
    window.addEventListener("online", () => {
      console.log("[LICENSE] Network restored, revalidating");
      try {
        const api =
          typeof window !== "undefined" && typeof window.getErlixLicenseManager === "function"
            ? window.getErlixLicenseManager()
            : null;
        api?.clearInMemoryStateForRecovery();
      } catch (error) {
        console.log("[LICENSE] online handler error (non-fatal)", error?.message || error);
      }
    });
  }

  /**
   * Reads user identity from Office.js (authoritative mailbox profile).
   * @returns {string}
   */
  getUserEmail() {
    try {
      const email = Office?.context?.mailbox?.userProfile?.emailAddress;
      return String(email || "").trim();
    } catch (_error) {
      return "";
    }
  }

  /**
   * True while we are using last-known-good license data because the server could not be reached.
   * UI layers should avoid subscription scare banners in this mode (logs only).
   * @returns {boolean}
   */
  isOfflineGrace() {
    return Boolean(this._resolved?.offlineGrace);
  }

  /**
   * @returns {boolean} true when full protection is allowed to run (ACTIVE or EXPIRING_SOON).
   */
  isProtectionActive() {
    const s = this._resolved?.status;
    return s === "active" || s === "expiring_soon";
  }

  /**
   * @returns {boolean}
   */
  isExpiringSoon() {
    return this._resolved?.status === "expiring_soon";
  }

  /**
   * @returns {boolean}
   */
  isExpired() {
    return this._resolved?.status === "expired";
  }

  /**
   * Days left until expiration when backend supplied `daysLeft` (typical for EXPIRING_SOON).
   * @returns {number | null}
   */
  getDaysLeft() {
    const raw = this._resolved?.daysLeft;
    if (raw === undefined || raw === null) return null;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }

  /**
   * Subscription end timestamp from last successful resolution (ISO string), if any.
   * @returns {string | null}
   */
  getExpiresAt() {
    const e = this._resolved?.expiresAt;
    return typeof e === "string" && e.trim() ? e.trim() : null;
  }

  /**
   * Whole days until expiry for **display only** (Smart Alert text, task pane). Not used for
   * enforcement. Uses `daysLeft` when the server sent it; otherwise approximates from `expiresAt`
   * vs the local clock.
   * @returns {number | null}
   */
  getDisplayDaysUntilExpiry() {
    const fromDaysLeft = this.getDaysLeft();
    if (fromDaysLeft !== null) return fromDaysLeft;
    const exp = this.getExpiresAt();
    if (!exp) return null;
    const endMs = Date.parse(exp);
    if (!Number.isFinite(endMs)) return null;
    const diffMs = endMs - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / 86400000);
  }

  /**
   * Reads and validates cache from localStorage.
   * @returns {{ status: string, expiresAt?: string, daysLeft?: number, cachedAt: number } | null}
   */
  _readCache() {
    try {
      if (typeof localStorage === "undefined" || !localStorage.getItem) return null;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const cachedAt = Math.floor(Number(parsed.cachedAt));
      if (!Number.isFinite(cachedAt)) return null;
      const status = String(parsed.status || "").trim();
      if (!this._isKnownStatus(status)) return null;
      return {
        status,
        expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
        daysLeft: parsed.daysLeft !== undefined ? Math.floor(Number(parsed.daysLeft)) : undefined,
        cachedAt
      };
    } catch (error) {
      console.log("[LICENSE] cache read failed (treating as miss)", error?.message || error);
      return null;
    }
  }

  /**
   * Persists last successful server response (never write "expired" inferred from network errors).
   * @param {LicenseApiPayload} payload
   */
  _writeCache(payload) {
    try {
      if (typeof localStorage === "undefined" || !localStorage.setItem) return;
      const record = {
        status: payload.status,
        expiresAt: payload.expiresAt,
        daysLeft: payload.daysLeft,
        cachedAt: Date.now()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(record));
      console.log("[LICENSE] cache updated", { status: record.status, cachedAt: record.cachedAt });
    } catch (error) {
      console.log("[LICENSE] cache write failed (non-fatal)", error?.message || error);
    }
  }

  /**
   * @param {string} status
   * @returns {boolean}
   */
  _isKnownStatus(status) {
    return status === "active" || status === "expiring_soon" || status === "expired";
  }

  /**
   * Normalizes backend JSON into internal shape; returns null if invalid.
   * @param {unknown} body
   * @returns {LicenseApiPayload | null}
   */
  _normalizeServerPayload(body) {
    if (!body || typeof body !== "object") return null;
    const status = String(/** @type {{ status?: unknown }} */ (body).status || "").trim();
    if (!this._isKnownStatus(status)) return null;
    const out = /** @type {LicenseApiPayload} */ ({ status });
    const expiresAt = /** @type {{ expiresAt?: unknown }} */ (body).expiresAt;
    if (typeof expiresAt === "string" && expiresAt.trim()) {
      out.expiresAt = expiresAt.trim();
    }
    const daysLeft = /** @type {{ daysLeft?: unknown }} */ (body).daysLeft;
    if (daysLeft !== undefined && daysLeft !== null && Number.isFinite(Number(daysLeft))) {
      out.daysLeft = Math.floor(Number(daysLeft));
    }
    return out;
  }

  /**
   * Performs HTTP GET with hard timeout (AbortController).
   * @param {string} url
   * @returns {Promise<{ ok: boolean, status: number, text: string }>}
   */
  async _fetchWithTimeout(url) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch (_e) {
        /* ignore */
      }
    }, LICENSE_API_TIMEOUT_MS);

    try {
      if (typeof fetch !== "function") {
        return { ok: false, status: 0, text: "" };
      }
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller?.signal
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (error) {
      const name = /** @type {{ name?: string }} */ (error)?.name;
      if (name === "AbortError") {
        console.log("[LICENSE] fetch aborted by timeout");
      } else {
        console.log("[LICENSE] fetch error", error?.message || error);
      }
      return { ok: false, status: 0, text: "" };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * After a failed or unusable HTTP response: use cache / dev defaults. Never infer EXPIRED from
   * transport errors alone.
   * @returns {LicenseResolvedState}
   */
  _resolveFromCacheOrFallbackAfterNetworkFailure() {
    const cached = this._readCache();
    const now = Date.now();

    if (cached) {
      if (cached.status === "expired") {
        this._resolved = {
          status: "expired",
          expiresAt: cached.expiresAt,
          daysLeft: cached.daysLeft,
          offlineGrace: false
        };
        console.log(
          "[LICENSE] API unreachable; retaining cached EXPIRED from prior explicit server response"
        );
        return this._resolved;
      }

      if (cached.status === "active" || cached.status === "expiring_soon") {
        const ageMs = now - cached.cachedAt;
        const beyondTtl = ageMs > CACHE_MAX_AGE_MS;
        if (beyondTtl) {
          console.log(
            "[LICENSE] Using cached ACTIVE state due to temporary network failure (cache older than 24h; keeping protection until server confirms)"
          );
        } else {
          console.log("[LICENSE] Using cached ACTIVE state due to temporary network failure");
        }
        console.log("[LICENSE] Offline grace active");
        this._resolved = {
          status: cached.status,
          expiresAt: cached.expiresAt,
          daysLeft: cached.daysLeft,
          offlineGrace: true
        };
        return this._resolved;
      }
    }

    if (isDevRuntime()) {
      console.log("[LICENSE] Dev/local: API unreachable — defaulting ACTIVE (protection on)");
      this._resolved = { status: "active", offlineGrace: true };
      console.log("[LICENSE] Offline grace active");
      return this._resolved;
    }

    console.log(
      "[LICENSE] No cache; API unreachable — defaulting ACTIVE until explicit server response (protection on)"
    );
    console.log("[LICENSE] Offline grace active");
    this._resolved = { status: "active", offlineGrace: true };
    return this._resolved;
  }

  /**
   * Resolves license: successful server JSON is authoritative; failures use offline grace / ACTIVE default.
   * @returns {Promise<LicenseResolvedState>}
   */
  async resolveState() {
    const email = this.getUserEmail();
    if (!email) {
      console.log(
        "[LICENSE] no mailbox email — defaulting ACTIVE (avoid disabling protection on transient profile issues)"
      );
      this._resolved = { status: "active", offlineGrace: true };
      return this._resolved;
    }

    const url = `${LICENSE_STATUS_ENDPOINT}?email=${encodeURIComponent(email)}`;
    console.log("[LICENSE] resolving state (network attempt)");

    const net = await this._fetchWithTimeout(url);

    if (net.ok && net.text) {
      let parsed = null;
      try {
        parsed = JSON.parse(net.text);
      } catch (_e) {
        console.log("[LICENSE] invalid JSON from server — treating as network/API failure (not EXPIRED)");
      }
      const normalized = parsed ? this._normalizeServerPayload(parsed) : null;
      if (normalized) {
        if (normalized.status === "expired") {
          console.log("[LICENSE] Explicit expired response received from server");
        }
        this._resolved = {
          status: normalized.status,
          expiresAt: normalized.expiresAt,
          daysLeft: normalized.daysLeft,
          offlineGrace: false
        };
        this._writeCache(normalized);
        console.log("[LICENSE] resolved from server", { status: normalized.status });
        return this._resolved;
      }
      console.log("[LICENSE] invalid or empty license payload in HTTP 200 — using offline grace / fallback");
    } else {
      console.log("[LICENSE] network response not OK or empty body", { httpStatus: net.status });
    }

    return this._resolveFromCacheOrFallbackAfterNetworkFailure();
  }
}

const singleton = new LicenseManager();

function getErlixLicenseManager() {
  return singleton;
}

if (typeof window !== "undefined") {
  window.getErlixLicenseManager = getErlixLicenseManager;
}
if (typeof global !== "undefined") {
  global.getErlixLicenseManager = getErlixLicenseManager;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LicenseManager,
    getErlixLicenseManager,
    isDevRuntime,
    CACHE_KEY,
    CACHE_MAX_AGE_MS,
    LICENSE_API_TIMEOUT_MS,
    LICENSE_STATUS_ENDPOINT
  };
}
