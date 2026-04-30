/* global NaReguaApi */

/**
 * Minimal REST-based client (Render backend) for:
 * - Find shop by name / nearby
 * - Public booking page (/slug)
 *
 * Owner portal remains disabled for now; migrate next.
 */

const $ = (id) => document.getElementById(id);

function setFindShopStatus(msg, isError) {
  const el = $("findShopStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function setHomeStatus(msg, isError) {
  const el = $("homeStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function setStatus(msg, isError) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getSlugFromPath() {
  let path = window.location.pathname || "/";
  if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (first === "about") return null;
  if (first === "index.html") return null;
  return decodeURIComponent(first);
}

function applyBookingHeadlines(shopName) {
  const titleEl = $("bookingTitle");
  const subEl = $("bookingSubtitle");
  if (!titleEl || !subEl) return;
  const name = shopName && String(shopName).trim();
  const sub =
    "Agende pelo Barb x Go — escolha data, barbeiro, serviço e confirme o horário.";
  if (name) {
    titleEl.textContent = name;
    subEl.textContent = sub;
  } else {
    titleEl.textContent = "Agendar pelo Barb x Go";
    subEl.textContent = sub;
  }
}

function showLandingHome() {
  document.body.classList.remove("layout-app");
  document.body.classList.add("layout-landing");
  const app = $("app");
  if (app) app.hidden = true;
  const home = $("homeLanding");
  if (home) home.hidden = false;
  const badge = $("shopBadge");
  if (badge) {
    badge.hidden = true;
    badge.textContent = "";
  }
}

function showBookingApp(shopName) {
  document.body.classList.remove("layout-landing");
  document.body.classList.add("layout-app");
  const app = $("app");
  if (app) app.hidden = false;
  const home = $("homeLanding");
  if (home) home.hidden = true;
  const badge = $("shopBadge");
  if (badge) {
    badge.hidden = false;
    badge.textContent = shopName || "";
  }
}

function renderOptions(selectEl, items, getValue, getLabel) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    selectEl.appendChild(opt);
  }
}

function safeText(v) {
  return v != null ? String(v) : "";
}

// Find shop results UI: reuse existing DOM but with backend data
function appendFindShopResultRow(resultsEl, shop, distKm) {
  const name = shop.name || "Barbearia";
  const base = String(window.location.origin || "").replace(/\/$/, "");
  const seg = shop.slug || (shop.name || "").toLowerCase().trim().replace(/\s+/g, "-");
  const href = seg ? base + "/" + encodeURIComponent(seg) : "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "find-shop-result-btn";

  const strong = document.createElement("strong");
  strong.textContent = name;
  btn.appendChild(strong);

  if (distKm != null && !isNaN(distKm)) {
    const distEl = document.createElement("span");
    distEl.className = "find-shop-result-dist";
    distEl.textContent = distKm.toFixed(1) + " km";
    btn.appendChild(distEl);
  }

  const addr = shop.address;
  if (addr && String(addr).trim()) {
    const ad = document.createElement("span");
    ad.className = "find-shop-result-addr";
    ad.textContent = String(addr).trim();
    btn.appendChild(ad);
  }

  if (href) {
    const span = document.createElement("span");
    span.className = "find-shop-result-url";
    span.textContent = href;
    btn.appendChild(span);
  }

  btn.addEventListener("click", function () {
    if (!href) return;
    window.location.href = href;
  });
  btn.disabled = !href;
  resultsEl.appendChild(btn);
}

function getCurrentPositionPromise() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error("Este navegador não suporta geolocalização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 120000,
    });
  });
}

async function runFindShopSearch() {
  const input = $("findShopQuery");
  const q = (input && input.value) || "";
  const qRaw = q.toLowerCase().trim();
  const resultsEl = $("findShopResults");
  if (resultsEl) {
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  }
  if (qRaw.length < 2) {
    setFindShopStatus("Escreva pelo menos 2 letras do nome.", true);
    return;
  }
  setFindShopStatus("A procurar…");
  try {
    await NaReguaApi.ensureGuestToken();
    const res = await NaReguaApi.publicSearchShops(qRaw);
    const items = (res && res.items) || [];
    if (!resultsEl) return;
    if (!items.length) {
      setFindShopStatus(
        "Nenhuma barbearia encontrada. Tente outras letras ou peça o link direto à loja."
      );
      return;
    }
    setFindShopStatus(items.length + " resultado(s). Toque numa loja para agendar.");
    items.forEach(function (shop) {
      appendFindShopResultRow(resultsEl, shop, null);
    });
    resultsEl.hidden = false;
  } catch (e) {
    setFindShopStatus(e.message || "Erro ao procurar.", true);
  }
}

