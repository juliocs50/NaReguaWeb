/* global NaReguaApi */

/**
 * REST-based client (Render backend) for:
 * - Find shop by name / nearby
 * - Public booking page (/slug)
 * - Owner login (limited: list/add/edit barbers)
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
  const owner = $("ownerPortal");
  if (owner) owner.hidden = true;
  const badge = $("shopBadge");
  if (badge) {
    badge.hidden = true;
    const t = $("shopBadgeText");
    if (t) t.textContent = "";
    const av = badge.querySelector(".shop-badge-avatar");
    if (av) av.innerHTML = "";
  }
}

function showBookingApp(shopName) {
  document.body.classList.remove("layout-landing");
  document.body.classList.add("layout-app");
  const app = $("app");
  if (app) app.hidden = false;
  const home = $("homeLanding");
  if (home) home.hidden = true;
  const owner = $("ownerPortal");
  if (owner) owner.hidden = true;
  const badge = $("shopBadge");
  if (badge) {
    badge.hidden = false;
    const t = $("shopBadgeText");
    if (t) t.textContent = shopName || "";
  }
}

function showOwnerPortal(shopName) {
  document.body.classList.remove("layout-landing");
  document.body.classList.add("layout-app");
  const app = $("app");
  if (app) app.hidden = true;
  const home = $("homeLanding");
  if (home) home.hidden = true;
  const owner = $("ownerPortal");
  if (owner) owner.hidden = false;
  const title = $("ownerShopTitle");
  if (title) title.textContent = shopName || "Barbearia";
  const badge = $("shopBadge");
  if (badge) {
    badge.hidden = false;
    const t = $("shopBadgeText");
    if (t) t.textContent = shopName || "";
  }
}

function setAvatarCircle(el, dataUrl, fallbackText) {
  if (!el) return;
  el.innerHTML = "";
  const raw = (dataUrl || "").trim();
  if (raw && raw.startsWith("data:image/")) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = raw;
    el.appendChild(img);
    return;
  }
  const span = document.createElement("span");
  span.textContent = (fallbackText || "?").trim().slice(0, 1).toUpperCase();
  el.appendChild(span);
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

function normalizeWeekdayLabel(n) {
  return ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][n] || "";
}

async function ownerLoginSubmit() {
  const email = ($("ownerEmail") && $("ownerEmail").value) || "";
  const password = ($("ownerPassword") && $("ownerPassword").value) || "";
  if (!email.trim() || !password) {
    setHomeStatus("Preencha e-mail e senha.", true);
    return;
  }
  setHomeStatus("A entrar…");
  try {
    const res = await NaReguaApi.authLogin(email, password);
    NaReguaApi.setOwnerToken(res.token);
    const me = await NaReguaApi.usersMe();
    const shop = me.shop;
    if (!shop || !shop.id) throw new Error("Conta sem barbearia associada.");
    window.__ownerShopId = shop.id;
    window.__ownerShopName = shop.name || "";
    setHomeStatus("");
    showOwnerPortal(window.__ownerShopName);
    // load full shop (avatar) for header
    try {
      const full = await NaReguaApi.publicShopById(shop.id);
      if (full && full.shop) {
        const s = full.shop;
        const badge = $("shopBadge");
        if (badge) {
          const av = badge.querySelector(".shop-badge-avatar");
          setAvatarCircle(av, s.avatarDataUrl, s.name || "?");
        }
      }
    } catch (_e) {}
    await loadOwnerBarbersPanel();
  } catch (e) {
    setHomeStatus(e.message || "Falha ao entrar.", true);
  }
}

function ownerLogoutClick() {
  NaReguaApi.setOwnerToken("");
  window.__ownerShopId = null;
  window.__ownerShopName = null;
  showLandingHome();
  setHomeStatus("Sessão encerrada.");
}

function openOwnerBarberEdit(barber) {
  if (!barber) return;
  window.__ownerEditingBarber = barber;
  const ov = $("ownerBarberEditOverlay");
  const nameEl = $("ownerBarberEditName");
  const daysHost = $("ownerBarberEditDays");
  if (nameEl) nameEl.value = barber.name || "";
  if (daysHost) {
    const days = barber.scheduleByDay || {};
    const working = Object.keys(days)
      .map((k) => parseInt(k, 10))
      .filter(
        (d) => d >= 1 && d <= 7 && days[String(d)] && days[String(d)].isWorking
      )
      .sort((a, b) => a - b)
      .map(normalizeWeekdayLabel)
      .join(", ");
    daysHost.innerHTML =
      '<p class="muted">Editor completo de horários (web) entra na próxima etapa. Hoje você pode editar o nome aqui.</p>' +
      (working ? '<p class="muted">Dias: ' + working + "</p>" : "");
  }
  if (ov) ov.hidden = false;
}

async function saveOwnerBarberEdit() {
  const b = window.__ownerEditingBarber;
  const shopId = window.__ownerShopId;
  if (!b || !shopId) return;
  const name = ($("ownerBarberEditName") && $("ownerBarberEditName").value) || "";
  if (!name.trim()) {
    setHomeStatus("Informe o nome do barbeiro.", true);
    return;
  }
  setHomeStatus("A salvar…");
  try {
    await NaReguaApi.ownerPatchBarber(shopId, b.id, { name: name.trim() });
    const ov = $("ownerBarberEditOverlay");
    if (ov) ov.hidden = true;
    window.__ownerEditingBarber = null;
    setHomeStatus("Barbeiro atualizado.");
    await loadOwnerBarbersPanel();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao salvar.", true);
  }
}

function closeOwnerBarberEdit() {
  const ov = $("ownerBarberEditOverlay");
  if (ov) ov.hidden = true;
  window.__ownerEditingBarber = null;
}

async function loadOwnerBarbersPanel() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const listEl = $("ownerBarbersList");
  if (listEl) listEl.innerHTML = '<p class="muted">A carregar…</p>';
  try {
    const res = await NaReguaApi.publicBarbers(shopId);
    const items = (res && res.items) || [];
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<p class="muted">Nenhum barbeiro cadastrado.</p>';
      return;
    }
    listEl.innerHTML = "";
    items.forEach(function (b) {
      const card = document.createElement("div");
      card.className = "owner-barber-card";

      const avatarCol = document.createElement("div");
      avatarCol.style.display = "flex";
      avatarCol.style.flexDirection = "column";
      avatarCol.style.alignItems = "center";
      avatarCol.style.gap = "6px";
      avatarCol.style.width = "88px";

      const av = document.createElement("span");
      av.className = "avatar-circle avatar-circle--md";
      setAvatarCircle(av, b.avatarDataUrl, b.name || "?");
      avatarCol.appendChild(av);

      const nm = document.createElement("div");
      nm.style.fontWeight = "600";
      nm.style.fontSize = "0.92rem";
      nm.style.textAlign = "center";
      nm.style.maxWidth = "88px";
      nm.style.overflow = "hidden";
      nm.style.textOverflow = "ellipsis";
      nm.style.whiteSpace = "nowrap";
      nm.textContent = b.name || "Barbeiro";
      avatarCol.appendChild(nm);

      const main = document.createElement("div");
      main.className = "owner-barber-card-main";

      const days = b.scheduleByDay || {};
      const working = Object.keys(days)
        .map((k) => parseInt(k, 10))
        .filter(
          (d) => d >= 1 && d <= 7 && days[String(d)] && days[String(d)].isWorking
        )
        .sort((a, b2) => a - b2)
        .map(normalizeWeekdayLabel)
        .join(", ");

      const sub = document.createElement("p");
      sub.className = "owner-barber-card-sub";
      sub.textContent = working ? "Dias: " + working : "Sem dias de trabalho definidos";
      main.appendChild(sub);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline btn-sm";
      btn.textContent = "Editar";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openOwnerBarberEdit(b);
      });

      card.appendChild(avatarCol);
      card.appendChild(main);
      card.appendChild(btn);
      listEl.appendChild(card);
    });
  } catch (e) {
    if (listEl)
      listEl.innerHTML =
        '<p class="muted err">' + (e.message || "Erro") + "</p>";
  }
}

async function ownerAddBarberSubmit(ev) {
  ev.preventDefault();
  const shopId = window.__ownerShopId;
  const input = $("ownerNewBarberName");
  const name = (input && input.value) || "";
  if (!shopId) return;
  if (!name.trim()) return;
  setHomeStatus("A adicionar…");
  try {
    await NaReguaApi.ownerAddBarber(shopId, name.trim());
    if (input) input.value = "";
    setHomeStatus("Barbeiro adicionado.");
    await loadOwnerBarbersPanel();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao adicionar.", true);
  }
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

    // shop avatar (like APK header)
    setAvatarCircle($("bookingShopAvatar"), shop.avatarDataUrl, shop.name || "?");
    const badge = $("shopBadge");
    if (badge) {
      const av = badge.querySelector(".shop-badge-avatar");
      setAvatarCircle(av, shop.avatarDataUrl, shop.name || "?");
    }

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
      barberSel.addEventListener("change", function () {
        try {
          renderSelectedBarberCard();
        } catch (_e) {}
      });
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
    renderSelectedBarberCard();
  } catch (e) {
    setStatus(e.message || "Erro ao carregar.", true);
  }
}

function renderSelectedBarberCard() {
  const card = $("selectedBarberCard");
  const sel = $("barberSelect");
  if (!card || !sel) return;
  const barberId = sel.value || "";
  const b = (window.__barbers || []).find((x) => x.id === barberId);
  if (!b) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("bookingBarberName").textContent = b.name || "Barbeiro";
  setAvatarCircle($("bookingBarberAvatar"), b.avatarDataUrl, b.name || "?");
  const days = b.scheduleByDay || {};
  const working = Object.keys(days)
    .map((k) => parseInt(k, 10))
    .filter((d) => d >= 1 && d <= 7 && days[String(d)] && days[String(d)].isWorking)
    .sort((a, b2) => a - b2)
    .map(normalizeWeekdayLabel)
    .join(", ");
  $("bookingBarberDays").textContent = working ? "Dias: " + working : "";
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
  // Owner login (REST)
  const btnLogin = $("btnLoginShop");
  const loginCard = $("loginCard");
  if (btnLogin && loginCard) {
    btnLogin.addEventListener("click", function () {
      loginCard.hidden = false;
      setHomeStatus("");
    });
  }
  const ownerLoginBtn = $("ownerLoginSubmit");
  if (ownerLoginBtn) {
    ownerLoginBtn.addEventListener("click", function () {
      ownerLoginSubmit().catch(function () {});
    });
  }
  const ownerLoginCancel = $("ownerLoginCancel");
  if (ownerLoginCancel) {
    ownerLoginCancel.addEventListener("click", function () {
      if (loginCard) loginCard.hidden = true;
      setHomeStatus("");
    });
  }
  const ownerLogoutBtn = $("ownerLogoutBtn");
  if (ownerLogoutBtn) ownerLogoutBtn.addEventListener("click", ownerLogoutClick);

  const addBarberForm = $("ownerAddBarberForm");
  if (addBarberForm) addBarberForm.addEventListener("submit", ownerAddBarberSubmit);

  const barberEditSave = $("ownerBarberEditSave");
  if (barberEditSave) {
    barberEditSave.addEventListener("click", function () {
      saveOwnerBarberEdit().catch(function () {});
    });
  }
  const barberEditCancel = $("ownerBarberEditCancel");
  if (barberEditCancel) barberEditCancel.addEventListener("click", closeOwnerBarberEdit);

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

  // Auto-restore owner session
  if (NaReguaApi.getOwnerToken && NaReguaApi.getOwnerToken()) {
    try {
      const me = await NaReguaApi.usersMe();
      const shop = me.shop;
      if (shop && shop.id) {
        window.__ownerShopId = shop.id;
        window.__ownerShopName = shop.name || "";
        showOwnerPortal(window.__ownerShopName);
        // load full shop (avatar) for header
        try {
          const full = await NaReguaApi.publicShopById(shop.id);
          if (full && full.shop) {
            const s = full.shop;
            const badge = $("shopBadge");
            if (badge) {
              const av = badge.querySelector(".shop-badge-avatar");
              setAvatarCircle(av, s.avatarDataUrl, s.name || "?");
            }
          }
        } catch (_e) {}
        await loadOwnerBarbersPanel();
      }
    } catch (_e) {
      NaReguaApi.setOwnerToken("");
    }
  }
}

init().catch(function (e) {
  console.error(e);
  setHomeStatus(e.message || "Erro ao iniciar.", true);
});

