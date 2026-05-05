/* global NaReguaApi */

/**
 * REST-based client (Render backend) for:
 * - Find shop by name / nearby
 * - Public booking page (/slug)
 * - Owner login (limited: list/add/edit barbers)
 */

const $ = (id) => document.getElementById(id);

/** [hidden] + CSS author (ex.: .landing-page flex) — usar isto em vez de só .hidden onde interessa. */
function setElHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}

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

/** GitHub Pages em /user/repo/ — o primeiro segmento é o repo, não o slug. Inferimos o prefixo pelo URL do app-rest.js. */
var __nareguaStaticBasePath;
function inferStaticBasePathFromScript() {
  try {
    const el = document.querySelector('script[src*="app-rest"]');
    if (!el) return "";
    const src = el.getAttribute("src") || "";
    const abs = new URL(src, window.location.href);
    let p = String(abs.pathname || "").replace(/\\/g, "/");
    const lower = p.toLowerCase();
    const cut = lower.lastIndexOf("/app-rest");
    if (cut >= 0) p = p.slice(0, cut);
    return p.replace(/\/$/, "") || "";
  } catch (_e) {
    return "";
  }
}

function getStaticBasePath() {
  if (__nareguaStaticBasePath === void 0) {
    __nareguaStaticBasePath = inferStaticBasePathFromScript();
  }
  return __nareguaStaticBasePath || "";
}

function pathWithoutStaticBase(pathname) {
  let full = String(pathname || "/").replace(/\\/g, "/");
  if (full.length > 1 && full.endsWith("/")) full = full.slice(0, -1);
  const base = getStaticBasePath();
  if (!base) return full || "/";
  if (full === base) return "/";
  const pref = base + "/";
  if (full.startsWith(pref)) {
    const rest = full.slice(pref.length);
    return rest ? "/" + rest : "/";
  }
  return full;
}