async function runFindShopNearby() {
  const resultsEl = $("findShopResults");
  if (resultsEl) {
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  }
  let maxKm = parseFloat(
    ($("findNearbyRadius") && $("findNearbyRadius").value) || "40",
    10
  );
  if (isNaN(maxKm) || maxKm < 1) maxKm = 40;
  setFindShopStatus("A obter localização…");
  try {
    await NaReguaApi.ensureGuestToken();
    const pos = await getCurrentPositionPromise();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    setFindShopStatus("A procurar barbearias até " + maxKm + " km…");
    const res = await NaReguaApi.publicNearby(lat, lng, maxKm);
    const items = (res && res.items) || [];
    if (!resultsEl) return;
    if (!items.length) {
      setFindShopStatus(
        "Nenhuma barbearia com localização neste raio. Aumente o raio ou use a busca por nome."
      );
      return;
    }
    setFindShopStatus(items.length + " resultado(s). Toque para agendar.");
    items.forEach(function (shop) {
      appendFindShopResultRow(resultsEl, shop, shop.distKm);
    });
    resultsEl.hidden = false;
  } catch (e) {
    const code = e && e.code;
    let msg = e.message || "Erro";
    if (code === 1) msg = "Permissão de localização negada.";
    if (code === 2) msg = "Localização indisponível.";
    if (code === 3) msg = "Tempo esgotado ao obter localização.";
    setFindShopStatus(msg, true);
  }
}

// Booking page (public)
async function loadBookingBySlug(slug) {
  setStatus("A carregar…");
  try {
    await NaReguaApi.ensureGuestToken();
    const shopRes = await NaReguaApi.publicShopBySlug(slug);
    const shop = shopRes && shopRes.shop;
    const shopId = shopRes && shopRes.shopId;
    if (!shop || !shopId) throw new Error("Barbearia não encontrada.");

    window.__shopId = shopId;
    window.__shop = shop;

    applyBookingHeadlines(shop.name || "");
    showBookingApp(shop.name || "");

    // date default
    const dateEl = $("dateKey");
    if (dateEl) dateEl.value = toDateKey(new Date());

    // location card (address)
    const addr = (shop.address || "").trim();
    const locCard = $("shopLocationCard");
    const addrEl = $("shopAddress");
    if (locCard) locCard.hidden = !addr;
    if (addrEl) addrEl.textContent = addr;
    const mapsLink = $("openShopMapsLink");
    if (mapsLink && addr) {
      mapsLink.href =
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(addr);
    }

    // load barbers/services
    const barbersRes = await NaReguaApi.publicBarbers(shopId);
    const servicesRes = await NaReguaApi.publicServices(shopId);
    window.__barbers = (barbersRes && barbersRes.items) || [];
    window.__services = (servicesRes && servicesRes.items) || [];

    const barberSel = $("barberSelect");
    const svcSel = $("serviceSelect");
    if (barberSel) {
      renderOptions(
        barberSel,
        window.__barbers,
        (b) => b.id,
        (b) => b.name || "Barbeiro"
      );
    }
    if (svcSel) {
      renderOptions(
        svcSel,
        window.__services,
        (s) => s.id,
        (s) => (s.name || "Serviço") + " (" + (s.priceCents / 100).toFixed(2) + ")"
      );
    }

    await refreshAppointmentsAndSlots();
  } catch (e) {
    setStatus(e.message || "Erro ao carregar.", true);
  }
}

