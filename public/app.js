/**
 * API: Cloud Function `naReguaWebApi` via `/api` (Netlify) ou URL em `api-config.js`.
 */
function getApiBase() {
  const w = typeof window !== "undefined" ? window : undefined;
  const custom = w?.NA_REGUA_API_BASE;
  if (typeof custom === "string" && custom.trim().length > 0) {
    return custom.replace(/\/$/, "");
  }
  return "/api";
}

const $ = (id) => document.getElementById(id);

function looksLikeHtml(s) {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return (
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    t.includes("<html") ||
    t.includes("page not found")
  );
}

/** Nunca mostrar HTML bruto ao utilizador. */
function humanizeApiError(status, bodyText) {
  if (looksLikeHtml(bodyText)) {
    if (status === 404) {
      return (
        "A API não foi encontrada (404). No Netlify, abra netlify.toml e substitua SEU_PROJECT_ID pela URL real da função naReguaWebApi, " +
        "ou edite public/api-config.js com essa URL e faça deploy de novo."
      );
    }
    return (
      "O servidor devolveu uma página de erro (HTML). Confirme o proxy /api no Netlify e o deploy das Cloud Functions."
    );
  }
  const raw = (bodyText || "").trim();
  if (!raw) {
    if (status === 0) return "Sem ligação à internet.";
    return `Erro ${status}. Tente novamente.`;
  }
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.error === "string") return j.error;
  } catch (_) {
    /* texto simples */
  }
  if (raw.length > 220) return raw.slice(0, 220) + "…";
  return raw;
}

async function fetchJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    const msg =
      e && (e.message === "Failed to fetch" || String(e.name) === "TypeError")
        ? "Sem ligação à API. No Netlify use o endereço /api (mesmo site), confira netlify.toml e faça deploy. Se a função estiver nova, faça firebase deploy --only functions e permita invocação pública (IAM)."
        : (e && e.message) || "Erro de rede.";
    throw new Error(msg);
  }
  const text = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(humanizeApiError(res.status, text));
  }

  if (!text || !text.trim()) return {};

  if (looksLikeHtml(text)) {
    throw new Error(humanizeApiError(200, text));
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(
      "Resposta inválida do servidor (não é JSON). Verifique a URL da API em api-config.js ou o netlify.toml."
    );
  }
}

function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

