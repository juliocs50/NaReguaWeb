/**
 * Agendamento direto no Firestore (igual conceito do app Android), com Auth anónima.
 * Requer: Firebase Console → Authentication → Sign-in method → Anonymous → Enable
 * Regras: firestore.rules com request.auth != null
 */
/* global firebase */

const $ = (id) => document.getElementById(id);

const APP_FEE_CENTS = 100;
const INBOX_SOUND_ENABLED_KEY = "barbxgo_owner_inbox_sound";
/** Por barbearia + barbeiro: última vez que o painel Log foi fechado (para fundo claro/escuro). */
const OWNER_INBOX_LAST_CLOSED_PREFIX = "barbxgo_owner_inbox_last_closed_";

/**
 * Slot vazio depois do horário atual — não usar "Livre".
 * Alternativas boas: "Horário passado", "Indisponível", "Expirado", "Encerrado".
 */
const LABEL_FREE_SLOT_PAST = "Horário encerrado";

/** Lembrar barbeiro escolhido na agenda (só sessão do browser). */
const OWNER_AGENDA_BARBER_KEY = "naregua_owner_agenda_barber_id";

let db = null;

let mapsJsLoadPromise = null;
let ownerLocationMap = null;
let ownerLocationMarker = null;
let ownerLocationMarkerUserDragged = false;

function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

function formatShortDateTime(ms) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
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

function renderOptions(selectEl, items, getValue, getLabel) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    selectEl.appendChild(opt);
  }
}

function setBodyLayout(mode) {
  document.body.classList.remove("layout-landing", "layout-app");
  document.body.classList.add(mode === "app" ? "layout-app" : "layout-landing");
}

function setLandingHeroVisible(visible) {
  const el = $("landingHeroBlock");
  if (el) el.hidden = !visible;
}

// /about/ agora é uma página estática própria (public/about/index.html).

function setHomeStatus(msg, isError = false) {
  const el = $("homeStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

/** Títulos da página de marcação (cliente abre o link partilhado pela barbearia). */
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
  const appEl = $("app");
  if (appEl && !appEl.hidden) {
    document.title = name ? name + " · Barb x Go" : "Agendar · Barb x Go";
  }
}

let __ownerStatusTimer = null;
function setOwnerStatus(msg, isError = false) {
  const el = $("ownerStatus");
  if (!el) return;
  if (__ownerStatusTimer) {
    clearTimeout(__ownerStatusTimer);
    __ownerStatusTimer = null;
  }
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
  // Sucesso some sozinho; erros ficam visíveis.
  if (!isError && msg) {
    __ownerStatusTimer = setTimeout(function () {
      el.textContent = "";
      el.classList.remove("err");
      __ownerStatusTimer = null;
    }, 3500);
  }
}

function setStatus(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function priceToBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Mesmo critério do app Android — evita dois agendamentos com o mesmo nome no dia. */
function normalizeClientName(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function showShopHeader(name) {
  const badge = $("shopBadge");
  if (!badge) return;
  badge.textContent = name;
  badge.hidden = false;
}

function hideShopHeader() {
  const badge = $("shopBadge");
  if (!badge) return;
  badge.hidden = true;
  badge.textContent = "";
}

function barberFromDoc(doc) {
  const data = doc.data();
  const scheduleByDay = window.NaReguaSchedule.parseScheduleFromFirestore(
    data.scheduleByDay
  );
  return { id: doc.id, name: data.name || "", scheduleByDay };
}

function serviceFromDoc(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    name: d.name || "",
    priceCents: Number(d.priceCents),
    durationMinutes: Number(d.durationMinutes != null ? d.durationMinutes : 30),
  };
}

let __firebaseCoreReady = false;

async function initFirebaseCore() {
  if (__firebaseCoreReady) return;
  if (!window.FIREBASE_CONFIG) {
    throw new Error("Falta firebase-config.js");
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  db = firebase.firestore();
  __firebaseCoreReady = true;
}

/** Cliente em /slug: precisa de sessão (anónima) para ler Firestore. */
async function ensureAnonymousForPublicBooking() {
  await initFirebaseCore();
  const u = firebase.auth().currentUser;
  if (u && !u.isAnonymous) return;
  if (!u) {
    try {
      await firebase.auth().signInAnonymously();
    } catch (e) {
      throw new Error(
        "Login anónimo falhou. No Firebase Console → Authentication, ative «Anónimo»."
      );
    }
  }
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
      } catch (_e) {
        /* ignore */
      }
    }, 180);
  } catch (_e) {
    /* ignore */
  }
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
  } catch (_e) {
    /* ignore */
  }
}

async function createInboxMessage(shopId, msg) {
  await initFirebaseCore();
  if (!shopId) return;
  const u = firebase.auth().currentUser;
  const uid = u && u.uid ? u.uid : "";
  const base = Object.assign(
    {
      createdAtMillis: Date.now(),
      shopId: shopId,
    },
    msg || {}
  );
  // Para regras de escrita do cliente, clientUid precisa existir.
  // Para o dono, também não atrapalha manter este campo.
  if (!base.clientUid && uid) base.clientUid = uid;
  const ref = db.collection("barbershops").doc(shopId).collection("inbox").doc();
  await ref.set(base);
}

let ownerInboxUnsub = null;
let ownerInboxLastSeenMillis = 0;
let ownerInboxUnread = 0;
let ownerInboxOverlayOpen = false;
/** Após abrir o log, rolar uma vez até ao fim (mensagens mais recentes em baixo). */
let ownerInboxScrollToBottomPending = false;

function ownerInboxLastClosedStorageKey(shopId, barberId) {
  const s = String(shopId || "").replace(/\|/g, "");
  const b = String(barberId || "").replace(/\|/g, "");
  return OWNER_INBOX_LAST_CLOSED_PREFIX + s + "|" + b;
}

/** Sem histórico → tudo tratado como já visto (fundo mais escuro). Após fechar o painel, grava-se o instante. */
function getOwnerInboxLastClosedMillis(shopId, barberId) {
  try {
    const raw = localStorage.getItem(ownerInboxLastClosedStorageKey(shopId, barberId));
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch (_e) {
    /* ignore */
  }
  return Number.POSITIVE_INFINITY;
}

function setOwnerInboxLastClosedNow(shopId, barberId) {
  if (!shopId || !barberId) return;
  try {
    localStorage.setItem(ownerInboxLastClosedStorageKey(shopId, barberId), String(Date.now()));
  } catch (_e) {
    /* ignore */
  }
}

function scrollOwnerInboxListToBottom() {
  const list = $("ownerInboxList");
  if (!list) return;
  requestAnimationFrame(function () {
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(function () {
      list.scrollTop = list.scrollHeight;
    });
  });
}

let ownerAgendaUnsub = null;
let ownerAgendaListenerKey = "";

/** Listener em tempo real dos agendamentos do dia (página pública do cliente). */
let clientAppointmentsUnsub = null;
let clientApptsListenerKey = "";

function stopClientAppointmentsListener() {
  if (clientAppointmentsUnsub) clientAppointmentsUnsub();
  clientAppointmentsUnsub = null;
  clientApptsListenerKey = "";
}

function stopOwnerInboxListener() {
  if (ownerInboxUnsub) ownerInboxUnsub();
  ownerInboxUnsub = null;
}

function stopOwnerAgendaListener() {
  if (ownerAgendaUnsub) ownerAgendaUnsub();
  ownerAgendaUnsub = null;
  ownerAgendaListenerKey = "";
}

function clearOwnerStatusIfLoading() {
  const el = $("ownerStatus");
  if (!el) return;
  const t = (el.textContent || "").trim();
  if (!t) return;
  if (t === "A carregar…" || t === "A carregar agenda…") setOwnerStatus("");
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
  time.textContent = formatShortDateTime(msg.createdAtMillis || Date.now());
  head.appendChild(title);
  head.appendChild(time);
  const body = document.createElement("div");
  body.className = "owner-inbox-item-body";
  body.textContent = msg.text || "";
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
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

function openOwnerInboxOverlay(open) {
  const wasOpen = ownerInboxOverlayOpen;
  ownerInboxOverlayOpen = !!open;
  const ov = $("ownerInboxOverlay");
  if (ov) ov.hidden = !ownerInboxOverlayOpen;
  if (ownerInboxOverlayOpen) {
    ownerInboxUnread = 0;
    setOwnerInboxBadge(0);
    ownerInboxLastSeenMillis = Date.now();
    ownerInboxScrollToBottomPending = true;
  } else if (wasOpen) {
    const shopId = window.__ownerShopId;
    const sel = $("ownerAgendaBarberSelect");
    const barberId = sel && sel.value ? String(sel.value) : "";
    setOwnerInboxLastClosedNow(shopId, barberId);
  }
}

async function loadOwnerInboxPanel() {
  await initFirebaseCore();
  const shopId = window.__ownerShopId;
  const list = $("ownerInboxList");
  if (!shopId || !list) return;
  setOwnerStatus("");

  const soundBtn = $("ownerInboxSoundBtn");
  if (soundBtn) {
    soundBtn.textContent = isInboxSoundEnabled() ? "Som: ligado" : "Ativar som";
  }

  stopOwnerInboxListener();
  list.innerHTML = '<p class="muted">A carregar…</p>';

  const sel = $("ownerAgendaBarberSelect");
  const barberId = sel && sel.value ? String(sel.value) : "";
  if (!barberId) {
    list.innerHTML = '<p class="muted">Selecione um barbeiro na aba Agenda.</p>';
    return;
  }

  const lastClosedMillis = getOwnerInboxLastClosedMillis(shopId, barberId);

  const u = firebase.auth().currentUser;
  if (!u || !u.uid) {
    list.innerHTML = "";
    setOwnerStatus("Sessão inválida. Entre novamente.", true);
    return;
  }
  try {
    const shopSnap = await db.collection("barbershops").doc(shopId).get();
    const ownerUid = shopSnap.exists ? String((shopSnap.data() || {}).ownerUid || "") : "";
    if (!ownerUid) {
      list.innerHTML = "";
      setOwnerStatus("Barbearia sem ownerUid no Firestore. Refaça o cadastro/login.", true);
      return;
    }
    if (ownerUid !== u.uid) {
      list.innerHTML = "";
      setOwnerStatus(
        "Esta conta não é dona desta barbearia (ownerUid diferente). Faça login com o dono correto.",
        true
      );
      return;
    }
  } catch (e) {
    // Se nem conseguimos ler o doc da barbearia, as rules não estão publicadas ou auth caiu.
    list.innerHTML = "";
    setOwnerStatus(e.message || "Erro ao validar a barbearia.", true);
    return;
  }

  ownerInboxUnsub = db
    .collection("barbershops")
    .doc(shopId)
    .collection("inbox")
    .orderBy("createdAtMillis", "desc")
    .limit(50)
    .onSnapshot(
      function (snap) {
        const msgs = [];
        snap.forEach(function (d) {
          const x = d.data() || {};
          msgs.push(Object.assign({ id: d.id }, x));
        });
        msgs.reverse();
        list.innerHTML = "";
        const filtered = msgs.filter(function (m) {
          return String(m.barberId || "") === barberId;
        });
        if (!filtered.length) {
          list.innerHTML = '<p class="muted">Sem mensagens ainda.</p>';
          if (ownerInboxOverlayOpen && ownerInboxScrollToBottomPending) {
            ownerInboxScrollToBottomPending = false;
          }
          return;
        }
        filtered.forEach(function (m) {
          list.appendChild(renderOwnerInboxItem(m, lastClosedMillis));
          if (isInboxSoundEnabled()) {
            const t = Number(m.createdAtMillis || 0);
            if (t > ownerInboxLastSeenMillis + 50 && ownerInboxOverlayOpen) {
              playInboxBeep();
            }
          }
        });
        let newestT = 0;
        filtered.forEach(function (m) {
          const t = Number(m.createdAtMillis || 0);
          if (t > newestT) newestT = t;
        });
        if (newestT > ownerInboxLastSeenMillis + 50) {
          if (!ownerInboxOverlayOpen) {
            ownerInboxUnread += 1;
            setOwnerInboxBadge(ownerInboxUnread);
            if (isInboxSoundEnabled()) playInboxBeep();
          }
        }
        ownerInboxLastSeenMillis = Math.max(ownerInboxLastSeenMillis, newestT);
        if (ownerInboxOverlayOpen && ownerInboxScrollToBottomPending) {
          scrollOwnerInboxListToBottom();
          ownerInboxScrollToBottomPending = false;
        }
      },
      function (e) {
        list.innerHTML = "";
        ownerInboxScrollToBottomPending = false;
        const code = e && e.code ? String(e.code) : "";
        const baseMsg = e && e.message ? String(e.message) : "Erro ao carregar mensagens.";
        if (code === "permission-denied") {
          const u = firebase.auth().currentUser;
          const uid = u && u.uid ? u.uid : "";
          setOwnerStatus(
            "permission-denied ao ler Log. " +
              "Verifique se você publicou as rules no Firestore Console do projeto naregua-61564 " +
              "e se o ownerUid da barbearia é este uid: " +
              (uid || "(sem sessão)"),
            true
          );
          return;
        }
        setOwnerStatus((code ? code + " — " : "") + baseMsg, true);
      }
    );
}

async function resolveShopSlug(slug) {
  const raw = decodeURIComponent(slug).trim().toLowerCase();
  if (!raw) return null;
  const col = db.collection("barbershops");
  const attempts = [
    ["slug", raw],
    ["nameLowercase", raw],
    ["nameLowercase", raw.replace(/-/g, " ")],
  ];
  for (let i = 0; i < attempts.length; i++) {
    const field = attempts[i][0];
    const val = attempts[i][1];
    const snap = await col.where(field, "==", val).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { shopId: doc.id, name: doc.data().name || "" };
    }
  }
  return null;
}

/** Segmento de URL público (/slug) a partir do documento Firestore da barbearia. */
function pathSegmentFromShopData(data) {
  if (!data) return "";
  const slug = data.slug != null ? String(data.slug).trim() : "";
  if (slug) {
    return slug
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/^\/+|\/+$/g, "");
  }
  let nl =
    (data.nameLowercase && String(data.nameLowercase).trim().toLowerCase()) || "";
  if (!nl && data.name) nl = String(data.name).toLowerCase().trim();
  if (!nl) return "";
  return nl.replace(/\s+/g, "-");
}