function getSlugFromPath() {
  try {
    const qp = new URLSearchParams(window.location.search || "");
    const from404 = (qp.get("p") || "").trim();
    if (from404) return from404;
  } catch (_e) {}
  let path = pathWithoutStaticBase(window.location.pathname || "/");
  if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (first === "public") return null;
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
  stopPublicBookingPoll();
  document.body.classList.remove("layout-app");
  document.body.classList.add("layout-landing");
  const app = $("app");
  setElHidden(app, true);
  const home = $("homeLanding");
  setElHidden(home, false);
  const owner = $("ownerPortal");
  setElHidden(owner, true);
  const badge = $("shopBadge");
  if (badge) {
    setElHidden(badge, true);
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
  setElHidden(app, false);
  const home = $("homeLanding");
  setElHidden(home, true);
  const owner = $("ownerPortal");
  setElHidden(owner, true);
  const badge = $("shopBadge");
  if (badge) {
    setElHidden(badge, false);
    const t = $("shopBadgeText");
    if (t) t.textContent = shopName || "";
  }
}

function showOwnerPortal(shopName) {
  stopPublicBookingPoll();
  const app = $("app");
  setElHidden(app, true);
  const home = $("homeLanding");
  setElHidden(home, true);
  const loginCard = $("loginCard");
  setElHidden(loginCard, true);
  document.body.classList.remove("layout-landing");
  document.body.classList.add("layout-app");
  const owner = $("ownerPortal");
  setElHidden(owner, false);
  const title = $("ownerShopTitle");
  if (title) title.textContent = shopName || "Barbearia";
  const badge = $("shopBadge");
  if (badge) {
    setElHidden(badge, false);
    const t = $("shopBadgeText");
    if (t) t.textContent = shopName || "";
  }
  // Sempre alinhar painéis ao entrar (login manual não chamava switchOwnerTab antes).
  switchOwnerTab("barbers");
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

// ===== Owner Inbox (Log) =====
const INBOX_SOUND_ENABLED_KEY = "barbxgo_owner_inbox_sound";
const OWNER_INBOX_LAST_CLOSED_PREFIX = "barbxgo_owner_inbox_last_closed_";

let ownerInboxPollTimer = null;
let ownerInboxOverlayOpen = false;
let ownerInboxUnread = 0;

/** Cliente em /slug: atualizar grade e slots quando outros marcam ou a loja cancela. */
let publicBookingPollTimer = null;

function stopPublicBookingPoll() {
  if (publicBookingPollTimer) clearInterval(publicBookingPollTimer);
  publicBookingPollTimer = null;
}

function startPublicBookingPoll() {
  stopPublicBookingPoll();
  publicBookingPollTimer = setInterval(function () {
    refreshAppointmentsAndSlots().catch(function () {});
  }, 3000);
}

function ownerInboxLastClosedStorageKey(shopId, barberId) {
  const s = String(shopId || "").replace(/\|/g, "");
  const b = String(barberId || "").replace(/\|/g, "");
  return OWNER_INBOX_LAST_CLOSED_PREFIX + s + "|" + b;
}

function getOwnerInboxLastClosedMillis(shopId, barberId) {
  try {
    const raw = localStorage.getItem(ownerInboxLastClosedStorageKey(shopId, barberId));
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch (_e) {}
  return Number.POSITIVE_INFINITY;
}

function setOwnerInboxLastClosedNow(shopId, barberId) {
  if (!shopId) return;
  try {
    localStorage.setItem(ownerInboxLastClosedStorageKey(shopId, barberId), String(Date.now()));
  } catch (_e) {}
}

function isInboxSoundEnabled() {
  try {
    return localStorage.getItem(INBOX_SOUND_ENABLED_KEY) === "1";
  } catch (_e) {
    return false;
  }
}

function setInboxSoundEnabled(v) {
  try {
    localStorage.setItem(INBOX_SOUND_ENABLED_KEY, v ? "1" : "0");
  } catch (_e) {}
}

function playInboxBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(function () {
      try {
        o.stop();
        ctx.close();
      } catch (_e) {}
    }, 180);
  } catch (_e) {}
}

function setOwnerInboxBadge(n) {
  const b = $("ownerInboxBadge");
  if (!b) return;
  const v = Number(n || 0);
  b.hidden = v <= 0;
  b.textContent = v > 9 ? "9+" : String(v);
}

function showOwnerInboxFab(show) {
  const fab = $("ownerInboxFab");
  if (!fab) return;
  fab.hidden = !show;
}

function renderOwnerInboxItem(msg, lastClosedMillis) {
  const wrap = document.createElement("div");
  wrap.className = "owner-inbox-item";
  const t = Number(msg.createdAtMillis || 0);
  const unread = Number.isFinite(lastClosedMillis) && t > lastClosedMillis;
  wrap.classList.add(unread ? "owner-inbox-item--unread" : "owner-inbox-item--read");
  const head = document.createElement("div");
  head.className = "owner-inbox-item-head";
  const title = document.createElement("p");
  title.className = "owner-inbox-item-title";
  title.textContent = msg.title || "Mensagem";
  const time = document.createElement("span");
  time.className = "owner-inbox-item-time";
  time.textContent = new Date(msg.createdAtMillis || Date.now()).toLocaleString("pt-BR");
  head.appendChild(title);
  head.appendChild(time);
  const body = document.createElement("div");
  body.className = "owner-inbox-item-body";
  body.textContent = msg.text || "";
  wrap.appendChild(head);
  wrap.appendChild(body);
  return { el: wrap, unread };
}

function openOwnerInboxOverlay(open) {
  ownerInboxOverlayOpen = !!open;
  const ov = $("ownerInboxOverlay");
  if (ov) ov.hidden = !ownerInboxOverlayOpen;
  if (ownerInboxOverlayOpen) {
    ownerInboxUnread = 0;
    setOwnerInboxBadge(0);
    const list = $("ownerInboxList");
    if (list) list.scrollTop = list.scrollHeight;
  } else {
    const shopId = window.__ownerShopId;
    const sel = $("ownerAgendaBarberSelect");
    const barberId = sel && sel.value ? String(sel.value) : "";
    setOwnerInboxLastClosedNow(shopId, barberId);
  }
}

async function loadOwnerInboxOnce() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const sel = $("ownerAgendaBarberSelect");
  const barberId = sel && sel.value ? String(sel.value) : "";
  const lastClosedMillis = getOwnerInboxLastClosedMillis(shopId, barberId);
  const res = await NaReguaApi.ownerInbox(shopId, barberId, 80);
  const items = (res && res.items) || [];
  const list = $("ownerInboxList");
  if (!list) return;
  list.innerHTML = "";
  let unread = 0;
  items.forEach(function (m) {
    const it = renderOwnerInboxItem(m, lastClosedMillis);
    list.appendChild(it.el);
    if (it.unread) unread += 1;
  });
  if (!ownerInboxOverlayOpen) {
    ownerInboxUnread = unread;
    setOwnerInboxBadge(unread);
    if (unread > 0 && isInboxSoundEnabled()) playInboxBeep();
  }
}

function stopOwnerInboxPoll() {
  if (ownerInboxPollTimer) clearInterval(ownerInboxPollTimer);
  ownerInboxPollTimer = null;
}

function startOwnerInboxPoll() {
  stopOwnerInboxPoll();
  ownerInboxPollTimer = setInterval(function () {
    loadOwnerInboxOnce().catch(function () {});
    refreshOwnerAgenda().catch(function () {});
  }, 2500);
  loadOwnerInboxOnce().catch(function () {});
  refreshOwnerAgenda().catch(function () {});
}