/** Primeiro segmento útil: /Ja-Barber → "Ja-Barber" */
function getSlugFromPath() {
  let path = window.location.pathname || "/";
  if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
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

function setPickerStatus(msg, isError = false) {
  const el = $("pickerStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
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

async function resolveAndLoad(slug) {
  const r = await fetchJson(
    `${getApiBase()}?action=resolveShop&slug=${encodeURIComponent(slug)}`
  );
  window.__shopId = r.shopId;
  window.__shopName = r.name || "";
  $("bookingTitle").textContent = r.name ? `Agendar — ${r.name}` : "Agendar";
  $("bookingSubtitle").textContent = r.name
    ? "Escolha data, barbeiro, serviço e horário."
    : "";
  showShopHeader(r.name || "");
  $("shopPicker").hidden = true;
  $("app").hidden = false;
  setStatus("");
  await loadData(r.shopId);
}

async function loadData(shopId) {
  const base = getApiBase();
  const [barbersRes, servicesRes] = await Promise.all([
    fetchJson(`${base}?action=barbers&shopId=${encodeURIComponent(shopId)}`),
    fetchJson(`${base}?action=services&shopId=${encodeURIComponent(shopId)}`),
  ]);

  const barbers = barbersRes.barbers || [];
  const services = servicesRes.services || [];

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
    (s) => `${s.name} (${priceToBRL(s.priceCents)})`
  );

  $("dateKey").value = toDateKey();
  await loadAvailability();
}

async function loadAvailability() {
  const shopId = window.__shopId;
  const dateKey = $("dateKey").value;
  const barberId = $("barberSelect").value;
  if (!shopId || !dateKey || !barberId) return;

  const slotsEl = $("slots");
  try {
    setStatus("Carregando horários...");
    const res = await fetchJson(
      `${getApiBase()}?action=availability&shopId=${encodeURIComponent(
        shopId
      )}&dateKey=${encodeURIComponent(dateKey)}&barberId=${encodeURIComponent(barberId)}`
    );
    const slots = res.slots || [];

    slotsEl.innerHTML = "";
    window.__selectedTimeLabel = null;

    if (!slots.length) {
      slotsEl.innerHTML = `<p class="muted">Sem horários livres neste dia para este barbeiro.</p>`;
      setStatus("Escolha outra data ou outro barbeiro.");
      return;
    }

    for (const t of slots) {
      const btn = document.createElement("button");
      btn.className = "slot";
      btn.type = "button";
      btn.textContent = t;
      btn.addEventListener("click", () => {
        window.__selectedTimeLabel = t;
        slotsEl.querySelectorAll(".slot").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      slotsEl.appendChild(btn);
    }

    setStatus("Toque em um horário livre.");
  } catch (e) {
    slotsEl.innerHTML = "";
    setStatus(e.message || "Erro ao carregar horários.", true);
  }
}

function getSelectedService() {
  const serviceId = $("serviceSelect").value;
  return (window.__services || []).find((s) => s.id === serviceId) || null;
}

async function book() {
  const shopId = window.__shopId;
  const barberId = $("barberSelect").value;
  const dateKey = $("dateKey").value;
  const timeLabel = window.__selectedTimeLabel;
  const clientName = $("clientName").value.trim();
  const clientPhone = $("clientPhone").value.trim();
  const service = getSelectedService();

  if (!clientName) return setStatus("Informe seu nome.", true);
  if (!clientPhone) return setStatus("Informe seu telefone.", true);
  if (!service) return setStatus("Selecione um serviço.", true);
  if (!timeLabel) return setStatus("Selecione um horário.", true);

  setStatus("Confirmando agendamento...");
  const payload = {
    shopId,
    barberId,
    dateKey,
    timeLabel,
    clientName,
    clientPhone,
    serviceId: service.id,
  };

  try {
    const r = await fetchJson(`${getApiBase()}?action=book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    $("slots").querySelectorAll(".slot").forEach((b) => {
      b.disabled = true;
    });
    setStatus(`Agendamento confirmado. Referência: ${r.appointmentId || "-"}.`);
    await loadAvailability();
  } catch (e) {
    setStatus(e.message || "Não foi possível confirmar. Tente novamente.", true);
  }
}

async function init() {
  const slugFromPath = getSlugFromPath();
  const queryShopId = getQueryParam("shopId");

  $("loadShopBtn").addEventListener("click", async () => {
    const shopId = $("shopIdInput").value.trim();
    if (!shopId) {
      setPickerStatus("Digite o shopId.", true);
      return;
    }
    setPickerStatus("Carregando…");
    window.__shopId = shopId;
    try {
      $("bookingTitle").textContent = "Agendar";
      $("bookingSubtitle").textContent =
        "Escolha data, barbeiro, serviço e horário.";
      $("shopPicker").hidden = true;
      $("app").hidden = false;
      hideShopHeader();
      setStatus("");
      await loadData(shopId);
      setPickerStatus("");
    } catch (e) {
      $("shopPicker").hidden = false;
      $("app").hidden = true;
      setPickerStatus(e.message || "Erro ao carregar.", true);
    }
  });

  $("dateKey").addEventListener("change", loadAvailability);
  $("barberSelect").addEventListener("change", loadAvailability);
  $("bookBtn").addEventListener("click", () => {
    book().catch((e) => setStatus(e.message || "Erro ao agendar.", true));
  });

  // /slug → resolve shop
  if (slugFromPath) {
    setPickerStatus("Abrindo barbearia…");
    try {
      await resolveAndLoad(slugFromPath);
      setPickerStatus("");
    } catch (e) {
      setPickerStatus(
        e.message || "Barbearia não encontrada. Verifique o nome no link ou use o shopId.",
        true
      );
      $("shopPicker").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  // ?shopId= → carregar direto
  if (queryShopId) {
    $("shopIdInput").value = queryShopId;
    $("loadShopBtn").click();
  }
}

init();