async function searchShopsByNamePrefix(query) {
  const qRaw = String(query || "")
    .toLowerCase()
    .trim();
  if (qRaw.length < 2) return [];
  const end = qRaw + "\uf8ff";
  const snap = await db
    .collection("barbershops")
    .where("nameLowercase", ">=", qRaw)
    .where("nameLowercase", "<=", end)
    .limit(20)
    .get();
  return snap.docs.map(function (doc) {
    return { id: doc.id, data: doc.data() };
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = function (x) {
    return (x * Math.PI) / 180;
  };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function searchShopsNearby(userLat, userLng, maxKm) {
  const snap = await db.collection("barbershops").get();
  const rows = [];
  snap.forEach(function (doc) {
    const d = doc.data();
    const la = d.lat;
    const ln = d.lng;
    if (la == null || ln == null) return;
    const nla = Number(la);
    const nln = Number(ln);
    if (isNaN(nla) || isNaN(nln)) return;
    const dist = haversineKm(userLat, userLng, nla, nln);
    if (dist > maxKm) return;
    rows.push({ id: doc.id, data: d, distKm: dist });
  });
  rows.sort(function (a, b) {
    return a.distKm - b.distKm;
  });
  return rows.slice(0, 50);
}

function loadGoogleMapsJs() {
  if (window.google && window.google.maps) {
    return Promise.resolve();
  }
  if (mapsJsLoadPromise) return mapsJsLoadPromise;
  const key =
    (window.GOOGLE_MAPS_API_KEY && String(window.GOOGLE_MAPS_API_KEY).trim()) || "";
  if (!key) {
    return Promise.reject(
      new Error(
        "Defina GOOGLE_MAPS_API_KEY em firebase-config.js e ative Maps JavaScript API e Geocoding API no Google Cloud."
      )
    );
  }
  mapsJsLoadPromise = new Promise(function (resolve, reject) {
    const cbName = "__nareguaMapsCb_" + String(Date.now());
    window[cbName] = function () {
      try {
        delete window[cbName];
      } catch (_e) {
        window[cbName] = undefined;
      }
      resolve();
    };
    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(key) +
      "&loading=async&callback=" +
      cbName;
    s.async = true;
    s.onerror = function () {
      try {
        delete window[cbName];
      } catch (_e) {
        window[cbName] = undefined;
      }
      mapsJsLoadPromise = null;
      reject(new Error("Falha ao carregar Google Maps."));
    };
    document.head.appendChild(s);
  });
  return mapsJsLoadPromise;
}

function geocodeForwardWithGoogleMaps(address) {
  return loadGoogleMapsJs().then(function () {
    return new Promise(function (resolve, reject) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: address }, function (results, status) {
        if (status === "OK" && results[0]) {
          const loc = results[0].geometry.location;
          resolve({
            lat: loc.lat(),
            lng: loc.lng(),
            formatted: results[0].formatted_address || address,
          });
        } else if (status === "ZERO_RESULTS") {
          reject(new Error("Endereço não encontrado."));
        } else {
          reject(new Error("Geocoding falhou: " + status));
        }
      });
    });
  });
}

function reverseGeocodeLatLngWithGoogleMaps(lat, lng) {
  return loadGoogleMapsJs().then(function () {
    return new Promise(function (resolve, reject) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode(
        { location: { lat: lat, lng: lng } },
        function (results, status) {
          if (status === "OK" && results[0]) {
            const loc = results[0].geometry.location;
            resolve({
              lat: loc.lat(),
              lng: loc.lng(),
              formatted: results[0].formatted_address,
            });
          } else {
            reject(new Error("Não foi possível obter o endereço deste ponto no mapa."));
          }
        }
      );
    });
  });
}

function teardownOwnerLocationMap() {
  ownerLocationMarkerUserDragged = false;
  if (ownerLocationMarker) {
    ownerLocationMarker.setMap(null);
    ownerLocationMarker = null;
  }
  ownerLocationMap = null;
}

async function initOrRefreshOwnerLocationMap(lat, lng) {
  const el = $("ownerLocationMap");
  if (!el) return;
  await loadGoogleMapsJs();
  const hasSaved =
    lat != null &&
    lng != null &&
    !isNaN(Number(lat)) &&
    !isNaN(Number(lng));
  const center = hasSaved
    ? { lat: Number(lat), lng: Number(lng) }
    : { lat: -15.793889, lng: -47.882778 };
  const zoom = hasSaved ? 16 : 5;
  if (!ownerLocationMap) {
    ownerLocationMap = new google.maps.Map(el, {
      center,
      zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    ownerLocationMarker = new google.maps.Marker({
      position: center,
      map: ownerLocationMap,
      draggable: true,
    });
    ownerLocationMarker.addListener("dragend", function () {
      ownerLocationMarkerUserDragged = true;
    });
  } else {
    ownerLocationMarker.setPosition(center);
    ownerLocationMap.setCenter(center);
    ownerLocationMap.setZoom(zoom);
    ownerLocationMarkerUserDragged = false;
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (ownerLocationMap && window.google && window.google.maps) {
        google.maps.event.trigger(ownerLocationMap, "resize");
      }
    });
  });
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

function appendFindShopResultRow(resultsEl, row, distKm) {
  const seg = pathSegmentFromShopData(row.data);
  const name = row.data.name || "Barbearia";
  const base = String(window.location.origin || "").replace(/\/$/, "");
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
  const addr = row.data.address;
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
    await ensureAnonymousForPublicBooking();
    const pos = await getCurrentPositionPromise();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    setFindShopStatus("A procurar barbearias até " + maxKm + " km…");
    const rows = await searchShopsNearby(lat, lng, maxKm);
    if (!resultsEl) return;
    if (!rows.length) {
      setFindShopStatus(
        "Nenhuma barbearia com localização neste raio. Aumente o raio ou use a busca por nome."
      );
      return;
    }
    setFindShopStatus(rows.length + " resultado(s). Toque para agendar.");
    rows.forEach(function (row) {
      appendFindShopResultRow(resultsEl, row, row.distKm);
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

async function loadOwnerLocationPanel() {
  const shopId = window.__ownerShopId;
  const ta = $("ownerAddressInput");
  const note = $("ownerLocationNote");
  if (!shopId || !ta) return;
  if (note) note.textContent = "";
  try {
    const doc = await db.collection("barbershops").doc(shopId).get();
    if (!doc.exists) return;
    const d = doc.data();
    ta.value = d.address != null ? String(d.address) : "";
    if (note && d.lat != null && d.lng != null) {
      note.textContent =
        "Coordenadas: " +
        Number(d.lat).toFixed(5) +
        ", " +
        Number(d.lng).toFixed(5) +
        " — pode arrastar o alfinete para afinar e voltar a guardar.";
    } else if (note) {
      note.textContent =
        "Sem coordenadas — escreva o endereço e guarde, ou ajuste o alfinete no mapa.";
    }
    initOrRefreshOwnerLocationMap(
      d.lat != null ? Number(d.lat) : null,
      d.lng != null ? Number(d.lng) : null
    ).catch(function (e) {
      console.warn("Mapa (localização):", e);
    });
  } catch (_e) {
    /* ignore */
  }
}

function setFindShopStatus(msg, isError) {
  const el = $("findShopStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_e2) {
      return false;
    }
  }
}

async function refreshOwnerShopPublicUrl() {
  window.__ownerShopPublicUrl = "";
  window.__ownerShopPathSegment = "";
  const shopId = window.__ownerShopId;
  if (!shopId || !db) return;
  try {
    const doc = await db.collection("barbershops").doc(shopId).get();
    if (!doc.exists) return;
    const seg = pathSegmentFromShopData(doc.data());
    if (!seg) return;
    window.__ownerShopPathSegment = seg;
    const base = String(window.location.origin || "").replace(/\/$/, "");
    window.__ownerShopPublicUrl = base + "/" + encodeURIComponent(seg);
  } catch (_e) {
    /* ignore */
  }
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
    await ensureAnonymousForPublicBooking();
    const rows = await searchShopsByNamePrefix(q);
    if (!resultsEl) return;
    if (!rows.length) {
      setFindShopStatus(
        "Nenhuma barbearia encontrada. Tente outras letras ou peça o link direto à loja."
      );
      return;
    }
    setFindShopStatus(rows.length + " resultado(s). Toque numa loja para agendar.");
    rows.forEach(function (row) {
      appendFindShopResultRow(resultsEl, row, null);
    });
    resultsEl.hidden = false;
  } catch (e) {
    setFindShopStatus(e.message || "Erro ao procurar.", true);
  }
}

async function loadBarbers(shopId) {
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("barbers")
    .get();
  return snap.docs.map(barberFromDoc);
}

async function loadServices(shopId) {
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("services")
    .get();
  return snap.docs.map(serviceFromDoc).filter(function (s) {
    return s.name && !isNaN(s.priceCents);
  });
}

function appointmentFromFirestoreDoc(doc) {
  const x = doc.data() || {};
  return {
    id: doc.id,
    barberId: x.barberId || "",
    timeLabel: x.timeLabel || "",
    status: x.status || "SCHEDULED",
    clientName: x.clientName || "",
    clientUid: x.clientUid || "",
    serviceName: x.serviceName || "",
    serviceId: x.serviceId || "",
    servicePriceCents: x.servicePriceCents != null ? Number(x.servicePriceCents) : 0,
    appFeeCents: x.appFeeCents != null ? Number(x.appFeeCents) : 0,
    createdBy: x.createdBy || "CLIENT",
  };
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
  let slots = rawSlots.filter(function (t) {
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
      slotsEl.innerHTML =
        '<p class="muted">Sem horários livres neste dia para este barbeiro.</p>';
      setStatus("Escolha outra data ou outro barbeiro.");
    }
    refreshCancelUi().catch(function () {});
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
      refreshCancelUi().catch(function () {});
    });
    slotsEl.appendChild(btn);
  });

  setStatus("Toque em um horário livre.");
  try {
    const uid =
      firebase.auth().currentUser && firebase.auth().currentUser.uid
        ? firebase.auth().currentUser.uid
        : "";
    if (uid && cancelBtn) {
      const mine = appts.find(function (a) {
        return (
          a.barberId === barberId &&
          (a.status || "SCHEDULED") === "SCHEDULED" &&
          (a.createdBy || "CLIENT") === "CLIENT" &&
          (a.clientUid || "") === uid
        );
      });
      if (mine && mine.id) {
        cancelBtn.hidden = false;
        cancelBtn.dataset.appointmentId = mine.id;
      }
    }
  } catch (_e) {
    /* ignore */
  }
  refreshCancelUi().catch(function () {});
}

