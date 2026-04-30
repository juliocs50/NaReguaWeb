// REST client for NaReguaBackend (Render).
// Keep it tiny: static site + fetch + localStorage tokens.

(function () {
  const DEFAULT_BASE = "https://nareguabackend.onrender.com/api";

  function getBaseUrl() {
    try {
      const v = (window.NAREGUA_API_BASE_URL || "").trim();
      if (v) return v.replace(/\/$/, "");
    } catch (_e) {}
    return DEFAULT_BASE;
  }

  async function fetchJson(path, opts) {
    opts = opts || {};
    const url = getBaseUrl() + (path.startsWith("/") ? path : "/" + path);
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });

    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_e) {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.message || data.error || data.msg)) ||
        res.statusText ||
        "Erro";
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const LS_GUEST = "naregua_web_guest_token";

  function getGuestToken() {
    try {
      return (localStorage.getItem(LS_GUEST) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function setGuestToken(token) {
    try {
      if (!token) localStorage.removeItem(LS_GUEST);
      else localStorage.setItem(LS_GUEST, token);
    } catch (_e) {}
  }

  async function ensureGuestToken() {
    const existing = getGuestToken();
    if (existing) return existing;
    const res = await fetchJson("/auth/guest", { method: "POST" });
    const tok = (res && res.token) || "";
    if (!tok) throw new Error("Não foi possível iniciar sessão de cliente.");
    setGuestToken(tok);
    return tok;
  }

  async function authBearer() {
    const tok = await ensureGuestToken();
    return "Bearer " + tok;
  }

  window.NaReguaApi = {
    getBaseUrl,
    fetchJson,
    ensureGuestToken,
    authBearer,
    setGuestToken,
    // public endpoints
    publicSearchShops: function (q) {
      return fetchJson("/public/shops/search?q=" + encodeURIComponent(q));
    },
    publicNearby: function (lat, lng, maxKm) {
      return fetchJson(
        "/public/shops/nearby?lat=" +
          encodeURIComponent(lat) +
          "&lng=" +
          encodeURIComponent(lng) +
          "&maxKm=" +
          encodeURIComponent(maxKm)
      );
    },
    publicShopBySlug: function (slug) {
      return fetchJson("/public/shops/by-slug/" + encodeURIComponent(slug));
    },
    publicShopById: function (shopId) {
      return fetchJson("/public/shops/" + encodeURIComponent(shopId));
    },
    publicBarbers: function (shopId) {
      return fetchJson("/public/shops/" + encodeURIComponent(shopId) + "/barbers");
    },
    publicServices: function (shopId) {
      return fetchJson(
        "/public/shops/" + encodeURIComponent(shopId) + "/services"
      );
    },
    publicAppointments: function (shopId, dateKey) {
      return fetchJson(
        "/public/shops/" +
          encodeURIComponent(shopId) +
          "/appointments?dateKey=" +
          encodeURIComponent(dateKey)
      );
    },
    publicBook: async function (shopId, body) {
      const bearer = await authBearer();
      return fetchJson(
        "/public/shops/" + encodeURIComponent(shopId) + "/appointments/book",
        { method: "POST", headers: { Authorization: bearer }, body: body }
      );
    },
    publicCancel: async function (shopId, appointmentId) {
      const bearer = await authBearer();
      return fetchJson(
        "/public/shops/" +
          encodeURIComponent(shopId) +
          "/appointments/" +
          encodeURIComponent(appointmentId) +
          "/cancel",
        { method: "POST", headers: { Authorization: bearer } }
      );
    },
  };
})();