function switchOwnerTab(name) {
  const portal = $("ownerPortal");
  if (!portal) return;
  const allowed = {
    barbers: true,
    agenda: true,
    menu: true,
    finance: true,
    location: true,
    platformAdmin: true,
  };
  const raw = String(name == null ? "" : name).trim();
  const tab = allowed[raw] ? raw : "barbers";
  const panels = portal.querySelectorAll("[data-panel]");
  panels.forEach(function (p) {
    setElHidden(p, p.getAttribute("data-panel") !== tab);
  });
  const tabs = portal.querySelectorAll(".owner-tab");
  tabs.forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-owner-tab") === tab);
  });

  // Inbox FAB only on agenda
  if (tab === "agenda") {
    showOwnerInboxFab(true);
    startOwnerInboxPoll();
  } else {
    showOwnerInboxFab(false);
    stopOwnerInboxPoll();
  }
}


function shopPublicUrlFromShopData(shop) {
  const base = String(window.location.origin || "").replace(/\/$/, "");
  const seg = (shop && (shop.slug || shop.name)) ? String(shop.slug || shop.name) : "";
  const path = seg
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return path ? base + "/" + encodeURIComponent(path) : base + "/";
}

async function ownerCopyLinkClick() {
  const shop = window.__ownerShopFull;
  const url = shopPublicUrlFromShopData(shop || { name: window.__ownerShopName || "" });
  try {
    await navigator.clipboard.writeText(url);
    setHomeStatus("Link copiado.");
  } catch (_e) {
    setHomeStatus("Não foi possível copiar. Link: " + url, true);
  }
}

async function ownerWhatsAppClick() {
  const shop = window.__ownerShopFull;
  const url = shopPublicUrlFromShopData(shop || { name: window.__ownerShopName || "" });
  const nome = (shop && shop.name) || window.__ownerShopName || "a nossa barbearia";
  const text =
    "Olá! Agende em " + nome + " pelo Barb x Go — é só abrir o link e escolher horário:\n" + url;
  const wa = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(wa, "_blank", "noopener");
}