function renderDayAgenda(barber, dateKey, appointmentsForBarber) {
  const host = $("dayAgenda");
  if (!host || !window.NaReguaSchedule.buildDayAgendaList) return;
  const rows = window.NaReguaSchedule.buildDayAgendaList(
    barber.scheduleByDay,
    dateKey,
    appointmentsForBarber,
    new Date()
  );
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML =
      '<p class="muted">Sem grade neste dia (folga ou sem horários cadastrados).</p>';
    return;
  }
  const uid =
    firebase.auth().currentUser && firebase.auth().currentUser.uid
      ? firebase.auth().currentUser.uid
      : "";
  const list = document.createElement("div");
  list.className = "day-agenda-list";
  rows.forEach(function (r) {
    const row = document.createElement("div");
    row.className = "day-agenda-row";
    const time = document.createElement("span");
    time.className = "day-agenda-time";
    time.textContent = r.timeLabel;
    const body = document.createElement("div");
    body.className = "day-agenda-body";
    if (r.state === "lunch") {
      row.classList.add("is-lunch");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-lunch";
      badge.textContent = "Almoço";
      body.appendChild(badge);
      const sub = document.createElement("span");
      sub.className = "day-agenda-lunch-sub";
      sub.textContent = r.lunchSubtitle || "Pausa — sem atendimentos neste intervalo";
      body.appendChild(sub);
    } else if (r.state === "past") {
      row.classList.add("is-past");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-past";
      badge.textContent = LABEL_FREE_SLOT_PAST;
      body.appendChild(badge);
    } else if (r.state === "free") {
      row.classList.add("is-free");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-free";
      badge.textContent = "Livre";
      body.appendChild(badge);
    } else if (r.state === "done") {
      row.classList.add("is-done");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-done";
      badge.textContent = "Finalizado";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }
    } else if (r.state === "in_progress") {
      row.classList.add("is-progress");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-progress";
      badge.textContent = "Em atendimento";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }
    } else {
      row.classList.add("is-scheduled");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-scheduled";
      badge.textContent = "Agendado";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.pastDue) {
        const hint = document.createElement("span");
        hint.className = "day-agenda-past-hint";
        hint.textContent = "Horário já passou";
        body.appendChild(hint);
      }
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }

      // Cancelar (cliente): só se este agendamento foi feito no mesmo dispositivo (Auth anónimo).
      if (uid && r.appointmentId) {
        const ap = (appointmentsForBarber || []).find(function (a) {
          return (a.id || a.appointmentId) === r.appointmentId;
        });
        if (
          ap &&
          (ap.status || "SCHEDULED") === "SCHEDULED" &&
          (ap.createdBy || "CLIENT") === "CLIENT" &&
          (ap.clientUid || "") === uid
        ) {
          const cbtn = document.createElement("button");
          cbtn.type = "button";
          cbtn.className = "day-agenda-cancel";
          cbtn.textContent = "Cancelar";
          cbtn.addEventListener("click", function () {
            cancelAppointmentById(String(r.appointmentId)).catch(function (e) {
              setStatus(e.message || "Não foi possível cancelar.", true);
            });
          });
          body.appendChild(cbtn);
        }
      }
    }
    row.appendChild(time);
    row.appendChild(body);
    list.appendChild(row);
  });
  host.appendChild(list);
}

async function resolveAndLoad(slug) {
  const r = await resolveShopSlug(slug);
  if (!r) throw new Error("Barbearia não encontrada.");
  window.__shopId = r.shopId;
  window.__shopName = r.name || "";
  applyBookingHeadlines(window.__shopName);
  showShopHeader(r.name || "");
  setBodyLayout("app");
  $("homeLanding").hidden = true;
  $("ownerPortal").hidden = true;
  $("app").hidden = false;
  setStatus("");
  await loadData(r.shopId);
}

async function loadData(shopId) {
  stopClientAppointmentsListener();
  clientApptsListenerKey = "";
  const barbers = await loadBarbers(shopId);
  const services = await loadServices(shopId);

  if (!barbers.length) throw new Error("Sem barbeiros cadastrados.");
  if (!services.length) throw new Error("Sem serviços cadastrados.");

  window.__barbers = barbers;
  window.__services = services;

  renderOptions(
    $("barberSelect"),
    barbers,
    (b) => b.id,
    (b) => b.name
  );
  renderOptions(
    $("serviceSelect"),
    services,
    (s) => s.id,
    (s) => {
      const base = Number(s.priceCents || 0);
      const fee = Number(APP_FEE_CENTS || 0);
      const total = base + fee;
      return `${s.name} (${priceToBRL(total)})`;
    }
  );

  $("dateKey").value = toDateKey();
  await loadAvailability();

  let nm = window.__shopName;
  if ((!nm || !String(nm).trim()) && shopId && db) {
    try {
      const ds = await db.collection("barbershops").doc(shopId).get();
      if (ds.exists) {
        nm = ds.data().name || "";
        window.__shopName = nm;
      }
    } catch (_e) {
      /* ignore */
    }
  }
  const appEl = $("app");
  if (appEl && !appEl.hidden) {
    applyBookingHeadlines(nm || "");
  }
}

async function loadAvailability() {
  await initFirebaseCore();
  const shopId = window.__shopId;
  const dateKey = $("dateKey").value;
  const barberId = $("barberSelect").value;
  if (!shopId || !dateKey || !barberId) return;

  setStatus("Carregando horários...");

  const key = shopId + "|" + dateKey;
  if (clientApptsListenerKey !== key) {
    stopClientAppointmentsListener();
    clientApptsListenerKey = key;
    clientAppointmentsUnsub = db
      .collection("barbershops")
      .doc(shopId)
      .collection("appointments")
      .where("dateKey", "==", dateKey)
      .onSnapshot(
        function (snap) {
          const appts = snap.docs.map(appointmentFromFirestoreDoc);
          window.__clientDayAppts = appts;
          const bid = $("barberSelect").value;
          const dk = $("dateKey").value;
          if (dk !== dateKey || window.__shopId !== shopId) return;
          renderClientAvailabilityFromAppts(appts, shopId, dateKey, bid);
        },
        function (e) {
          setStatus(e.message || "Erro ao carregar horários.", true);
        }
      );
  } else {
    window.__clientDayAppts = window.__clientDayAppts || [];
    renderClientAvailabilityFromAppts(
      window.__clientDayAppts,
      shopId,
      dateKey,
      barberId
    );
  }
}

