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
  const LS_GUEST_ID = "naregua_web_guest_id";
  const LS_OWNER = "naregua_web_owner_token";

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

  function getGuestId() {
    try {
      return (localStorage.getItem(LS_GUEST_ID) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function setGuestId(id) {
    try {
      if (!id) localStorage.removeItem(LS_GUEST_ID);
      else localStorage.setItem(LS_GUEST_ID, id);
    } catch (_e) {}
  }

  function getOwnerToken() {
    try {
      return (localStorage.getItem(LS_OWNER) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function setOwnerToken(token) {
    try {
      if (!token) localStorage.removeItem(LS_OWNER);
      else localStorage.setItem(LS_OWNER, token);
    } catch (_e) {}
  }

  async function ownerBearer() {
    const tok = getOwnerToken();
    if (!tok) throw new Error("Faça login da barbearia.");
    return "Bearer " + tok;
  }

  async function ensureGuestToken() {
    const existing = getGuestToken();
    if (existing) return existing;
    const res = await fetchJson("/auth/guest", { method: "POST" });
    const tok = (res && res.token) || "";
    const guestId = (res && (res.guestId || res.userId || res.id)) || "";
    if (!tok) throw new Error("Não foi possível iniciar sessão de cliente.");
    setGuestToken(tok);
    if (guestId) setGuestId(guestId);
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
    getGuestId,
    setGuestId,
    getOwnerToken,
    setOwnerToken,
    ownerBearer,
    authLogin: function (email, password) {
      return fetchJson("/auth/login", {
        method: "POST",
        body: { email: String(email || "").trim(), password: String(password || "") },
      });
    },
    /** Permanent account deletion (BarbxGo / web owner account). Backend: POST /delete-account */
    deleteAccount: function (email, password) {
      return fetchJson("/delete-account", {
        method: "POST",
        body: {
          email: String(email || "").trim(),
          password: String(password || ""),
        },
      });
    },
    usersMe: async function () {
      const bearer = await ownerBearer();
      return fetchJson("/users/me", { headers: { Authorization: bearer } });
    },
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

    // owner endpoints (limited set for now)
    ownerAddBarber: async function (shopId, name) {
      const bearer = await ownerBearer();
      return fetchJson("/owner/shops/" + encodeURIComponent(shopId) + "/barbers", {
        method: "POST",
        headers: { Authorization: bearer },
        body: { name: String(name || "").trim() },
      });
    },
    ownerPatchBarber: async function (shopId, barberId, body) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/barbers/" +
          encodeURIComponent(barberId),
        {
          method: "PATCH",
          headers: { Authorization: bearer },
          body: body || {},
        }
      );
    },

    ownerPatchShop: async function (shopId, body) {
      const bearer = await ownerBearer();
      return fetchJson("/owner/shops/" + encodeURIComponent(shopId), {
        method: "PATCH",
        headers: { Authorization: bearer },
        body: body || {},
      });
    },

    ownerAppointments: async function (shopId, dateKey) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/appointments?dateKey=" +
          encodeURIComponent(dateKey),
        { headers: { Authorization: bearer } }
      );
    },

    ownerServices: async function (shopId) {
      // public is enough; but keep owner token for future changes if needed
      return fetchJson(
        "/public/shops/" + encodeURIComponent(shopId) + "/services"
      );
    },

    ownerAddService: async function (shopId, body) {
      const bearer = await ownerBearer();
      return fetchJson("/owner/shops/" + encodeURIComponent(shopId) + "/services", {
        method: "POST",
        headers: { Authorization: bearer },
        body: body || {},
      });
    },

    ownerFinance: async function (shopId, month) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/finance?month=" +
          encodeURIComponent(month),
        { headers: { Authorization: bearer } }
      );
    },

    ownerManual: async function (shopId, body) {
      const bearer = await ownerBearer();
      return fetchJson("/owner/shops/" + encodeURIComponent(shopId) + "/appointments/manual", {
        method: "POST",
        headers: { Authorization: bearer },
        body: body || {},
      });
    },

    ownerReserve: async function (shopId, body) {
      const bearer = await ownerBearer();
      return fetchJson("/owner/shops/" + encodeURIComponent(shopId) + "/appointments/reserve", {
        method: "POST",
        headers: { Authorization: bearer },
        body: body || {},
      });
    },

    ownerStart: async function (shopId, appointmentId) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/appointments/" +
          encodeURIComponent(appointmentId) +
          "/start",
        { method: "PATCH", headers: { Authorization: bearer } }
      );
    },

    ownerFinish: async function (shopId, appointmentId) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/appointments/" +
          encodeURIComponent(appointmentId) +
          "/finish",
        { method: "PATCH", headers: { Authorization: bearer } }
      );
    },

    ownerCancel: async function (shopId, appointmentId) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/appointments/" +
          encodeURIComponent(appointmentId) +
          "/cancel",
        { method: "PATCH", headers: { Authorization: bearer } }
      );
    },

    ownerRelease: async function (shopId, appointmentId) {
      const bearer = await ownerBearer();
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/appointments/" +
          encodeURIComponent(appointmentId) +
          "/release",
        { method: "PATCH", headers: { Authorization: bearer } }
      );
    },

    ownerInbox: async function (shopId, barberId, limit) {
      const bearer = await ownerBearer();
      const qs = [];
      if (barberId) qs.push("barberId=" + encodeURIComponent(barberId));
      if (limit != null) qs.push("limit=" + encodeURIComponent(limit));
      return fetchJson(
        "/owner/shops/" +
          encodeURIComponent(shopId) +
          "/inbox" +
          (qs.length ? "?" + qs.join("&") : ""),
        { headers: { Authorization: bearer } }
      );
    },
  };
})();