/** Avatar da loja + lista de barbeiros: não bloqueia o login (corre em paralelo). */
function loadOwnerPortalExtrasInBackground(shopId) {
  if (!shopId) return;
  void Promise.all([
    (async function () {
      try {
        const full = await NaReguaApi.publicShopById(shopId);
        if (full && full.shop) {
          const s = full.shop;
          window.__ownerShopFull = s;
          const badge = $("shopBadge");
          if (badge) {
            const av = badge.querySelector(".shop-badge-avatar");
            setAvatarCircle(av, s.avatarDataUrl, s.name || "?");
          }
        }
      } catch (_e) {}
    })(),
    loadOwnerBarbersPanel(),
  ]).catch(function () {});
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
    let shop = res.shop;
    if (!shop || !shop.id) {
      const me = await NaReguaApi.usersMe();
      shop = me.shop;
    }
    if (!shop || !shop.id) throw new Error("Conta sem barbearia associada.");
    window.__ownerShopId = shop.id;
    window.__ownerShopName = shop.name || "";
    setHomeStatus("");
    showOwnerPortal(window.__ownerShopName);
    loadOwnerPortalExtrasInBackground(shop.id);
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
    const schedule = barber.scheduleByDay || {};
    daysHost.innerHTML = "";

    function mkTimeInput(id, value) {
      const inp = document.createElement("input");
      inp.type = "time";
      inp.value = value || "";
      inp.id = id;
      return inp;
    }

    function mkNumberInput(id, value) {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "5";
      inp.step = "5";
      inp.value = String(value != null ? value : 30);
      inp.id = id;
      return inp;
    }

    let prevDayState = null;
    for (let day = 1; day <= 7; day++) {
      const ds = schedule[String(day)] || {
        isWorking: day <= 5,
        startTime: "09:00",
        endTime: "18:00",
        intervalMinutes: 30,
        lunchStart: day <= 5 ? "12:00" : null,
        lunchEnd: day <= 5 ? "13:00" : null,
      };

      const wrap = document.createElement("div");
      wrap.className = "owner-day-edit-card";

      const top = document.createElement("div");
      top.className = "owner-day-edit-top";

      const label = document.createElement("strong");
      label.textContent = normalizeWeekdayLabel(day);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.flexWrap = "wrap";

      const chkLabel = document.createElement("label");
      chkLabel.className = "field";
      chkLabel.style.flexDirection = "row";
      chkLabel.style.alignItems = "center";
      chkLabel.style.gap = "8px";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!ds.isWorking;
      chk.dataset.day = String(day);
      chkLabel.appendChild(chk);
      const chkTxt = document.createElement("span");
      chkTxt.className = "muted";
      chkTxt.textContent = "Trabalha";
      chkLabel.appendChild(chkTxt);
      right.appendChild(chkLabel);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-outline btn-sm";
      copyBtn.textContent = day === 1 ? "Copiar" : "Copiar " + normalizeWeekdayLabel(day - 1);
      copyBtn.disabled = day === 1;
      copyBtn.addEventListener("click", function () {
        if (!prevDayState) return;
        chk.checked = !!prevDayState.isWorking;
        start.value = prevDayState.startTime || "";
        end.value = prevDayState.endTime || "";
        interval.value = String(prevDayState.intervalMinutes != null ? prevDayState.intervalMinutes : 30);
        lunchS.value = prevDayState.lunchStart || "";
        lunchE.value = prevDayState.lunchEnd || "";
      });
      right.appendChild(copyBtn);

      top.appendChild(label);
      top.appendChild(right);

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
      grid.style.gap = "10px";

      const start = mkTimeInput("day_" + day + "_start", ds.startTime);
      const end = mkTimeInput("day_" + day + "_end", ds.endTime);
      const interval = mkNumberInput("day_" + day + "_interval", ds.intervalMinutes);
      const lunchS = mkTimeInput("day_" + day + "_lunchS", ds.lunchStart || "");
      const lunchE = mkTimeInput("day_" + day + "_lunchE", ds.lunchEnd || "");

      const mkField = (title, el) => {
        const f = document.createElement("label");
        f.className = "field";
        const sp = document.createElement("span");
        sp.className = "field-label";
        sp.textContent = title;
        f.appendChild(sp);
        f.appendChild(el);
        return f;
      };

      grid.appendChild(mkField("Início", start));
      grid.appendChild(mkField("Fim", end));
      grid.appendChild(mkField("Intervalo (min)", interval));
      grid.appendChild(mkField("Almoço início", lunchS));
      grid.appendChild(mkField("Almoço fim", lunchE));

      wrap.appendChild(top);
      wrap.appendChild(grid);
      daysHost.appendChild(wrap);

      prevDayState = ds;
    }
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
    const daysHost = $("ownerBarberEditDays");
    const scheduleByDay = {};
    if (daysHost) {
      for (let day = 1; day <= 7; day++) {
        const chk = daysHost.querySelector('input[type="checkbox"][data-day="' + day + '"]');
        const start = daysHost.querySelector("#day_" + day + "_start");
        const end = daysHost.querySelector("#day_" + day + "_end");
        const interval = daysHost.querySelector("#day_" + day + "_interval");
        const lunchS = daysHost.querySelector("#day_" + day + "_lunchS");
        const lunchE = daysHost.querySelector("#day_" + day + "_lunchE");
        scheduleByDay[String(day)] = {
          isWorking: !!(chk && chk.checked),
          startTime: start && start.value ? start.value : "09:00",
          endTime: end && end.value ? end.value : "18:00",
          intervalMinutes: interval && interval.value ? Number(interval.value) : 30,
          lunchStart: lunchS && lunchS.value ? lunchS.value : null,
          lunchEnd: lunchE && lunchE.value ? lunchE.value : null,
        };
      }
    }
    await NaReguaApi.ownerPatchBarber(shopId, b.id, {
      name: name.trim(),
      scheduleByDay: scheduleByDay,
    });
    const ov = $("ownerBarberEditOverlay");
    if (ov) ov.hidden = true;
    window.__ownerEditingBarber = null;
    setHomeStatus("Barbeiro atualizado.");
    await loadOwnerBarbersPanel();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao salvar.", true);
  }
}

async function loadOwnerAgendaPanel() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const barbersRes = await NaReguaApi.publicBarbers(shopId);
  const barbers = (barbersRes && barbersRes.items) || [];
  const sel = $("ownerAgendaBarberSelect");
  if (sel) {
    renderOptions(sel, barbers, (b) => b.id, (b) => b.name || "Barbeiro");
  }
  const dateEl = $("ownerAgendaDate");
  if (dateEl && !dateEl.value) dateEl.value = toDateKey(new Date());
  await refreshOwnerAgenda();
}