async function refreshCancelUi() {
  const cancelBtn = $("cancelBtn");
  if (!cancelBtn) return;
  cancelBtn.hidden = true;
  cancelBtn.dataset.appointmentId = "";
  const shopId = window.__shopId;
  const barberId = $("barberSelect").value;
  const dateKey = $("dateKey").value;
  const timeLabel = window.__selectedTimeLabel;
  const u = firebase.auth().currentUser;
  const uid = u && u.uid ? u.uid : "";
  if (!shopId || !barberId || !dateKey || !timeLabel || !uid) return;
  const appointmentId = shopId + "_" + barberId + "_" + dateKey + "_" + timeLabel;
  try {
    const ref = db
      .collection("barbershops")
      .doc(shopId)
      .collection("appointments")
      .doc(appointmentId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const d = snap.data() || {};
    if ((d.status || "SCHEDULED") !== "SCHEDULED") return;
    if ((d.createdBy || "") !== "CLIENT") return;
    if ((d.clientUid || "") !== uid) return;
    cancelBtn.hidden = false;
    cancelBtn.dataset.appointmentId = appointmentId;
  } catch (_e) {
    /* ignore */
  }
}

async function cancelAppointmentById(appointmentId) {
  const shopId = window.__shopId;
  const u = firebase.auth().currentUser;
  const uid = u && u.uid ? u.uid : "";
  if (!shopId || !uid || !appointmentId) return;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(appointmentId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Agendamento não encontrado.");
  const d = snap.data() || {};
  if ((d.status || "SCHEDULED") !== "SCHEDULED") {
    throw new Error("Este agendamento já está em atendimento ou finalizado.");
  }
  if ((d.clientUid || "") !== uid) {
    throw new Error("Este agendamento só pode ser cancelado no mesmo dispositivo.");
  }
  await ref.update({ status: "CANCELLED", cancelledAtMillis: Date.now() });
  setStatus("Agendamento cancelado.");
  window.__selectedTimeLabel = null;
  await loadAvailability();

  // Log para a barbearia (cliente)
  try {
    await createInboxMessage(shopId, {
      type: "CANCELLED_BY_CLIENT",
      title: "Cancelamento (cliente)",
      text:
        `${d.dateKey || ""} · ${d.timeLabel || ""}\n` +
        `${d.clientName || ""} · ${d.serviceName || ""}`,
      appointmentId: appointmentId,
      barberId: d.barberId || "",
      dateKey: d.dateKey || "",
      timeLabel: d.timeLabel || "",
      clientName: d.clientName || "",
      clientUid: uid,
    });
  } catch (_e) {
    /* ignore */
  }
}

async function cancelSelectedAppointment() {
  const shopId = window.__shopId;
  const barberId = $("barberSelect").value;
  const dateKey = $("dateKey").value;
  const timeLabel = window.__selectedTimeLabel;
  const u = firebase.auth().currentUser;
  const uid = u && u.uid ? u.uid : "";
  const cancelBtn = $("cancelBtn");
  const explicitId = cancelBtn && cancelBtn.dataset ? cancelBtn.dataset.appointmentId : "";
  if (!shopId || !barberId || !dateKey || !uid) return;
  const appointmentId =
    explicitId ||
    (timeLabel ? shopId + "_" + barberId + "_" + dateKey + "_" + timeLabel : "");
  if (!appointmentId) return;
  try {
    await cancelAppointmentById(appointmentId);
  } catch (e) {
    setStatus(e.message || "Não foi possível cancelar.", true);
  }
}

function getSelectedService() {
  const serviceId = $("serviceSelect").value;
  return (window.__services || []).find(function (s) {
    return s.id === serviceId;
  });
}

function serviceTotalCents(service) {
  const base = service && service.priceCents != null ? Number(service.priceCents) : 0;
  const fee = Number(APP_FEE_CENTS || 0);
  return base + fee;
}

async function book() {
  const shopId = window.__shopId;
  const barberId = $("barberSelect").value;
  const dateKey = $("dateKey").value;
  const timeLabel = window.__selectedTimeLabel;
  const clientName = $("clientName").value.trim();
  const clientPhone = $("clientPhone").value.trim();
  const service = getSelectedService();
  const clientUid =
    firebase.auth().currentUser && firebase.auth().currentUser.uid
      ? firebase.auth().currentUser.uid
      : null;

  if (!clientName) return setStatus("Informe seu nome.", true);
  if (!clientPhone) return setStatus("Informe seu telefone.", true);
  if (!service) return setStatus("Selecione um serviço.", true);
  if (!timeLabel) return setStatus("Selecione um horário.", true);
  if (!clientUid) return setStatus("Não foi possível validar a sessão.", true);
  if (window.NaReguaSchedule.isSlotLabelPast(dateKey, timeLabel, new Date())) {
    return setStatus("Este horário já passou. Escolha outro.", true);
  }

  const barber = (window.__barbers || []).find(function (b) {
    return b.id === barberId;
  });
  if (!barber) return setStatus("Barbeiro inválido.", true);

  const baseSlots = window.NaReguaSchedule.availableSlotLabels(
    barber.scheduleByDay,
    dateKey,
    new Set()
  );
  if (baseSlots.indexOf(timeLabel) === -1) {
    return setStatus("Horário inválido para este barbeiro.", true);
  }

  setStatus("Confirmando agendamento...");

  const appointmentId = shopId + "_" + barberId + "_" + dateKey + "_" + timeLabel;
  const appointmentsCol = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments");
  const privateRef = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments_private")
    .doc(appointmentId);

  try {
    // Query não pode ir dentro de runTransaction no SDK compat — só DocumentReference.
    const daySnap = await appointmentsCol
      .where("dateKey", "==", dateKey)
      .get();
    daySnap.docs.forEach(function (doc) {
      const d = doc.data();
      const st = d.status || "SCHEDULED";
      if (st === "CANCELLED") return;
      if (d.barberId === barberId && d.timeLabel === timeLabel) {
        throw new Error("Esse horário já foi ocupado.");
      }
    });

    const ref = appointmentsCol.doc(appointmentId);
    await db.runTransaction(async function (transaction) {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        const st = existing.data().status || "SCHEDULED";
        if (st !== "CANCELLED") {
          throw new Error("Esse horário já foi ocupado.");
        }
      }
      transaction.set(ref, {
        shopId: shopId,
        barberId: barberId,
        dateKey: dateKey,
        timeLabel: timeLabel,
        clientName: clientName,
        clientUid: clientUid,
        serviceId: service.id,
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        status: "SCHEDULED",
        createdBy: "CLIENT",
        appFeeCents: APP_FEE_CENTS,
      });
    });

    // Telefone fica num doc privado (barbearia lê; cliente só cria).
    // Se já existir, não sobrescrever para evitar falha de permissão (create vs update).
    try {
      await privateRef.create({
        appointmentId: appointmentId,
        shopId: shopId,
        clientUid: clientUid,
        clientPhone: clientPhone,
        createdAtMillis: Date.now(),
      });
    } catch (_e) {
      /* ignore */
    }

    $("slots").querySelectorAll(".slot").forEach(function (b) {
      b.disabled = true;
    });
    setStatus("Agendamento confirmado no Barb x Go.");
    // Mostrar cancelar imediatamente (o slot some da lista de "livres").
    try {
      const cancelBtn = $("cancelBtn");
      if (cancelBtn) {
        cancelBtn.hidden = false;
        cancelBtn.dataset.appointmentId = appointmentId;
      }
    } catch (_e) {
      /* ignore */
    }

    // Log para a barbearia (cliente)
    try {
      await createInboxMessage(shopId, {
        type: "BOOKED",
        title: "Novo agendamento",
        text:
          `${dateKey} · ${timeLabel}\n` +
          `${clientName} · ${service.name}`,
        appointmentId: appointmentId,
        barberId: barberId,
        dateKey: dateKey,
        timeLabel: timeLabel,
        clientName: clientName,
        clientUid: clientUid,
      });
    } catch (_e) {
      /* ignore */
    }
    await loadAvailability();
  } catch (e) {
    setStatus(e.message || "Não foi possível confirmar.", true);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function defaultScheduleByDay() {
  const w = {
    isWorking: true,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: "12:00",
    lunchEnd: "13:00",
  };
  const off = {
    isWorking: false,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: null,
    lunchEnd: null,
  };
  const o = {};
  for (let day = 1; day <= 5; day++) o[String(day)] = Object.assign({}, w);
  o["6"] = Object.assign({}, off);
  o["7"] = Object.assign({}, off);
  return o;
}

var OWNER_DAY_LABELS = [
  "",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

function ownerDayShort(d) {
  var x = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  return x[d] || "";
}

function previousOwnerCalendarDay(d) {
  return d === 1 ? 7 : d - 1;
}

function normalizeBarberSchedule(scheduleByDay) {
  var w = {
    isWorking: true,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: "12:00",
    lunchEnd: "13:00",
  };
  var off = {
    isWorking: false,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: "",
    lunchEnd: "",
  };
  var out = {};
  for (var day = 1; day <= 7; day++) {
    var s = scheduleByDay && (scheduleByDay[day] || scheduleByDay[String(day)]);
    if (s) {
      out[day] = {
        isWorking: !!s.isWorking,
        startTime: String(s.startTime || "09:00"),
        endTime: String(s.endTime || "18:00"),
        intervalMinutes: Number(
          s.intervalMinutes != null ? s.intervalMinutes : 30
        ),
        lunchStart:
          s.lunchStart != null && String(s.lunchStart).trim() !== ""
            ? String(s.lunchStart).trim()
            : "",
        lunchEnd:
          s.lunchEnd != null && String(s.lunchEnd).trim() !== ""
            ? String(s.lunchEnd).trim()
            : "",
      };
    } else {
      out[day] = Object.assign({}, day <= 5 ? w : off);
    }
  }
  return out;
}

function scheduleByDayToFirestoreMap(schedMap) {
  var o = {};
  for (var d = 1; d <= 7; d++) {
    var s = schedMap[d];
    if (!s) continue;
    o[String(d)] = {
      isWorking: !!s.isWorking,
      startTime: String(s.startTime || "09:00"),
      endTime: String(s.endTime || "18:00"),
      intervalMinutes: Math.max(
        5,
        Number(s.intervalMinutes != null ? s.intervalMinutes : 30)
      ),
      lunchStart:
        s.lunchStart && String(s.lunchStart).trim() !== ""
          ? String(s.lunchStart).trim()
          : null,
      lunchEnd:
        s.lunchEnd && String(s.lunchEnd).trim() !== ""
          ? String(s.lunchEnd).trim()
          : null,
    };
  }
  return o;
}

function barberWorkingDaysLine(scheduleByDay) {
  var norm = normalizeBarberSchedule(scheduleByDay);
  var parts = [];
  for (var d = 1; d <= 7; d++) {
    if (norm[d].isWorking) parts.push(ownerDayShort(d));
  }
  return parts.length ? "Dias: " + parts.join(", ") : "Sem dias de trabalho definidos";
}

function toggleOwnerDayFieldsCard(card, working) {
  var box = card.querySelector(".owner-day-edit-fields");
  if (box) box.hidden = !working;
}

function getOwnerDayStateFromCard(card) {
  var cb = card.querySelector(".owner-day-work");
  var working = cb && cb.checked;
  var start = card.querySelector(".owner-day-start");
  var end = card.querySelector(".owner-day-end");
  var intv = card.querySelector(".owner-day-interval");
  var ls = card.querySelector(".owner-day-lunch-start");
  var le = card.querySelector(".owner-day-lunch-end");
  return {
    isWorking: !!working,
    startTime: (start && start.value.trim()) || "09:00",
    endTime: (end && end.value.trim()) || "18:00",
    intervalMinutes: Math.max(
      5,
      parseInt((intv && intv.value) || "30", 10) || 30
    ),
    lunchStart: ls && ls.value.trim() ? ls.value.trim() : "",
    lunchEnd: le && le.value.trim() ? le.value.trim() : "",
  };
}

function applyOwnerDayStateToCard(card, state) {
  var cb = card.querySelector(".owner-day-work");
  if (cb) cb.checked = state.isWorking;
  var start = card.querySelector(".owner-day-start");
  var end = card.querySelector(".owner-day-end");
  var intv = card.querySelector(".owner-day-interval");
  var ls = card.querySelector(".owner-day-lunch-start");
  var le = card.querySelector(".owner-day-lunch-end");
  if (start) start.value = state.startTime;
  if (end) end.value = state.endTime;
  if (intv) intv.value = String(state.intervalMinutes);
  if (ls) ls.value = state.lunchStart || "";
  if (le) le.value = state.lunchEnd || "";
  toggleOwnerDayFieldsCard(card, state.isWorking);
}

function renderOwnerBarberEditDays(host, normalized) {
  host.innerHTML = "";
  function addField(container, labelText, className, value, opts) {
    opts = opts || {};
    var fl = document.createElement("label");
    fl.className = "field" + (opts.fullRow ? " owner-day-fullrow" : "");
    var sp = document.createElement("span");
    sp.className = "field-label";
    sp.textContent = labelText;
    var inp = document.createElement("input");
    inp.className = className;
    if (opts.isNumber) {
      inp.type = "number";
      inp.min = "5";
      inp.step = "5";
    } else {
      inp.type = "text";
      inp.placeholder = opts.placeholder || "";
    }
    inp.value = value;
    fl.appendChild(sp);
    fl.appendChild(inp);
    container.appendChild(fl);
  }

  for (var day = 1; day <= 7; day++) {
    var s = normalized[day];
    var prev = previousOwnerCalendarDay(day);

    var card = document.createElement("div");
    card.className = "owner-day-edit-card";
    card.dataset.ownerDay = String(day);

    var top = document.createElement("div");
    top.className = "owner-day-edit-top";
    var title = document.createElement("strong");
    title.textContent = OWNER_DAY_LABELS[day];
    var lab = document.createElement("label");
    lab.className = "owner-day-work-label";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "owner-day-work";
    cb.checked = s.isWorking;
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(" Trabalha neste dia"));
    top.appendChild(title);
    top.appendChild(lab);
    card.appendChild(top);

    var fields = document.createElement("div");
    fields.className = "owner-day-edit-fields";
    fields.hidden = !s.isWorking;

    addField(fields, "Início", "owner-day-start", s.startTime, {
      placeholder: "09:00",
    });
    addField(fields, "Fim", "owner-day-end", s.endTime, {
      placeholder: "18:00",
    });
    addField(fields, "Intervalo entre horários (min)", "owner-day-interval", String(s.intervalMinutes), {
      fullRow: true,
      isNumber: true,
    });
    addField(fields, "Almoço — início", "owner-day-lunch-start", s.lunchStart || "", {
      placeholder: "12:00",
    });
    addField(fields, "Almoço — fim", "owner-day-lunch-end", s.lunchEnd || "", {
      placeholder: "13:00",
    });

    cb.addEventListener("change", function () {
      toggleOwnerDayFieldsCard(card, cb.checked);
    });

    card.appendChild(fields);

    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "owner-day-copy";
    copyBtn.textContent = "Copiar horários de " + ownerDayShort(prev);
    copyBtn.addEventListener("click", function () {
      var prevCard = host.querySelector('[data-owner-day="' + prev + '"]');
      if (!prevCard) return;
      applyOwnerDayStateToCard(card, getOwnerDayStateFromCard(prevCard));
    });
    card.appendChild(copyBtn);

    host.appendChild(card);
  }
}

function readOwnerBarberEditScheduleFromHost(host) {
  var map = {};
  for (var day = 1; day <= 7; day++) {
    var card = host.querySelector('[data-owner-day="' + day + '"]');
    if (card) map[day] = getOwnerDayStateFromCard(card);
  }
  return map;
}

function closeOwnerBarberEditModal() {
  var ov = $("ownerBarberEditOverlay");
  if (ov) ov.hidden = true;
  window.__ownerBarberEditCtx = null;
}

function openOwnerBarberEditModal(barber) {
  var shopId = window.__ownerShopId;
  if (!shopId || !barber || !barber.id) return;
  window.__ownerBarberEditCtx = { shopId: shopId, barberId: barber.id };
  var nameIn = $("ownerBarberEditName");
  var daysHost = $("ownerBarberEditDays");
  if (nameIn) nameIn.value = barber.name || "";
  if (daysHost) {
    renderOwnerBarberEditDays(
      daysHost,
      normalizeBarberSchedule(barber.scheduleByDay)
    );
  }
  var ov = $("ownerBarberEditOverlay");
  if (ov) ov.hidden = false;
  if (nameIn) nameIn.focus();
}

async function saveOwnerBarberEditModal() {
  var ctx = window.__ownerBarberEditCtx;
  if (!ctx) return;
  var name = ($("ownerBarberEditName") && $("ownerBarberEditName").value.trim()) || "";
  var host = $("ownerBarberEditDays");
  if (!name) {
    setOwnerStatus("Indique o nome do barbeiro.", true);
    return;
  }
  var sched = readOwnerBarberEditScheduleFromHost(host);
  var any = false;
  for (var d = 1; d <= 7; d++) {
    if (sched[d] && sched[d].isWorking) any = true;
  }
  if (!any) {
    setOwnerStatus("Marque ao menos um dia de trabalho.", true);
    return;
  }
  try {
    await db
      .collection("barbershops")
      .doc(ctx.shopId)
      .collection("barbers")
      .doc(ctx.barberId)
      .update({
        name: name,
        scheduleByDay: scheduleByDayToFirestoreMap(sched),
      });
    closeOwnerBarberEditModal();
    await loadOwnerBarbersPanel();
    await loadOwnerAgendaPanel();
    setOwnerStatus("Barbeiro atualizado.");
  } catch (e) {
    setOwnerStatus(e.message || "Erro ao guardar.", true);
  }
}

async function resolveOwnerShop(uid) {
  const snap = await db
    .collection("barbershops")
    .where("ownerUid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { shopId: doc.id, name: doc.data().name || "" };
}

function showLandingHome() {
  stopClientAppointmentsListener();
  clientApptsListenerKey = "";
  setBodyLayout("landing");
  document.title = "Barb x Go";
  $("homeLanding").hidden = false;
  $("ownerPortal").hidden = true;
  $("app").hidden = true;
  setLandingHeroVisible(true);
}

function showOwnerPortalUI() {
  setBodyLayout("app");
  document.title =
    (window.__ownerShopName || "Barbearia") + " · Barb x Go";
  $("homeLanding").hidden = true;
  $("ownerPortal").hidden = false;
  $("app").hidden = true;
  $("loginCard").hidden = true;
  $("findStub").hidden = true;
  const t = $("ownerShopTitle");
  if (t) t.textContent = window.__ownerShopName || "Barbearia";
  hideShopHeader();
  switchOwnerTab("barbers");
  refreshOwnerShopPublicUrl().catch(function () {});
}

function switchOwnerTab(name) {
  document.querySelectorAll(".owner-tab").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-owner-tab") === name);
  });
  const map = {
    barbers: $("ownerPanelBarbers"),
    agenda: $("ownerPanelAgenda"),
    menu: $("ownerPanelMenu"),
    finance: $("ownerPanelFinance"),
    location: $("ownerPanelLocation"),
  };
  Object.keys(map).forEach(function (k) {
    const el = map[k];
    if (el) el.hidden = k !== name;
  });
  if (name === "barbers") {
    loadOwnerBarbersPanel().catch(function () {});
    stopOwnerInboxListener();
    showOwnerInboxFab(false);
  } else if (name === "agenda") {
    loadOwnerAgendaPanel().catch(function () {});
    showOwnerInboxFab(true);
    loadOwnerInboxPanel().catch(function () {});
  } else if (name === "menu") {
    loadOwnerMenuPanel().catch(function () {});
    stopOwnerInboxListener();
    showOwnerInboxFab(false);
  } else if (name === "finance") {
    loadOwnerFinancePanel().catch(function () {});
    stopOwnerInboxListener();
    showOwnerInboxFab(false);
  } else if (name === "location") {
    loadOwnerLocationPanel().catch(function () {});
    stopOwnerInboxListener();
    showOwnerInboxFab(false);
  }
}

async function loadOwnerBarbersPanel() {
  const shopId = window.__ownerShopId;
  const listEl = $("ownerBarbersList");
  if (!shopId || !listEl) return;
  setOwnerStatus("");
  const barbers = await loadBarbers(shopId);
  listEl.innerHTML = "";
  if (!barbers.length) {
    listEl.innerHTML = '<p class="muted">Ainda sem barbeiros. Adicione abaixo.</p>';
    return;
  }
  barbers.forEach(function (b) {
    const card = document.createElement("div");
    card.className = "owner-barber-card";
    const main = document.createElement("div");
    main.className = "owner-barber-card-main";
    const nm = document.createElement("p");
    nm.className = "owner-barber-card-name";
    nm.textContent = b.name;
    const sub = document.createElement("p");
    sub.className = "owner-barber-card-sub";
    sub.textContent = barberWorkingDaysLine(b.scheduleByDay);
    main.appendChild(nm);
    main.appendChild(sub);
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-outline btn-sm";
    editBtn.textContent = "Editar";
    editBtn.setAttribute("aria-label", "Editar " + b.name);
    editBtn.addEventListener("click", function () {
      openOwnerBarberEditModal(b);
    });
    card.appendChild(main);
    card.appendChild(editBtn);
    listEl.appendChild(card);
  });
}

async function loadOwnerMenuPanel() {
  const shopId = window.__ownerShopId;
  const listEl = $("ownerServicesList");
  if (!shopId || !listEl) return;
  const services = await loadServices(shopId);
  window.__ownerServicesCache = services;
  listEl.innerHTML = "";
  if (!services.length) {
    listEl.innerHTML = '<p class="muted">Sem serviços. Adicione abaixo.</p>';
    return;
  }
  services.forEach(function (s) {
    const row = document.createElement("div");
    row.className = "owner-service-edit-row";

    const nameLab = document.createElement("label");
    nameLab.className = "field owner-svc-field";
    const nameSpan = document.createElement("span");
    nameSpan.className = "field-label";
    nameSpan.textContent = "Nome";
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.required = true;
    nameIn.value = s.name;
    nameLab.appendChild(nameSpan);
    nameLab.appendChild(nameIn);

    const priceLab = document.createElement("label");
    priceLab.className = "field owner-svc-field";
    const priceSpan = document.createElement("span");
    priceSpan.className = "field-label";
    priceSpan.textContent = "Preço (R$)";
    const priceIn = document.createElement("input");
    priceIn.type = "number";
    priceIn.step = "0.01";
    priceIn.min = "0";
    priceIn.required = true;
    priceIn.value = (s.priceCents / 100).toFixed(2);
    priceLab.appendChild(priceSpan);
    priceLab.appendChild(priceIn);

    const durLab = document.createElement("label");
    durLab.className = "field owner-svc-field owner-svc-field-narrow";
    const durSpan = document.createElement("span");
    durSpan.className = "field-label";
    durSpan.textContent = "Duração média (min)";
    const durIn = document.createElement("input");
    durIn.type = "number";
    durIn.min = "5";
    durIn.step = "5";
    durIn.value = String(s.durationMinutes);
    durLab.appendChild(durSpan);
    durLab.appendChild(durIn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-filled btn-sm owner-svc-save";
    saveBtn.textContent = "Salvar";

    saveBtn.addEventListener("click", async function () {
      const name = nameIn.value.trim();
      const price = parseFloat(priceIn.value);
      const dur = parseInt(durIn.value, 10) || 30;
      if (!name || isNaN(price)) {
        setOwnerStatus("Preencha nome e preço válidos.", true);
        return;
      }
      const cents = Math.round(price * 100);
      const durationMinutes = Math.max(5, dur);
      try {
        await db
          .collection("barbershops")
          .doc(shopId)
          .collection("services")
          .doc(s.id)
          .update({
            name: name,
            priceCents: cents,
            durationMinutes: durationMinutes,
          });
        await loadOwnerMenuPanel();
        setOwnerStatus("Serviço atualizado.");
      } catch (e) {
        setOwnerStatus(e.message || "Erro ao salvar.", true);
      }
    });

    row.appendChild(nameLab);
    row.appendChild(priceLab);
    row.appendChild(durLab);
    row.appendChild(saveBtn);
    listEl.appendChild(row);
  });
}

async function loadOwnerFinancePanel() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const start = y + "-" + String(mo).padStart(2, "0") + "-01";
  const lastDay = new Date(y, mo, 0).getDate();
  const end =
    y + "-" + String(mo).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0");
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", ">=", start)
    .where("dateKey", "<=", end)
    .get();
  let sum = 0;
  snap.docs.forEach(function (doc) {
    const d = doc.data();
    if ((d.createdBy || "") === "CLIENT" && (d.appFeeCents || 0) > 0) {
      sum += Number(d.appFeeCents);
    }
  });
  const blurb = $("ownerFinanceBlurb");
  if (blurb) {
    blurb.textContent =
      "Total referente a agendamentos feitos pelo cliente (taxa do app) no mês " +
      mo +
      "/" +
      y +
      ".";
  }
  const tot = $("ownerFinanceTotal");
  if (tot) tot.textContent = priceToBRL(sum);
}

async function addOwnerDelayMinutes(shopId, dateKey, barberId, delta) {
  const docId = dateKey + "_" + barberId;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("barberDayState")
    .doc(docId);
  await ref.set(
    {
      delayMinutes: firebase.firestore.FieldValue.increment(delta),
      dateKey: dateKey,
      barberId: barberId,
    },
    { merge: true }
  );
}

function appendOwnerSlotActions(body, r, shopId) {
  const id = r.appointmentId;
  if (!id) return;
  const wrap = document.createElement("div");
  wrap.className = "owner-slot-actions";
  if (r.state === "scheduled") {
    const st = document.createElement("button");
    st.type = "button";
    st.textContent = "Start";
    st.addEventListener("click", function () {
      ownerStartAppointment(shopId, id).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(st);
  }
  if (r.state === "scheduled" || r.state === "in_progress") {
    const fn = document.createElement("button");
    fn.type = "button";
    fn.textContent = "Finalizar";
    fn.addEventListener("click", function () {
      ownerFinishAppointment(shopId, id, r).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(fn);
    const cx = document.createElement("button");
    cx.type = "button";
    cx.className = "danger";
    cx.textContent = "Cancelar";
    cx.addEventListener("click", function () {
      ownerCancelAppointment(shopId, id).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(cx);
  }
  body.appendChild(wrap);
}

async function ownerStartAppointment(shopId, apptId) {
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() || {}) : {};
  setOwnerStatus("A iniciar…");
  await ref.update({
    status: "IN_PROGRESS",
    actualStartAtMillis: Date.now(),
  });
  setOwnerStatus("");

  try {
    await createInboxMessage(shopId, {
      type: "IN_PROGRESS",
      title: "Atendimento iniciado",
      text:
        `${d.dateKey || ""} · ${d.timeLabel || ""}\n` +
        `${d.clientName || ""} · ${d.serviceName || ""}`,
      appointmentId: apptId,
      barberId: d.barberId || "",
      dateKey: d.dateKey || "",
      timeLabel: d.timeLabel || "",
      clientName: d.clientName || "",
    });
  } catch (_e) {
    /* ignore */
  }
}

async function ownerCancelAppointment(shopId, apptId) {
  if (!confirm("Cancelar este agendamento?")) return;
  await initFirebaseCore();
  const u = firebase.auth().currentUser;
  if (!u) {
    throw new Error("Sessão expirada. Entre novamente.");
  }
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() || {}) : {};
  try {
    setOwnerStatus("Cancelando…");
    await ref.update({ status: "CANCELLED", cancelledAtMillis: Date.now() });
    // A agenda do dono é em tempo real (onSnapshot). Não recarregar aqui evita “piscar/voltar”.
    setOwnerStatus("Agendamento cancelado.");
  } catch (e) {
    const code = e && e.code ? String(e.code) : "";
    const msg = e && e.message ? String(e.message) : "Erro ao cancelar.";
    // Dica prática quando a regra isOwner não está a bater (ownerUid diferente / rules não publicadas).
    setOwnerStatus((code ? code + " — " : "") + msg, true);
    throw e;
  }

  try {
    await createInboxMessage(shopId, {
      type: "CANCELLED_BY_OWNER",
      title: "Cancelamento (barbearia)",
      text:
        `${d.dateKey || ""} · ${d.timeLabel || ""}\n` +
        `${d.clientName || ""} · ${d.serviceName || ""}`,
      appointmentId: apptId,
      barberId: d.barberId || "",
      dateKey: d.dateKey || "",
      timeLabel: d.timeLabel || "",
      clientName: d.clientName || "",
    });
  } catch (_e) {
    /* ignore */
  }
}

async function ownerFinishAppointment(shopId, apptId, r) {
  const svc = r.servicePriceCents || 0;
  const fee = r.appFeeCents || 0;
  const total = svc + fee;
  const msg =
    "Total a cobrar: " +
    priceToBRL(total);
  if (!confirm(msg + "\n\nMarcar atendimento como finalizado?")) return;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() || {}) : {};
  setOwnerStatus("A finalizar…");
  await ref.update({
    status: "DONE",
    actualEndAtMillis: Date.now(),
  });
  setOwnerStatus("Atendimento finalizado.");

  try {
    await createInboxMessage(shopId, {
      type: "DONE",
      title: "Atendimento finalizado",
      text:
        `${d.dateKey || ""} · ${d.timeLabel || ""}\n` +
        `${d.clientName || ""} · ${d.serviceName || ""}`,
      appointmentId: apptId,
      barberId: d.barberId || "",
      dateKey: d.dateKey || "",
      timeLabel: d.timeLabel || "",
      clientName: d.clientName || "",
    });
  } catch (_e) {
    /* ignore */
  }
}

function renderOwnerAgendaRow(rowEl, r, shopId, barberId, dateKey, barber) {
  rowEl.className = "day-agenda-row";
  if (r.state === "lunch") rowEl.classList.add("is-lunch");
  else if (r.state === "past") rowEl.classList.add("is-past");
  else if (r.state === "free") rowEl.classList.add("is-free");
  else if (r.state === "done") rowEl.classList.add("is-done");
  else if (r.state === "in_progress") rowEl.classList.add("is-progress");
  else if (r.state === "scheduled") rowEl.classList.add("is-scheduled");

  const time = document.createElement("span");
  time.className = "day-agenda-time";
  time.textContent = r.timeLabel;
  const body = document.createElement("div");
  body.className = "day-agenda-body";

  if (r.state === "lunch") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-lunch";
    b.textContent = "Almoço";
    body.appendChild(b);
    const sub = document.createElement("span");
    sub.className = "day-agenda-lunch-sub";
    sub.textContent = r.lunchSubtitle || "";
    body.appendChild(sub);
  } else if (r.state === "past") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-past";
    b.textContent = LABEL_FREE_SLOT_PAST;
    body.appendChild(b);
  } else if (r.state === "free") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-free";
    b.textContent = "Livre";
    body.appendChild(b);
    const mb = document.createElement("button");
    mb.type = "button";
    mb.textContent = "Marcar (barbeiro)";
    mb.addEventListener("click", function () {
      openOwnerBookModal(shopId, barberId, dateKey, r.timeLabel, barber).catch(
        function (e) {
          setOwnerStatus(e.message || "Erro", true);
        }
      );
    });
    body.appendChild(mb);
  } else {
    const stLabel =
      r.state === "done"
        ? "Finalizado"
        : r.state === "in_progress"
          ? "Em atendimento"
          : "Agendado";
    const badge = document.createElement("span");
    badge.className =
      "agenda-badge agenda-badge-" +
      (r.state === "done"
        ? "done"
        : r.state === "in_progress"
          ? "progress"
          : "scheduled");
    badge.textContent = stLabel;
    body.appendChild(badge);
    const name = document.createElement("span");
    name.className = "day-agenda-name";
    name.textContent = r.clientName || "—";
    body.appendChild(name);
    if (r.pastDue) {
      const h = document.createElement("span");
      h.className = "day-agenda-past-hint";
      h.textContent = "Horário já passou";
      body.appendChild(h);
    }
    if (r.serviceName) {
      const svc = document.createElement("span");
      svc.className = "day-agenda-service";
      svc.textContent = r.serviceName;
      body.appendChild(svc);
    }
    appendOwnerSlotActions(body, r, shopId);
  }

  rowEl.appendChild(time);
  rowEl.appendChild(body);
}

function populateOwnerAgendaBarberSelect(barbers) {
  const sel = $("ownerAgendaBarberSelect");
  if (!sel) return null;
  const prevOnScreen = sel.value;
  sel.innerHTML = "";
  if (!barbers.length) {
    sel.disabled = true;
    return null;
  }
  sel.disabled = false;
  let saved = "";
  try {
    saved = sessionStorage.getItem(OWNER_AGENDA_BARBER_KEY) || "";
  } catch (_e) {
    /* private mode */
  }
  const validId = function (id) {
    return (
      !!id &&
      barbers.some(function (b) {
        return b.id === id;
      })
    );
  };
  const multi = barbers.length > 1;
  if (multi) {
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Selecione o barbeiro";
    sel.appendChild(ph);
  }
  barbers.forEach(function (b) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name || "Barbeiro";
    sel.appendChild(o);
  });
  let chosen = "";
  if (validId(saved)) chosen = saved;
  else if (validId(prevOnScreen)) chosen = prevOnScreen;
  else if (!multi) chosen = barbers[0].id;
  sel.value = chosen;
  try {
    if (chosen) sessionStorage.setItem(OWNER_AGENDA_BARBER_KEY, chosen);
    else sessionStorage.removeItem(OWNER_AGENDA_BARBER_KEY);
  } catch (_e) {
    /* ignore */
  }
  return chosen || null;
}

async function loadOwnerAgendaPanel() {
  const shopId = window.__ownerShopId;
  const board = $("ownerAgendaBoard");
  const dateInput = $("ownerAgendaDate");
  if (!shopId || !board) return;
  const dateKey = dateInput && dateInput.value ? dateInput.value : toDateKey();
  if (dateInput) dateInput.value = dateKey;
  setOwnerStatus("A carregar agenda…");
  const barbers = await loadBarbers(shopId);
  const selectedId = populateOwnerAgendaBarberSelect(barbers);
  if (!barbers.length) {
    board.innerHTML = '<p class="muted">Cadastre barbeiros primeiro.</p>';
    setOwnerStatus("");
    stopOwnerAgendaListener();
    return;
  }
  if (!selectedId) {
    board.innerHTML =
      '<p class="muted">Selecione um barbeiro acima para ver a agenda do dia.</p>';
    setOwnerStatus("");
    stopOwnerAgendaListener();
    return;
  }
  const barber = barbers.find(function (b) {
    return b.id === selectedId;
  });
  if (!barber) {
    board.innerHTML = '<p class="muted">Barbeiro não encontrado.</p>';
    setOwnerStatus("");
    stopOwnerAgendaListener();
    return;
  }

  const key = shopId + "|" + dateKey + "|" + barber.id;
  // Se já existe listener para este mesmo dia/barbeiro, NÃO limpar o board.
  // Caso contrário, quando chamamos loadOwnerAgendaPanel() após uma ação (ex: apagar agendamento),
  // o board ficava vazio até um próximo evento do Firestore.
  if (ownerAgendaListenerKey === key && ownerAgendaUnsub) {
    setOwnerStatus("");
    return;
  }

  stopOwnerAgendaListener();
  ownerAgendaListenerKey = key;
  board.innerHTML = '<p class="muted">A carregar…</p>';
  ownerAgendaUnsub = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", "==", dateKey)
    .onSnapshot(
      function (snap) {
        const allAppts = snap.docs.map(function (doc) {
          const x = doc.data() || {};
          return Object.assign({ id: doc.id }, x);
        });

        board.innerHTML = "";
        const col = document.createElement("div");
        col.className = "owner-agenda-col";
        const head = document.createElement("div");
        head.className = "owner-agenda-col-head";
        const h4 = document.createElement("h4");
        h4.textContent = barber.name;
        const ed = document.createElement("button");
        ed.type = "button";
        ed.className = "btn btn-ghost btn-sm";
        ed.textContent = "Editar";
        ed.setAttribute("aria-label", "Editar horários de " + barber.name);
        ed.addEventListener("click", function () {
          openOwnerBarberEditModal(barber);
        });
        head.appendChild(h4);
        head.appendChild(ed);
        col.appendChild(head);

        const delayDiv = document.createElement("div");
        delayDiv.className = "owner-agenda-delay";
        [5, 10, 20].forEach(function (dm) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = "+" + dm + " min";
          b.addEventListener("click", function () {
            addOwnerDelayMinutes(shopId, dateKey, barber.id, dm)
              .then(function () {
                return loadOwnerAgendaPanel();
              })
              .catch(function (e) {
                setOwnerStatus(e.message || "Erro", true);
              });
          });
          delayDiv.appendChild(b);
        });
        col.appendChild(delayDiv);

        const forBarber = allAppts.filter(function (a) {
          return (
            a.barberId === barber.id &&
            (a.status || "SCHEDULED") !== "CANCELLED"
          );
        });
        const rows = window.NaReguaSchedule.buildDayAgendaList(
          barber.scheduleByDay,
          dateKey,
          forBarber,
          new Date()
        );
        const listHost = document.createElement("div");
        listHost.className = "day-agenda-list";
        rows.forEach(function (r) {
          const rowEl = document.createElement("div");
          renderOwnerAgendaRow(rowEl, r, shopId, barber.id, dateKey, barber);
          listHost.appendChild(rowEl);
        });
        col.appendChild(listHost);
        board.appendChild(col);
        // Não limpar mensagens de sucesso/erro (ex: "Agendamento cancelado.") imediatamente.
        // Só remove o "A carregar…" quando a primeira snapshot chega.
        clearOwnerStatusIfLoading();
      },
      function (e) {
        // Não apagar a agenda inteira em caso de falha temporária.
        setOwnerStatus(e.message || "Erro ao carregar agenda.", true);
      }
    );
}

