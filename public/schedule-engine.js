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

  window.NaReguaSchedule = {
    parseScheduleFromFirestore: parseScheduleFromFirestore,
    availableSlotLabels: availableSlotLabels,
    javaDayOfWeekFromDateKey: javaDayOfWeekFromDateKey,
  };
})();