function renderOwnerAgendaBoard(barber, dateKey, appts) {
  const host = $("ownerAgendaBoard");
  if (!host) return;
  host.innerHTML = "";
  if (!barber) {
    host.innerHTML = '<p class="muted">Selecione um barbeiro.</p>';
    return;
  }
  const list = (appts || []).filter((a) => a.barberId === barber.id && a.status !== "CANCELLED");
  const rows = window.NaReguaSchedule.buildDayAgendaList(barber.scheduleByDay || {}, dateKey, list, new Date());
  if (!rows.length) {
    host.innerHTML = '<p class="muted">Sem expediente neste dia.</p>';
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "day-agenda-host";
  const byTime = {};
  (appts || []).forEach(function (a) {
    if (!a || !a.timeLabel) return;
    if ((a.status || "SCHEDULED") === "CANCELLED") return;
    if (String(a.barberId || "") !== String(barber.id || "")) return;
    byTime[String(a.timeLabel).trim()] = a;
  });
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

    // Ações (igual ao APK): marcar, bloquear, iniciar, finalizar, cancelar, liberar
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.style.justifyContent = "flex-end";

    function addAction(label, style, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn " + (style || "btn-outline") + " btn-sm";
      btn.textContent = label;
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        onClick();
      });
      actions.appendChild(btn);
    }

    if (r.state === "free") {
      addAction("Marcar", "btn-filled", function () {
        openOwnerBookModal({
          shopId: window.__ownerShopId,
          barberId: barber.id,
          dateKey: dateKey,
          timeLabel: r.timeLabel,
        });
      });
      addAction("Bloquear", "btn-outline", function () {
        setHomeStatus("A bloquear…");
        NaReguaApi.ownerReserve(window.__ownerShopId, {
          barberId: barber.id,
          dateKey: dateKey,
          timeLabel: r.timeLabel,
        })
          .then(function () {
            setHomeStatus("Horário bloqueado.");
            return refreshOwnerAgenda();
          })
          .catch(function (e) {
            setHomeStatus(e.message || "Erro ao bloquear.", true);
          });
      });
    } else {
      const apt = byTime[String(r.timeLabel || "").trim()] || null;
      const st = String((apt && apt.status) || "").toUpperCase();
      const appointmentId = (apt && apt.id) || (r.appointmentId || "");
      const phoneRaw = apt && apt.clientPhone ? String(apt.clientPhone) : "";
      const phoneDigits = phoneRaw.replace(/[^\d+]/g, "");

      if (st === "SCHEDULED") {
        if (phoneDigits) {
          addAction("Ligar", "btn-outline", function () {
            window.location.href = "tel:" + phoneDigits;
          });
        }
        addAction("Iniciar", "btn-filled", function () {
          setHomeStatus("A iniciar…");
          NaReguaApi.ownerStart(window.__ownerShopId, appointmentId)
            .then(function () {
              setHomeStatus("Atendimento iniciado.");
              return refreshOwnerAgenda();
            })
            .catch(function (e) {
              setHomeStatus(e.message || "Erro ao iniciar.", true);
            });
        });
        addAction("Cancelar", "btn-outline", function () {
          setHomeStatus("A cancelar…");
          NaReguaApi.ownerCancel(window.__ownerShopId, appointmentId)
            .then(function () {
              setHomeStatus("Agendamento cancelado.");
              return refreshOwnerAgenda();
            })
            .catch(function (e) {
              setHomeStatus(e.message || "Erro ao cancelar.", true);
            });
        });
      } else if (st === "IN_PROGRESS") {
        if (phoneDigits) {
          addAction("Ligar", "btn-outline", function () {
            window.location.href = "tel:" + phoneDigits;
          });
        }
        addAction("Finalizar", "btn-filled", function () {
          setHomeStatus("A finalizar…");
          NaReguaApi.ownerFinish(window.__ownerShopId, appointmentId)
            .then(function () {
              setHomeStatus("Atendimento finalizado.");
              return refreshOwnerAgenda();
            })
            .catch(function (e) {
              setHomeStatus(e.message || "Erro ao finalizar.", true);
            });
        });
        addAction("Cancelar", "btn-outline", function () {
          setHomeStatus("A cancelar…");
          NaReguaApi.ownerCancel(window.__ownerShopId, appointmentId)
            .then(function () {
              setHomeStatus("Agendamento cancelado.");
              return refreshOwnerAgenda();
            })
            .catch(function (e) {
              setHomeStatus(e.message || "Erro ao cancelar.", true);
            });
        });
      } else if (st === "RESERVED") {
        addAction("Libertar", "btn-outline", function () {
          setHomeStatus("A libertar…");
          NaReguaApi.ownerRelease(window.__ownerShopId, appointmentId)
            .then(function () {
              setHomeStatus("Horário liberado.");
              return refreshOwnerAgenda();
            })
            .catch(function (e) {
              setHomeStatus(e.message || "Erro ao libertar.", true);
            });
        });
      } else {
        // DONE / past / lunch: sem ações
      }
    }

    if (actions.childNodes.length) row.appendChild(actions);
    wrap.appendChild(row);
  });
  host.appendChild(wrap);
}

function closeOwnerBookModal() {
  const ov = $("ownerModalOverlay");
  if (ov) ov.hidden = true;
  window.__ownerBookCtx = null;
}