function closeOwnerBookModal() {
  const ov = $("ownerModalOverlay");
  if (ov) ov.hidden = true;
  window.__ownerBookCtx = null;
}

async function openOwnerBookModal(shopId, barberId, dateKey, timeLabel, barber) {
  window.__ownerBookCtx = {
    shopId: shopId,
    barberId: barberId,
    dateKey: dateKey,
    timeLabel: timeLabel,
    barber: barber,
  };
  let services = window.__ownerServicesCache;
  if (!services || !services.length) {
    services = await loadServices(shopId);
    window.__ownerServicesCache = services;
  }
  const svcSel = $("ownerModalService");
  svcSel.innerHTML = "";
  if (!services.length) {
    setOwnerStatus("Cadastre serviços na secção Serviço primeiro.", true);
    return;
  }
  services.forEach(function (s) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name + " (" + priceToBRL(s.priceCents) + ")";
    svcSel.appendChild(opt);
  });
  const meta = $("ownerModalMeta");
  if (meta) {
    meta.textContent = barber.name + " · " + timeLabel + " · " + dateKey;
  }
  $("ownerModalClientName").value = "";
  $("ownerModalOverlay").hidden = false;
}

async function confirmOwnerBookModal() {
  const ctx = window.__ownerBookCtx;
  if (!ctx) return;
  const name = $("ownerModalClientName").value.trim();
  const serviceId = $("ownerModalService").value;
  const service = (window.__ownerServicesCache || []).find(function (s) {
    return s.id === serviceId;
  });
  if (!name) {
    setOwnerStatus("Informe o nome do cliente.", true);
    return;
  }
  if (!service) {
    setOwnerStatus("Selecione um serviço.", true);
    return;
  }
  const shopId = ctx.shopId;
  const dateKey = ctx.dateKey;
  const daySnap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", "==", dateKey)
    .get();
  const wantName = normalizeClientName(name);
  try {
    daySnap.docs.forEach(function (doc) {
      const d = doc.data();
      const st = d.status || "SCHEDULED";
      if (st === "CANCELLED") return;
      const other = normalizeClientName(d.clientName || "");
      if (wantName && other && wantName === other) {
        throw new Error("Já existe um agendamento com este nome neste dia.");
      }
    });
  } catch (e) {
    setOwnerStatus(e.message || "Erro", true);
    return;
  }
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
  try {
    await db
      .collection("barbershops")
      .doc(shopId)
      .collection("appointments")
      .doc(id)
      .set({
        shopId: shopId,
        barberId: ctx.barberId,
        dateKey: dateKey,
        timeLabel: ctx.timeLabel,
        clientName: name,
        serviceId: service.id,
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        status: "SCHEDULED",
        createdBy: "BARBER",
        appFeeCents: 0,
      });
    closeOwnerBookModal();
    await loadOwnerAgendaPanel();
    setOwnerStatus("Horário marcado.");
  } catch (e) {
    setOwnerStatus(e.message || "Erro ao marcar.", true);
  }
}