function getSelectedBookingContext() {
  const shopId = window.__shopId || "";
  const dateKey = ($("dateKey") && $("dateKey").value) || "";
  const barberId = ($("barberSelect") && $("barberSelect").value) || "";
  const serviceId = ($("serviceSelect") && $("serviceSelect").value) || "";
  const timeLabel = window.__selectedTimeLabel || "";
  const clientName = ($("clientName") && $("clientName").value) || "";
  const clientPhone = ($("clientPhone") && $("clientPhone").value) || "";
  const service = (window.__services || []).find((s) => s.id === serviceId) || null;
  return { shopId, dateKey, barberId, timeLabel, clientName, clientPhone, service };
}

async function refreshAppointmentsAndSlots() {
  const shopId = window.__shopId || "";
  const dateKey = ($("dateKey") && $("dateKey").value) || "";
  const barberId = ($("barberSelect") && $("barberSelect").value) || "";
  if (!shopId || !dateKey || !barberId) return;

  const res = await NaReguaApi.publicAppointments(shopId, dateKey);
  const appts = (res && res.items) || [];
  renderClientAvailabilityFromAppts(appts, shopId, dateKey, barberId);
}

// Copied & trimmed from old app.js (no firebase dependencies)
function renderDayAgenda(barber, dateKey, apptsForBarber) {
  const host = $("dayAgenda");
  if (!host) return;
  host.innerHTML = "";
  const rows = window.NaReguaSchedule.buildDayAgendaList(
    barber.scheduleByDay || {},
    dateKey,
    apptsForBarber,
    new Date()
  );
  if (!rows.length) {
    host.innerHTML = '<p class="muted">Sem expediente neste dia.</p>';
    return;
  }
  rows.forEach(function (r) {
    const row = document.createElement("div");
    row.className = "day-agenda-row day-agenda-row--" + (r.state || "free");
    const left = document.createElement("div");
    left.className = "day-agenda-time";
    left.textContent = r.timeLabel || "";
    const mid = document.createElement("div");
    mid.className = "day-agenda-main";
    if (r.state === "lunch") {
      const t = document.createElement("strong");
      t.textContent = "ALMOÇO";
      const s = document.createElement("div");
      s.className = "muted";
      s.textContent = r.lunchSubtitle || "";
      mid.appendChild(t);
      mid.appendChild(s);
    } else if (r.state === "free") {
      mid.innerHTML = '<span class="muted">Livre</span>';
    } else if (r.state === "past") {
      mid.innerHTML = '<span class="muted">Horário encerrado</span>';
    } else {
      const nm = document.createElement("strong");
      nm.textContent = safeText(r.clientName || "—");
      const svc = document.createElement("div");
      svc.className = "muted";
      svc.textContent = safeText(r.serviceName || "");
      mid.appendChild(nm);
      if (svc.textContent) mid.appendChild(svc);
    }
    row.appendChild(left);
    row.appendChild(mid);
    host.appendChild(row);
  });
}

function renderClientAvailabilityFromAppts(appts, shopId, dateKey, barberId) {
  const slotsEl = $("slots");
  const cancelBtn = $("cancelBtn");
  if (cancelBtn) {
    cancelBtn.hidden = true;
    cancelBtn.dataset.appointmentId = "";
  }

  const barber = (window.__barbers || []).find(function (b) {
    return b.id === barberId;
  });
  if (!barber) {
    if (slotsEl) slotsEl.innerHTML = "";
    setStatus("Barbeiro inválido.", true);
    return;
  }

  const taken = new Set();
  appts.forEach(function (a) {
    if (a.barberId === barberId && a.status !== "CANCELLED") {
      taken.add(a.timeLabel);
    }
  });

  const forBarber = appts.filter(function (a) {
    return a.barberId === barberId && a.status !== "CANCELLED";
  });
  renderDayAgenda(barber, dateKey, forBarber);

  const rawSlots = window.NaReguaSchedule.availableSlotLabels(
    barber.scheduleByDay,
    dateKey,
    taken
  );
  const now = new Date();
  const slots = rawSlots.filter(function (t) {
    return !window.NaReguaSchedule.isSlotLabelPast(dateKey, t, now);
  });

  if (!slotsEl) return;
  slotsEl.innerHTML = "";
  window.__selectedTimeLabel = null;

  if (!slots.length) {
    if (rawSlots.length) {
      slotsEl.innerHTML =
        '<p class="muted">Os horários deste dia para este barbeiro já passaram. Tente amanhã ou outro dia.</p>';
      setStatus("Sem horários futuros para marcar neste dia.");
    } else {
      slotsEl.innerHTML = '<p class="muted">Sem horários livres neste dia para este barbeiro.</p>';
      setStatus("Escolha outra data ou outro barbeiro.");
    }
    return;
  }

  slots.forEach(function (t) {
    const btn = document.createElement("button");
    btn.className = "slot";
    btn.type = "button";
    btn.textContent = t;
    btn.addEventListener("click", function () {
      window.__selectedTimeLabel = t;
      slotsEl.querySelectorAll(".slot").forEach(function (b) {
        b.classList.remove("selected");
      });
      btn.classList.add("selected");
    });
    slotsEl.appendChild(btn);
  });

  setStatus("Toque em um horário livre.");
}