async function openOwnerBookModal(ctx) {
  if (!ctx || !ctx.shopId) return;
  window.__ownerBookCtx = ctx;
  const servicesRes = await NaReguaApi.ownerServices(ctx.shopId);
  window.__ownerServicesCache = (servicesRes && servicesRes.items) || [];
  const svcSel = $("ownerModalService");
  if (svcSel) {
    renderOptions(
      svcSel,
      window.__ownerServicesCache,
      (s) => s.id,
      (s) => (s.name || "Serviço") + " (" + (Number(s.priceCents || 0) / 100).toFixed(2) + ")"
    );
  }
  const meta = $("ownerModalMeta");
  if (meta) meta.textContent = ctx.timeLabel + " · " + ctx.dateKey;
  const nameEl = $("ownerModalClientName");
  if (nameEl) nameEl.value = "";
  const ov = $("ownerModalOverlay");
  if (ov) ov.hidden = false;
}

async function confirmOwnerBookModal() {
  const ctx = window.__ownerBookCtx;
  if (!ctx) return;
  const name = ($("ownerModalClientName") && $("ownerModalClientName").value) || "";
  const svcId = ($("ownerModalService") && $("ownerModalService").value) || "";
  const svc = (window.__ownerServicesCache || []).find((s) => s.id === svcId);
  if (!name.trim()) {
    setHomeStatus("Informe o nome do cliente.", true);
    return;
  }
  if (!svc) {
    setHomeStatus("Selecione um serviço.", true);
    return;
  }
  setHomeStatus("A marcar…");
  try {
    await NaReguaApi.ownerManual(ctx.shopId, {
      barberId: ctx.barberId,
      dateKey: ctx.dateKey,
      timeLabel: ctx.timeLabel,
      clientName: name.trim(),
      serviceId: svc.id,
      serviceName: svc.name,
      servicePriceCents: Number(svc.priceCents || 0) || 0,
    });
    closeOwnerBookModal();
    setHomeStatus("Horário marcado.");
    await refreshOwnerAgenda();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao marcar.", true);
  }
}

async function refreshOwnerAgenda() {
  const shopId = window.__ownerShopId;
  const sel = $("ownerAgendaBarberSelect");
  const dateEl = $("ownerAgendaDate");
  if (!shopId || !sel || !dateEl) return;
  const barberId = sel.value || "";
  const dateKey = dateEl.value || toDateKey(new Date());
  const barbersRes = await NaReguaApi.publicBarbers(shopId);
  const barbers = (barbersRes && barbersRes.items) || [];
  const barber = barbers.find((b) => b.id === barberId) || barbers[0] || null;
  if (barber && barber.id !== barberId) {
    sel.value = barber.id;
  }
  const apptsRes = await NaReguaApi.ownerAppointments(shopId, dateKey);
  const appts = (apptsRes && apptsRes.items) || [];
  renderOwnerAgendaBoard(barber, dateKey, appts);
}

async function loadOwnerServicesPanel() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const listEl = $("ownerServicesList");
  if (listEl) listEl.innerHTML = '<p class="muted">A carregar…</p>';
  const res = await NaReguaApi.ownerServices(shopId);
  const items = (res && res.items) || [];
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '<p class="muted">Sem serviços cadastrados.</p>';
    return;
  }
  listEl.innerHTML = "";
  items.forEach(function (s) {
    const row = document.createElement("div");
    row.className = "owner-list-item";
    row.innerHTML =
      "<strong>" +
      safeText(s.name) +
      '</strong> <span class="muted">' +
      (Number(s.priceCents || 0) / 100).toFixed(2) +
      " · " +
      Number(s.durationMinutes || 30) +
      " min</span>";
    listEl.appendChild(row);
  });
}

async function ownerAddServiceSubmit(ev) {
  ev.preventDefault();
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const name = ($("ownerSvcName") && $("ownerSvcName").value) || "";
  const price = ($("ownerSvcPrice") && $("ownerSvcPrice").value) || "";
  const duration = ($("ownerSvcDuration") && $("ownerSvcDuration").value) || "30";
  if (!name.trim()) return;
  const cents = Math.round(Number(price) * 100);
  if (!Number.isFinite(cents)) {
    setHomeStatus("Preço inválido.", true);
    return;
  }
  setHomeStatus("A adicionar…");
  try {
    await NaReguaApi.ownerAddService(shopId, {
      name: name.trim(),
      priceCents: cents,
      durationMinutes: Math.max(5, Number(duration) || 30),
    });
    if ($("ownerSvcName")) $("ownerSvcName").value = "";
    if ($("ownerSvcPrice")) $("ownerSvcPrice").value = "";
    setHomeStatus("Serviço adicionado.");
    await loadOwnerServicesPanel();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao adicionar serviço.", true);
  }
}

function formatBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function loadOwnerFinancePanel() {
  const shopId = window.__ownerShopId;
  const monthEl = $("ownerFinanceMonth");
  if (!shopId || !monthEl) return;
  const m = monthEl.value;
  if (!m) return;
  const res = await NaReguaApi.ownerFinance(shopId, m);
  $("ownerFinanceServiceTotal").textContent = formatBRL(res.serviceSumCents);
  $("ownerFinanceAppFeeTotal").textContent = formatBRL(res.appFeeSumCents);
  $("ownerFinanceChargedTotal").textContent = formatBRL(res.serviceSumCents + res.appFeeSumCents);
  $("ownerFinanceBarberBonusTotal").textContent = formatBRL(Math.floor(res.appFeeSumCents / 2));
  $("ownerFinanceAppProfitTotal").textContent = formatBRL(res.appFeeSumCents - Math.floor(res.appFeeSumCents / 2));
  $("ownerFinanceAppTotal").textContent = formatBRL(res.appFeeSumCents);

  const tbl = $("ownerFinanceTable");
  if (tbl) {
    const rows = (res.barbers || [])
      .map(function (b) {
        return (
          "<tr><td>" +
          safeText(b.name) +
          "</td><td class=\"num\">" +
          Number(b.doneCount || 0) +
          "</td><td class=\"num\">" +
          formatBRL(b.totalAppFeeCents) +
          "</td><td class=\"num\">" +
          formatBRL(b.serviceCents) +
          "</td></tr>"
        );
      })
      .join("");
    tbl.innerHTML =
      '<table class="owner-admin-shops-table"><thead><tr><th>Barbeiro</th><th>Feitos</th><th>Taxa app</th><th>Serviços</th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";
  }
  const blurb = $("ownerFinanceBlurb");
  if (blurb) blurb.textContent = "";
}