async function ownerLoginSubmit() {
  setHomeStatus("A entrar…");
  const email = $("ownerEmail").value.trim();
  const password = $("ownerPassword").value;
  if (!email || !password) {
    setHomeStatus("Preencha e-mail e senha.", true);
    return;
  }
  await initFirebaseCore();
  try {
    await firebase.auth().signOut();
    await firebase.auth().signInWithEmailAndPassword(email, password);
    const uid = firebase.auth().currentUser.uid;

    // Se veio ?shopId=... na URL, validar que pertence a este dono e usar ele.
    const desiredShopId = (getQueryParam("shopId") || "").trim();
    if (desiredShopId) {
      const shopSnap = await db.collection("barbershops").doc(desiredShopId).get();
      if (shopSnap.exists) {
        const d = shopSnap.data() || {};
        if (String(d.ownerUid || "") === uid) {
          window.__ownerShopId = shopSnap.id;
          window.__ownerShopName = d.name || "";
        } else {
          throw new Error("Este shopId não pertence a esta conta.");
        }
      } else {
        throw new Error("shopId inválido (barbearia não encontrada).");
      }
    } else {
      const snap = await db
        .collection("barbershops")
        .where("ownerUid", "==", uid)
        .limit(1)
        .get();
      if (snap.empty) {
        await firebase.auth().signOut();
        throw new Error(
          "Nenhuma barbearia ligada a esta conta. O cadastro é feito no aplicativo Barb x Go."
        );
      }
      const doc = snap.docs[0];
      window.__ownerShopId = doc.id;
      window.__ownerShopName = doc.data().name || "";
    }
    setHomeStatus("");
    showOwnerPortalUI();
  } catch (e) {
    let msg = e.message || "Falha ao entrar.";
    if (e.code === "auth/wrong-password" || e.code === "auth/user-not-found") {
      msg = "E-mail ou senha incorretos.";
    }
    if (e.code === "auth/invalid-email") {
      msg = "E-mail inválido.";
    }
    setHomeStatus(msg, true);
  }
}

