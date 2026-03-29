/**
 * Igual a functions/src/scheduleEngine.ts e ScheduleEngine.kt no Android.
 */
(function () {
  function parseMinutes(s) {
    const t = String(s).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  function formatMinutes(total) {
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  function generateBaseSlotLabels(day) {
    const start = parseMinutes(day.startTime);
    const end = parseMinutes(day.endTime);
    if (start == null || end == null) return [];
    const step = Math.max(5, day.intervalMinutes || 30);
    const lunchStart = day.lunchStart ? parseMinutes(day.lunchStart) : null;
    const lunchEnd = day.lunchEnd ? parseMinutes(day.lunchEnd) : null;
    const result = [];
    let t = start;
    while (t < end) {
      if (
        lunchStart != null &&
        lunchEnd != null &&
        t >= lunchStart &&
        t < lunchEnd
      ) {
        t += step;
        continue;
      }
      if (t + step > end) break;
      result.push(formatMinutes(t));
      t += step;
    }
    return result;
  }

  function javaDayOfWeekFromDateKey(dateKey) {
    const parts = dateKey.split("-").map(function (x) {
      return parseInt(x, 10);
    });
    const y = parts[0];
    const mo = parts[1];
    const d = parts[2];
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const js = dt.getUTCDay();
    return js === 0 ? 7 : js;
  }

  function parseScheduleFromFirestore(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.keys(raw).forEach(function (k) {
      const day = parseInt(k, 10);
      if (isNaN(day)) return;
      const v = raw[k];
      out[day] = {
        isWorking: !!v.isWorking,
        startTime: String(v.startTime != null ? v.startTime : "09:00"),
        endTime: String(v.endTime != null ? v.endTime : "18:00"),
        intervalMinutes: Number(v.intervalMinutes != null ? v.intervalMinutes : 30),
        lunchStart: v.lunchStart != null ? String(v.lunchStart) : null,
        lunchEnd: v.lunchEnd != null ? String(v.lunchEnd) : null,
      };
    });
    return out;
  }

  function availableSlotLabels(scheduleByDay, dateKey, takenSet) {
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const daySchedule = scheduleByDay[dow];
    if (!daySchedule || !daySchedule.isWorking) return [];
    return generateBaseSlotLabels(daySchedule).filter(function (l) {
      return !takenSet.has(l);
    });
  }

  /** Todos os slots base do dia (para grade da agenda). */
  function generateBaseSlotLabelsForDay(scheduleByDay, dateKey) {
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const daySchedule = scheduleByDay[dow];
    if (!daySchedule || !daySchedule.isWorking) return [];
    return generateBaseSlotLabels(daySchedule);
  }

  function appointmentRowFromDoc(a) {
    const st = a.status || "SCHEDULED";
    const base = {
      timeLabel: a.timeLabel,
      serviceName: a.serviceName || "",
    };
    if (st === "DONE") {
      return Object.assign({}, base, {
        state: "done",
        clientName: a.clientName || "—",
        clientPhone: a.clientPhone || "",
      });
    }
    if (st === "IN_PROGRESS") {
      return Object.assign({}, base, {
        state: "in_progress",
        clientName: a.clientName || "—",
        clientPhone: a.clientPhone || "",
      });
    }
    return Object.assign({}, base, {
      state: "scheduled",
      clientName: a.clientName || "—",
      clientPhone: a.clientPhone || "",
    });
  }

  /**
   * Grade completa do dia: horários de atendimento (livre/ocupado/finalizado),
   * bloco de almoço (pausa — não aparecia antes) e marcações em horários fora da grade.
   */
  function buildDayAgendaList(scheduleByDay, dateKey, appointmentsForBarber) {
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const day = scheduleByDay[dow];
    if (!day || !day.isWorking) return [];

    var lunchStart = day.lunchStart ? parseMinutes(day.lunchStart) : null;
    var lunchEnd = day.lunchEnd ? parseMinutes(day.lunchEnd) : null;
    if (
      lunchStart == null ||
      lunchEnd == null ||
      lunchStart >= lunchEnd
    ) {
      lunchStart = null;
      lunchEnd = null;
    }

    const active = appointmentsForBarber.filter(function (a) {
      return (a.status || "SCHEDULED") !== "CANCELLED";
    });

    const byTime = {};
    active.forEach(function (a) {
      if (a.timeLabel) byTime[a.timeLabel] = a;
    });

    const start = parseMinutes(day.startTime);
    const end = parseMinutes(day.endTime);
    if (start == null || end == null) return [];
    const step = Math.max(5, day.intervalMinutes || 30);

    function inLunch(t) {
      return lunchStart != null && lunchEnd != null && t >= lunchStart && t < lunchEnd;
    }

    const coveredSlotLabels = {};
    const items = [];

    let t = start;
    while (t < end) {
      if (inLunch(t)) {
        const rangeLabel =
          formatMinutes(lunchStart) + " – " + formatMinutes(lunchEnd);
        items.push({
          sortKey: lunchStart,
          row: {
            timeLabel: rangeLabel,
            state: "lunch",
            lunchSubtitle: "Pausa / indisponível para marcação",
          },
        });
        t = lunchEnd;
        continue;
      }
      if (t + step > end) break;
      const label = formatMinutes(t);
      coveredSlotLabels[label] = true;
      const a = byTime[label];
      if (!a) {
        items.push({
          sortKey: parseMinutes(label) || 0,
          row: { timeLabel: label, state: "free" },
        });
      } else {
        items.push({
          sortKey: parseMinutes(label) || 0,
          row: appointmentRowFromDoc(a),
        });
      }
      t += step;
    }

    active.forEach(function (a) {
      if (!a.timeLabel) return;
      if (coveredSlotLabels[a.timeLabel]) return;
      const sk = parseMinutes(a.timeLabel);
      items.push({
        sortKey: sk != null ? sk : 99999,
        row: appointmentRowFromDoc(a),
      });
    });

    items.sort(function (a, b) {
      return a.sortKey - b.sortKey;
    });
    return items.map(function (x) {
      return x.row;
    });
  }

  window.NaReguaSchedule = {
    parseScheduleFromFirestore: parseScheduleFromFirestore,
    availableSlotLabels: availableSlotLabels,
    javaDayOfWeekFromDateKey: javaDayOfWeekFromDateKey,
    generateBaseSlotLabelsForDay: generateBaseSlotLabelsForDay,
    buildDayAgendaList: buildDayAgendaList,
  };
})();