async function ownerSaveLocationClick() {
  const shopId = window.__ownerShopId;
  const ta = $("ownerAddressInput");
  if (!shopId || !ta) return;
  const address = String(ta.value || "").trim();
  setHomeStatus("A guardar…");
  try {
    await NaReguaApi.ownerPatchShop(shopId, { address: address });
    setHomeStatus("Localização guardada.");
    // refresh header shop cache
    const full = await NaReguaApi.publicShopById(shopId);
    if (full && full.shop) window.__ownerShopFull = full.shop;
  } catch (e) {
    setHomeStatus(e.message || "Erro ao guardar.", true);
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
  stopPublicBookingPoll();
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
    startPublicBookingPoll();
  } catch (e) {
    stopPublicBookingPoll();
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
  const prevSelected = String(window.__selectedTimeLabel || "").trim();
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
    window.__selectedTimeLabel = null;
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

  // Mostrar botão Cancelar só para quem marcou (mesma sessão guest)
  try {
    const guestId = NaReguaApi.getGuestId ? NaReguaApi.getGuestId() : "";
    if (guestId && cancelBtn) {
      const mine = appts.find(function (a) {
        return (
          a.barberId === barberId &&
          (a.status || "SCHEDULED") === "SCHEDULED" &&
          (a.createdBy || "CLIENT") === "CLIENT" &&
          String(a.clientUid || "") === String(guestId)
        );
      });
      if (mine && mine.id) {
        cancelBtn.hidden = false;
        cancelBtn.dataset.appointmentId = mine.id;
      }
    }
  } catch (_e) {}

  if (!slotsEl) return;
  slotsEl.innerHTML = "";

  if (!slots.length) {
    window.__selectedTimeLabel = null;
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

  if (prevSelected && slots.indexOf(prevSelected) >= 0) {
    window.__selectedTimeLabel = prevSelected;
    slotsEl.querySelectorAll(".slot").forEach(function (btn) {
      if (String(btn.textContent || "").trim() === prevSelected) {
        btn.classList.add("selected");
      }
    });
    setStatus("Toque em um horário livre.");
  } else {
    window.__selectedTimeLabel = null;
    if (prevSelected) {
      setStatus("O horário que tinha escolhido já não está livre. Escolha outro.", true);
    } else {
      setStatus("Toque em um horário livre.");
    }
  }
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
  const ownerShareLinkBtn = $("ownerShareLinkBtn");
  if (ownerShareLinkBtn) ownerShareLinkBtn.addEventListener("click", function () {
    ownerCopyLinkClick().catch(function () {});
  });
  const ownerShareWhatsAppBtn = $("ownerShareWhatsAppBtn");
  if (ownerShareWhatsAppBtn) ownerShareWhatsAppBtn.addEventListener("click", function () {
    ownerWhatsAppClick().catch(function () {});
  });

  const addBarberForm = $("ownerAddBarberForm");
  if (addBarberForm) addBarberForm.addEventListener("submit", ownerAddBarberSubmit);
  const addServiceForm = $("ownerAddServiceForm");
  if (addServiceForm) addServiceForm.addEventListener("submit", ownerAddServiceSubmit);
  const saveLocBtn = $("ownerSaveLocationBtn");
  if (saveLocBtn) saveLocBtn.addEventListener("click", function () {
    ownerSaveLocationClick().catch(function () {});
  });

  const barberEditSave = $("ownerBarberEditSave");
  if (barberEditSave) {
    barberEditSave.addEventListener("click", function () {
      saveOwnerBarberEdit().catch(function () {});
    });
  }
  const barberEditCancel = $("ownerBarberEditCancel");
  if (barberEditCancel) barberEditCancel.addEventListener("click", closeOwnerBarberEdit);

  const ownerModalConfirm = $("ownerModalConfirm");
  if (ownerModalConfirm) {
    ownerModalConfirm.addEventListener("click", function () {
      confirmOwnerBookModal().catch(function () {});
    });
  }
  const ownerModalCancel = $("ownerModalCancel");
  if (ownerModalCancel) ownerModalCancel.addEventListener("click", closeOwnerBookModal);

  // Owner tabs
  const portal = $("ownerPortal");
  if (portal) {
    portal.querySelectorAll(".owner-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const tab = btn.getAttribute("data-owner-tab") || "barbers";
        switchOwnerTab(tab);
        if (tab === "barbers") loadOwnerBarbersPanel().catch(function () {});
        if (tab === "agenda") loadOwnerAgendaPanel().catch(function () {});
        if (tab === "menu") loadOwnerServicesPanel().catch(function () {});
        if (tab === "finance") {
          const monthEl = $("ownerFinanceMonth");
          if (monthEl && !monthEl.value) {
            const now = new Date();
            monthEl.value =
              now.getFullYear() +
              "-" +
              String(now.getMonth() + 1).padStart(2, "0");
          }
          loadOwnerFinancePanel().catch(function () {});
        }
        if (tab === "location") {
          const ta = $("ownerAddressInput");
          const s = window.__ownerShopFull;
          if (ta && s && s.address != null) ta.value = String(s.address || "");
        }
      });
    });
    const ownerAgendaDate = $("ownerAgendaDate");
    if (ownerAgendaDate) {
      ownerAgendaDate.addEventListener("change", function () {
        refreshOwnerAgenda().catch(function () {});
      });
    }
    const ownerAgendaBarberSel = $("ownerAgendaBarberSelect");
    if (ownerAgendaBarberSel) {
      ownerAgendaBarberSel.addEventListener("change", function () {
        refreshOwnerAgenda().catch(function () {});
      });
    }
  }

  // Owner Inbox UI
  const inboxFab = $("ownerInboxFab");
  if (inboxFab) {
    inboxFab.addEventListener("click", function () {
      openOwnerInboxOverlay(true);
      loadOwnerInboxOnce().catch(function () {});
    });
  }
  const inboxClose = $("ownerInboxCloseBtn");
  if (inboxClose) inboxClose.addEventListener("click", function () {
    openOwnerInboxOverlay(false);
  });
  const inboxSoundBtn = $("ownerInboxSoundBtn");
  if (inboxSoundBtn) {
    const syncLabel = function () {
      inboxSoundBtn.textContent = isInboxSoundEnabled() ? "Desativar som" : "Ativar som";
    };
    syncLabel();
    inboxSoundBtn.addEventListener("click", function () {
      setInboxSoundEnabled(!isInboxSoundEnabled());
      syncLabel();
      if (isInboxSoundEnabled()) playInboxBeep();
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

    const cancelBtn = $("cancelBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        const shopId = window.__shopId || "";
        const id = cancelBtn.dataset.appointmentId || "";
        if (!shopId || !id) return;
        setStatus("A cancelar…");
        NaReguaApi.publicCancel(shopId, id)
          .then(function () {
            setStatus("Agendamento cancelado.");
            return refreshAppointmentsAndSlots();
          })
          .catch(function (e) {
            setStatus(e.message || "Não foi possível cancelar.", true);
            refreshAppointmentsAndSlots().catch(function () {});
          });
      });
    }
  } else {
    showLandingHome();
  }

  // Auto-restore owner session só na página inicial — não em links públicos /slug (agendamento).
  if (!slug && NaReguaApi.getOwnerToken && NaReguaApi.getOwnerToken()) {
    try {
      const me = await NaReguaApi.usersMe();
      const shop = me.shop;
      if (shop && shop.id) {
        window.__ownerShopId = shop.id;
        window.__ownerShopName = shop.name || "";
        showOwnerPortal(window.__ownerShopName);
        loadOwnerPortalExtrasInBackground(shop.id);
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