async function ownerLogoutClick() {
  await firebase.auth().signOut();
  window.__ownerShopId = null;
  window.__ownerShopName = null;
  window.__ownerShopPublicUrl = "";
  window.__ownerShopPathSegment = "";
  teardownOwnerLocationMap();
  stopOwnerInboxListener();
  stopOwnerAgendaListener();
  $("ownerPassword").value = "";
  showLandingHome();
  $("loginCard").hidden = true;
  $("findStub").hidden = true;
  setOwnerStatus("");
}

function setupLandingContactLink() {
  const a = document.getElementById("contactCadastroLink");
  if (!a) return;
  const subj = "Solicitação de cadastro — Barbearia (Barb x Go)";
  const body =
    "Olá,\n\n" +
    "Gostaria de solicitar o cadastro da minha barbearia na plataforma Barb x Go.\n\n" +
    "Nome da barbearia:\n" +
    "Cidade / região:\n" +
    "O meu nome:\n" +
    "Telefone ou e-mail para resposta:\n\n" +
    "Obrigado(a).\n";
  const raw =
    typeof window.NAREGUA_CONTACT_EMAIL === "string"
      ? window.NAREGUA_CONTACT_EMAIL.trim()
      : "";
  const hasTo = raw.indexOf("@") > 0;
  const to = hasTo ? encodeURIComponent(raw) : "";
  a.href =
    "mailto:" +
    to +
    (hasTo ? "?" : "?") +
    "subject=" +
    encodeURIComponent(subj) +
    "&body=" +
    encodeURIComponent(body);
  const line = document.getElementById("contactCadastroEmailLine");
  if (line) {
    if (hasTo) {
      line.textContent = "Pedidos diretos: " + raw;
      line.hidden = false;
    } else {
      line.textContent = "";
      line.hidden = true;
    }
  }
}