async function bookClick() {
  const ctx = getSelectedBookingContext();
  if (!ctx.shopId) return;
  if (!ctx.dateKey || !ctx.barberId || !ctx.service || !ctx.timeLabel) {
    setStatus("Escolha data, barbeiro, serviço e horário.", true);
    return;
  }
  if (!String(ctx.clientName || "").trim()) {
    setStatus("Informe o seu nome.", true);
    return;
  }
  if (!String(ctx.clientPhone || "").trim()) {
    setStatus("Informe o telefone.", true);
    return;
  }

  setStatus("A marcar…");
  try {
    await NaReguaApi.publicBook(ctx.shopId, {
      barberId: ctx.barberId,
      dateKey: ctx.dateKey,
      timeLabel: ctx.timeLabel,
      clientName: String(ctx.clientName).trim(),
      clientPhone: String(ctx.clientPhone).trim(),
      serviceId: ctx.service.id,
      serviceName: ctx.service.name,
      servicePriceCents: Number(ctx.service.priceCents) || 0,
    });
    setStatus("Agendamento confirmado!");
    await refreshAppointmentsAndSlots();
  } catch (e) {
    setStatus(e.message || "Erro ao marcar.", true);
    await refreshAppointmentsAndSlots().catch(function () {});
  }
}

async function init() {
  // Disable owner portal (for now)
  const btnLogin = $("btnLoginShop");
  if (btnLogin) {
    btnLogin.addEventListener("click", function () {
      setHomeStatus("Painel da barbearia (web) está em migração. Use o app Android por enquanto.", true);
    });
  }
  const btnRegister = $("btnHeroRegisterShop");
  if (btnRegister) {
    btnRegister.addEventListener("click", function () {
      setHomeStatus("Cadastro via web está em migração. Use o app Android por enquanto.", true);
    });
  }

  // Find shop
  const btnFind = $("btnFindShop");
  if (btnFind) {
    btnFind.addEventListener("click", function () {
      $("findStub").hidden = false;
      setHomeStatus("");
    });
  }
  const back = $("findStubBack");
  if (back) {
    back.addEventListener("click", function () {
      $("findStub").hidden = true;
      const res = $("findShopResults");
      if (res) {
        res.hidden = true;
        res.innerHTML = "";
      }
      setFindShopStatus("");
    });
  }
  const form = $("findShopForm");
  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      runFindShopSearch().catch(function () {});
    });
  }
  const nearBtn = $("findNearbyBtn");
  if (nearBtn) {
    nearBtn.addEventListener("click", function () {
      runFindShopNearby().catch(function () {});
    });
  }

  // Public booking?
  const slug = getSlugFromPath();
  if (slug) {
    await loadBookingBySlug(slug);
    const dateEl = $("dateKey");
    const barberSel = $("barberSelect");
    if (dateEl) dateEl.addEventListener("change", () => refreshAppointmentsAndSlots().catch(() => {}));
    if (barberSel) barberSel.addEventListener("change", () => refreshAppointmentsAndSlots().catch(() => {}));
    const bookBtn = $("bookBtn");
    if (bookBtn) bookBtn.addEventListener("click", () => bookClick().catch(() => {}));
  } else {
    showLandingHome();
  }
}

init().catch(function (e) {
  console.error(e);
  setHomeStatus(e.message || "Erro ao iniciar.", true);
});