async function init() {
  try {
    await initFirebaseCore();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao iniciar Firebase.", true);
    return;
  }

  setupLandingContactLink();

  const ownerAddrInput = $("ownerAddressInput");
  if (ownerAddrInput && !ownerAddrInput.dataset.nareguaDragReset) {
    ownerAddrInput.dataset.nareguaDragReset = "1";
    ownerAddrInput.addEventListener("input", function () {
      ownerLocationMarkerUserDragged = false;
    });
  }

  firebase.auth().onAuthStateChanged(async function (user) {
    const slug = getSlugFromPath();
    if (slug) return;
    if (!user || user.isAnonymous) return;
    try {
      const r = await resolveOwnerShop(user.uid);
      if (!r) return;
      window.__ownerShopId = r.shopId;
      window.__ownerShopName = r.name;
      const appEl = $("app");
      if (appEl && !appEl.hidden) return;
      const loginOpen = $("loginCard") && !$("loginCard").hidden;
      if (loginOpen) return;
      showOwnerPortalUI();
    } catch (e) {
      /* ignore */
    }
  });

  $("btnLoginShop").addEventListener("click", function () {
    $("loginCard").hidden = false;
    $("findStub").hidden = true;
    setLandingHeroVisible(false);
    setHomeStatus("");
  });
  $("btnFindShop").addEventListener("click", function () {
    $("findStub").hidden = false;
    $("loginCard").hidden = true;
    setLandingHeroVisible(false);
    setHomeStatus("");
    setFindShopStatus("");
    const r = $("findShopResults");
    if (r) {
      r.innerHTML = "";
      r.hidden = true;
    }
    const iq = $("findShopQuery");
    if (iq) iq.value = "";
    ensureAnonymousForPublicBooking().catch(function (e) {
      setHomeStatus(
        e.message ||
          "Ative «Anónimo» em Firebase Authentication para procurar barbearias.",
        true
      );
    });
  });
  $("ownerLoginCancel").addEventListener("click", function () {
    $("loginCard").hidden = true;
    setLandingHeroVisible(true);
    setHomeStatus("");
  });
  $("findStubBack").addEventListener("click", function () {
    $("findStub").hidden = true;
    setLandingHeroVisible(true);
    setFindShopStatus("");
    const res = $("findShopResults");
    if (res) {
      res.innerHTML = "";
      res.hidden = true;
    }
    const iq = $("findShopQuery");
    if (iq) iq.value = "";
  });

  // /about/ é servido por página própria; não tratar aqui.
  const findShopForm = $("findShopForm");
  if (findShopForm) {
    findShopForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      runFindShopSearch().catch(function (e) {
        setFindShopStatus(e.message || "Erro", true);
      });
    });
  }
  const findNearbyBtn = $("findNearbyBtn");
  if (findNearbyBtn) {
    findNearbyBtn.addEventListener("click", function () {
      runFindShopNearby().catch(function (e) {
        setFindShopStatus(e.message || "Erro", true);
      });
    });
  }
  const ownerSaveLoc = $("ownerSaveLocationBtn");
  if (ownerSaveLoc) {
    ownerSaveLoc.addEventListener("click", function () {
      (async function () {
        const shopId = window.__ownerShopId;
        const ta = $("ownerAddressInput");
        const note = $("ownerLocationNote");
        if (!shopId || !ta) return;
        const raw = ta.value.trim();
        const canUseMarkerDrag =
          ownerLocationMarkerUserDragged && ownerLocationMarker;
        if (!raw && !canUseMarkerDrag) {
          if (note) {
            note.textContent =
              "Escreva o endereço ou arraste o alfinete no mapa e guarde de novo.";
          }
          return;
        }
        if (note) note.textContent = "A guardar…";
        try {
          let g;
          if (canUseMarkerDrag) {
            const p = ownerLocationMarker.getPosition();
            g = await reverseGeocodeLatLngWithGoogleMaps(p.lat(), p.lng());
            ta.value = g.formatted;
            ownerLocationMarkerUserDragged = false;
          } else {
            g = await geocodeForwardWithGoogleMaps(raw);
            if (ownerLocationMarker && ownerLocationMap) {
              ownerLocationMarker.setPosition({ lat: g.lat, lng: g.lng });
              ownerLocationMap.panTo({ lat: g.lat, lng: g.lng });
              ownerLocationMap.setZoom(16);
            }
            ownerLocationMarkerUserDragged = false;
          }
          await db
            .collection("barbershops")
            .doc(shopId)
            .update({
              address: g.formatted,
              lat: g.lat,
              lng: g.lng,
            });
          ta.value = g.formatted;
          if (note) {
            note.textContent =
              "Guardado. Clientes podem usar «Perto de mim» neste site.";
          }
        } catch (e) {
          if (note) note.textContent = e.message || "Erro";
        }
      })().catch(function (e) {
        const note = $("ownerLocationNote");
        if (note) note.textContent = e.message || "Erro";
      });
    });
  }
  $("ownerLoginSubmit").addEventListener("click", function () {
    ownerLoginSubmit().catch(function (e) {
      setHomeStatus(e.message || "Erro", true);
    });
  });
  $("ownerLogoutBtn").addEventListener("click", function () {
    ownerLogoutClick().catch(function () {});
  });

  $("ownerShareLinkBtn").addEventListener("click", function () {
    (async function () {
      await refreshOwnerShopPublicUrl();
      const url = window.__ownerShopPublicUrl;
      if (!url) {
        setOwnerStatus("Não foi possível gerar o link. Tente mais tarde.", true);
        return;
      }
      const ok = await copyTextToClipboard(url);
      setOwnerStatus(
        ok
          ? "Link Barb x Go copiado — envie ao cliente (WhatsApp, redes, etc.)."
          : "Copie manualmente: " + url
      );
    })().catch(function (e) {
      setOwnerStatus(e.message || "Erro", true);
    });
  });

  $("ownerShareWhatsAppBtn").addEventListener("click", function () {
    (async function () {
      await refreshOwnerShopPublicUrl();
      const url = window.__ownerShopPublicUrl;
      if (!url) {
        setOwnerStatus("Não foi possível gerar o link.", true);
        return;
      }
      const nome = window.__ownerShopName || "a nossa barbearia";
      const text =
        "Olá! Agende em " +
        nome +
        " pelo Barb x Go — é só abrir o link e escolher horário:\n" +
        url;
      window.open(
        "https://wa.me/?text=" + encodeURIComponent(text),
        "_blank",
        "noopener,noreferrer"
      );
    })().catch(function (e) {
      setOwnerStatus(e.message || "Erro", true);
    });
  });

  document.querySelectorAll(".owner-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchOwnerTab(btn.getAttribute("data-owner-tab"));
    });
  });

  $("ownerAddBarberForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const shopId = window.__ownerShopId;
    const name = $("ownerNewBarberName").value.trim();
    if (!name || !shopId) return;
    const ref = db
      .collection("barbershops")
      .doc(shopId)
      .collection("barbers")
      .doc();
    try {
      await ref.set({
        name: name,
        shopId: shopId,
        scheduleByDay: defaultScheduleByDay(),
      });
      $("ownerNewBarberName").value = "";
      await loadOwnerBarbersPanel();
      setOwnerStatus("Barbeiro adicionado.");
    } catch (e) {
      setOwnerStatus(e.message || "Erro", true);
    }
  });

  $("ownerAddServiceForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const shopId = window.__ownerShopId;
    const name = $("ownerSvcName").value.trim();
    const price = parseFloat($("ownerSvcPrice").value);
    const dur = parseInt($("ownerSvcDuration").value, 10) || 30;
    if (!name || !shopId || isNaN(price)) return;
    const cents = Math.round(price * 100);
    try {
      await db
        .collection("barbershops")
        .doc(shopId)
        .collection("services")
        .doc()
        .set({
          name: name,
          priceCents: cents,
          durationMinutes: dur,
          shopId: shopId,
        });
      $("ownerSvcName").value = "";
      $("ownerSvcPrice").value = "";
      await loadOwnerMenuPanel();
      setOwnerStatus("Serviço adicionado.");
    } catch (e) {
      setOwnerStatus(e.message || "Erro", true);
    }
  });

  $("ownerAgendaDate").addEventListener("change", function () {
    loadOwnerAgendaPanel().catch(function () {});
  });
  const ownerAgendaBarberSel = $("ownerAgendaBarberSelect");
  if (ownerAgendaBarberSel) {
    ownerAgendaBarberSel.addEventListener("change", function () {
      const v = ownerAgendaBarberSel.value;
      try {
        if (v) sessionStorage.setItem(OWNER_AGENDA_BARBER_KEY, v);
        else sessionStorage.removeItem(OWNER_AGENDA_BARBER_KEY);
      } catch (_e) {
        /* ignore */
      }
      loadOwnerAgendaPanel().catch(function () {});
      if (ownerInboxOverlayOpen) ownerInboxScrollToBottomPending = true;
      loadOwnerInboxPanel().catch(function () {});
    });
  }

  $("ownerModalCancel").addEventListener("click", closeOwnerBookModal);
  $("ownerModalConfirm").addEventListener("click", function () {
    confirmOwnerBookModal().catch(function (e) {
      setOwnerStatus(e.message || "Erro", true);
    });
  });
  $("ownerModalOverlay").addEventListener("click", function (ev) {
    if (ev.target === $("ownerModalOverlay")) closeOwnerBookModal();
  });

  var barberEditOv = $("ownerBarberEditOverlay");
  if (barberEditOv) {
    $("ownerBarberEditCancel").addEventListener("click", closeOwnerBarberEditModal);
    $("ownerBarberEditSave").addEventListener("click", function () {
      saveOwnerBarberEditModal().catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    barberEditOv.addEventListener("click", function (ev) {
      if (ev.target === barberEditOv) closeOwnerBarberEditModal();
    });
  }

  $("dateKey").addEventListener("change", loadAvailability);
  $("barberSelect").addEventListener("change", loadAvailability);
  $("bookBtn").addEventListener("click", function () {
    book().catch(function (e) {
      setStatus(e.message || "Erro ao agendar.", true);
    });
  });
  const cancelBtn = $("cancelBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      cancelSelectedAppointment().catch(function (e) {
        setStatus(e.message || "Erro ao cancelar.", true);
      });
    });
  }

  const ownerInboxSoundBtn = $("ownerInboxSoundBtn");
  if (ownerInboxSoundBtn) {
    ownerInboxSoundBtn.addEventListener("click", function () {
      const next = !isInboxSoundEnabled();
      setInboxSoundEnabled(next);
      ownerInboxSoundBtn.textContent = next ? "Som: ligado" : "Ativar som";
      if (next) playInboxBeep();
    });
  }
  const ownerInboxFab = $("ownerInboxFab");
  if (ownerInboxFab) {
    ownerInboxFab.addEventListener("click", function () {
      openOwnerInboxOverlay(!ownerInboxOverlayOpen);
      if (ownerInboxOverlayOpen) loadOwnerInboxPanel().catch(function () {});
    });
  }
  const ownerInboxCloseBtn = $("ownerInboxCloseBtn");
  if (ownerInboxCloseBtn) {
    ownerInboxCloseBtn.addEventListener("click", function () {
      openOwnerInboxOverlay(false);
    });
  }
  const ownerInboxOverlay = $("ownerInboxOverlay");
  if (ownerInboxOverlay) {
    ownerInboxOverlay.addEventListener("click", function (ev) {
      if (ev.target === ownerInboxOverlay) openOwnerInboxOverlay(false);
    });
  }

  const slugFromPath = getSlugFromPath();
  const queryShopId = getQueryParam("shopId");

  if (slugFromPath) {
    setHomeStatus("A abrir barbearia…");
    try {
      await ensureAnonymousForPublicBooking();
      await resolveAndLoad(slugFromPath);
      setHomeStatus("");
    } catch (e) {
      setHomeStatus(
        e.message || "Barbearia não encontrada. Verifique o link.",
        true
      );
      setBodyLayout("landing");
      $("homeLanding").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  if (queryShopId && queryShopId.trim()) {
    try {
      await ensureAnonymousForPublicBooking();
      window.__shopId = queryShopId.trim();
      window.__shopName = "";
      setBodyLayout("app");
      $("homeLanding").hidden = true;
      $("ownerPortal").hidden = true;
      $("app").hidden = false;
      applyBookingHeadlines("");
      hideShopHeader();
      setStatus("");
      await loadData(window.__shopId);
    } catch (e) {
      setHomeStatus(e.message || "Erro ao carregar.", true);
      setBodyLayout("landing");
      $("homeLanding").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  setBodyLayout("landing");
  $("homeLanding").hidden = false;
}

init();
