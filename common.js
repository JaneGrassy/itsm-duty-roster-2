/* ============================================================================
 * Общая логика для variant-1.html и variant-2.html:
 *  - работа с датами
 *  - палитра аватаров (детерминированный хеш от person.id)
 *  - склейка duties -> spans (подряд идущие дни одного человека/смены)
 *  - разрез spans по границам спринтов
 *  - lane-раскладка перекрывающихся spans
 *  - построение DOM-карточки дежурства + hover-подсветка по человеку
 * ==========================================================================*/

var Roster = (function () {
  "use strict";

  // ---------------------------------------------------------------- dates --

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fromISO(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(iso, n) { return toISO(addDaysDate(fromISO(iso), n)); }
  function addDaysDate(d, n) {
    var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
  }
  function diffDaysISO(a, b) {
    return Math.round((fromISO(a) - fromISO(b)) / 86400000);
  }
  function maxISO(a, b) { return a > b ? a : b; }
  function minISO(a, b) { return a < b ? a : b; }
  function isWeekendISO(iso) {
    var wd = fromISO(iso).getDay();
    return wd === 0 || wd === 6;
  }
  function weekdayLetter(iso) {
    return ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"][fromISO(iso).getDay()];
  }
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  function monthShort(iso) { return MONTHS_SHORT[fromISO(iso).getMonth()]; }
  function monthFull(iso) { return MONTHS_FULL[fromISO(iso).getMonth()]; }
  function dayNum(iso) { return fromISO(iso).getDate(); }

  // "5–12 июля" / "28 июн – 3 июл" (короткая форма для карточек/тултипов)
  function formatRangeShort(startISO, endISO) {
    if (startISO === endISO) return dayNum(startISO) + " " + monthShort(startISO);
    var sameMonth = fromISO(startISO).getMonth() === fromISO(endISO).getMonth() &&
                     fromISO(startISO).getFullYear() === fromISO(endISO).getFullYear();
    if (sameMonth) return dayNum(startISO) + "–" + dayNum(endISO) + " " + monthShort(endISO);
    return dayNum(startISO) + " " + monthShort(startISO) + " – " + dayNum(endISO) + " " + monthShort(endISO);
  }
  // "5–12 июля" (родительный падеж, для aria-label / тултипов)
  function formatRangeFull(startISO, endISO) {
    if (startISO === endISO) return dayNum(startISO) + " " + monthFull(startISO);
    var sameMonth = fromISO(startISO).getMonth() === fromISO(endISO).getMonth();
    if (sameMonth) return dayNum(startISO) + "–" + dayNum(endISO) + " " + monthFull(endISO);
    return dayNum(startISO) + " " + monthFull(startISO) + " – " + dayNum(endISO) + " " + monthFull(endISO);
  }

  // ---------------------------------------------------------- avatar hash --

  var AVATAR_PALETTE = [
    { bg: "#F4EBFF", fg: "#6941C6" }, // violet
    { bg: "#EFF8FF", fg: "#175CD3" }, // blue
    { bg: "#E0FAFF", fg: "#0E7090" }, // cyan
    { bg: "#F0FDF9", fg: "#107569" }, // teal
    { bg: "#ECFDF3", fg: "#027A48" }, // success/green
    { bg: "#FFFAEB", fg: "#B54708" }, // warning
    { bg: "#FFF1F3", fg: "#C01048" }, // rose
    { bg: "#EEF4FF", fg: "#3538CD" }  // indigo
  ];
  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
  function colorIndexFor(personId) { return hashString(personId) % AVATAR_PALETTE.length; }
  function colorFor(personId) { return AVATAR_PALETTE[colorIndexFor(personId)]; }

  var SHIFT_LABELS = { day: "Дневное дежурство", night: "Ночное дежурство", weekend: "Дежурство в выходной" };
  var SHIFT_LABELS_SHORT = { day: "дневных", night: "ночных", weekend: "выходных" };
  // Длина смены в часах — условное допущение для мок-данных (нет отдельного
  // поля "часы" в duty), используется только для сводки по спринту.
  var SHIFT_HOURS = { day: 12, night: 12, weekend: 24 };

  // ---------------------------------------------------------- span build --

  /**
   * duties: [{personId, date, shift, lead}]
   * peopleById: {id -> person}
   * sprints: [{id, start, end}]
   * Возвращает spans, уже разрезанные по границам спринтов:
   * {personId, departmentId, shift, lead, start, end, sprintId}
   * lead входит в ключ группировки: у одного человека подряд идущие дни могут
   * смениться с "новичка" (lead:false) на "ответственного" (lead:true)
   * в середине его 14-дневного дежурства — это должно резать span на 2 части.
   */
  function buildSpans(duties, peopleById, sprints) {
    var groups = {};
    for (var i = 0; i < duties.length; i++) {
      var duty = duties[i];
      var person = peopleById[duty.personId];
      if (!person) continue;
      var key = person.id + "|" + duty.shift + "|" + (duty.lead ? "1" : "0");
      (groups[key] || (groups[key] = [])).push(duty.date);
    }

    var rawSpans = [];
    Object.keys(groups).forEach(function (key) {
      var dates = groups[key].slice().sort();
      var parts = key.split("|");
      var personId = parts[0], shift = parts[1], lead = parts[2] === "1";
      var departmentId = peopleById[personId].departmentId;
      var groupId = peopleById[personId].groupId || null;
      var start = dates[0], prev = dates[0];
      for (var i = 1; i < dates.length; i++) {
        if (diffDaysISO(dates[i], prev) > 1) {
          rawSpans.push({ personId: personId, departmentId: departmentId, groupId: groupId, shift: shift, lead: lead, start: start, end: prev });
          start = dates[i];
        }
        prev = dates[i];
      }
      rawSpans.push({ personId: personId, departmentId: departmentId, groupId: groupId, shift: shift, lead: lead, start: start, end: prev });
    });

    var spans = [];
    rawSpans.forEach(function (s) {
      sprints.forEach(function (sprint) {
        var cs = maxISO(s.start, sprint.start);
        var ce = minISO(s.end, sprint.end);
        if (cs <= ce) {
          spans.push({
            personId: s.personId,
            departmentId: s.departmentId,
            groupId: s.groupId,
            shift: s.shift,
            lead: s.lead,
            start: cs,
            end: ce,
            sprintId: sprint.id
          });
        }
      });
    });
    return spans;
  }

  /**
   * Разворачивает список департаментов в плоский список "колонок" грида:
   * департамент без groups — одна колонка на весь департамент; департамент
   * с groups — по одной колонке на каждую группу (группа обязана иметь хотя
   * бы одного человека, group.id должен совпадать с person.groupId).
   * Колонка: { key, deptId, deptName, groupId, groupName, isGrouped,
   *            deptColStart (индекс первой колонки этого dept'а),
   *            deptColSpan (сколько колонок у этого dept'а всего) }.
   * key — уникальный идентификатор колонки, groupId=null для целого dept'а.
   */
  function buildColumns(departments) {
    var columns = [];
    departments.forEach(function (dept) {
      var startIdx = columns.length;
      if (dept.groups && dept.groups.length) {
        dept.groups.forEach(function (group) {
          columns.push({
            key: dept.id + "::" + group.id,
            deptId: dept.id, deptName: dept.name,
            groupId: group.id, groupName: group.name,
            isGrouped: true
          });
        });
      } else {
        columns.push({
          key: dept.id,
          deptId: dept.id, deptName: dept.name,
          groupId: null, groupName: null,
          isGrouped: false
        });
      }
      var span = columns.length - startIdx;
      for (var i = startIdx; i < columns.length; i++) {
        columns[i].deptColStart = startIdx;
        columns[i].deptColSpan = span;
      }
    });
    return columns;
  }

  /** true, если span относится именно к этой колонке (dept, а для сгруппированных dept'ов — ещё и group). */
  function spanMatchesColumn(span, column) {
    if (span.departmentId !== column.deptId) return false;
    if (column.groupId === null) return true;
    return span.groupId === column.groupId;
  }

  // ---------------------------------------------------------- lane layout --

  /**
   * Жадная раскладка по дорожкам (как события одного дня в Google Calendar).
   * Мутирует каждый span, добавляя .lane (0-based). Возвращает кол-во дорожек.
   */
  function assignLanes(spans) {
    var sorted = spans.slice().sort(function (a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.end < b.end ? -1 : 1);
    });
    var laneEnds = [];
    sorted.forEach(function (span) {
      var placed = false;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] < span.start) {
          span.lane = i;
          laneEnds[i] = span.end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        span.lane = laneEnds.length;
        laneEnds.push(span.end);
      }
    });
    return laneEnds.length;
  }

  // ---------------------------------------------------------- aggregation --

  /**
   * Люди department'а dept, у которых есть хотя бы одно duty в [startISO, endISO].
   * Используется в агрегированных режимах "Квартал" (ячейка = неделя).
   * Каждый элемент — копия person с добавленным полем weekDays: сколько
   * дней из диапазона человек реально дежурил. Если меньше длины диапазона
   * (обычно 7 — неделя) — значит это не вся неделя, а часть смены (подмена/
   * передача дежурства), это used для пунктирного кольца на аватаре.
   */
  function peopleInRange(duties, peopleById, deptId, startISO, endISO, groupId) {
    var counts = {};
    var leadCounts = {};
    duties.forEach(function (d) {
      if (d.date < startISO || d.date > endISO) return;
      var p = peopleById[d.personId];
      if (!p || p.departmentId !== deptId) return;
      if (groupId && p.groupId !== groupId) return;
      counts[p.id] = (counts[p.id] || 0) + 1;
      if (d.lead) leadCounts[p.id] = (leadCounts[p.id] || 0) + 1;
    });
    var out = Object.keys(counts).map(function (id) {
      var copy = {};
      var p = peopleById[id];
      for (var k in p) copy[k] = p[k];
      copy.weekDays = counts[id];
      // Для недели (Квартал) lead не меняется внутри диапазона — там это
      // всегда "весь срок или ни дня". Для месяца (Год) внутри диапазона
      // могут быть и лид-, и не-лид-недели вперемешку — берём большинство,
      // иначе почти все за месяц оказались бы лидами хоть раз.
      copy.isLead = (leadCounts[id] || 0) > counts[id] / 2;
      return copy;
    });
    out.sort(function (a, b) { return a.fullName.localeCompare(b.fullName, "ru"); });
    return out;
  }

  /**
   * Количество человеко-дней дежурств department'а dept за календарный месяц.
   * Используется в агрегированном режиме "Год" (heat-ячейка).
   */
  function personDaysInMonth(duties, peopleById, deptId, year, month, groupId) {
    var count = 0;
    duties.forEach(function (d) {
      var p = peopleById[d.personId];
      if (!p || p.departmentId !== deptId) return;
      if (groupId && p.groupId !== groupId) return;
      var dt = fromISO(d.date);
      if (dt.getFullYear() === year && dt.getMonth() === month) count++;
    });
    return count;
  }

  /**
   * Сводка по спринту для каждого department'а: сколько человек, сколько
   * человеко-дней/человеко-часов по каждому типу смены, и список людей
   * с разбивкой по сменам (для разворачиваемого списка сотрудников).
   * Уважает уже отфильтрованный duties (по табу "Дневное/Ночное/Выходные").
   */
  function buildSprintSummary(duties, peopleById, departments, sprint) {
    return departments.map(function (dept) {
      var byPerson = {};
      var byShift = { day: 0, night: 0, weekend: 0 };

      duties.forEach(function (d) {
        if (d.date < sprint.start || d.date > sprint.end) return;
        var p = peopleById[d.personId];
        if (!p || p.departmentId !== dept.id) return;

        byShift[d.shift] = (byShift[d.shift] || 0) + 1;

        var entry = byPerson[p.id];
        if (!entry) {
          entry = byPerson[p.id] = { person: p, days: { day: 0, night: 0, weekend: 0 }, totalDays: 0 };
        }
        entry.days[d.shift] = (entry.days[d.shift] || 0) + 1;
        entry.totalDays++;
      });

      var employees = Object.keys(byPerson).map(function (id) { return byPerson[id]; });
      employees.sort(function (a, b) {
        return b.totalDays - a.totalDays || a.person.fullName.localeCompare(b.person.fullName, "ru");
      });

      var hours = {};
      var totalHours = 0;
      Object.keys(SHIFT_HOURS).forEach(function (shift) {
        hours[shift] = (byShift[shift] || 0) * SHIFT_HOURS[shift];
        totalHours += hours[shift];
      });

      return {
        dept: dept,
        peopleCount: employees.length,
        byShift: byShift,
        hours: hours,
        totalHours: totalHours,
        employees: employees
      };
    });
  }

  // ---------------------------------------------------------------- card --

  function moonIcon() {
    return '<svg class="dc-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 1 0 20.354 15.354z"/></svg>';
  }

  function leadBadgeIcon() {
    return '<svg class="lead-badge" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
      '<path d="M10 1.6l2.36 4.78 5.28.77-3.82 3.72.9 5.25L10 13.5l-4.72 2.62.9-5.25L2.36 7.15l5.28-.77z"/></svg>';
  }

  /**
   * Единый рендер аватара: инициалы + цвет по хешу id + бейдж лида (звезда).
   * Лидерство — не свойство человека, а конкретного дежурства (см. duty.lead
   * в data.js: один и тот же человек в одну неделю новичок, в другую — веду-
   * щий), поэтому isLead передаётся явным параметром, а не берётся с person.
   * partialDays (опционально) — сколько дней из недели человек реально
   * дежурил в агрегированной ячейке "Квартал"; если задано, рисуем пункти-
   * рное кольцо ("не вся неделя целиком" — подмена/передача смены) и добав-
   * ляем это в title.
   * Используется в карточках, today-панели и агрегатах.
   */
  function avatarHtml(person, sizeClass, extraAttrs, isLead, partialDays) {
    var color = colorFor(person.id);
    var leadTitle = isLead ? " (ответственный)" : "";
    var partialTitle = partialDays ? " · " + partialDays + " из 7 дней (не вся неделя)" : "";
    var badge = isLead ? leadBadgeIcon() : "";
    var partialClass = partialDays ? " is-partial" : "";
    return '<span class="avatar ' + sizeClass + (isLead ? " is-lead" : "") + partialClass + '"' +
      ' data-tooltip="' + escapeHtml(person.fullName + leadTitle + partialTitle) + '"' +
      ' style="background:' + color.bg + ';color:' + color.fg + '"' +
      (extraAttrs || "") + '>' + escapeHtml(person.initials) + badge + '</span>';
  }

  /**
   * Создаёт DOM-элемент карточки дежурства.
   * span: {personId, departmentId, shift, lead, start, end}
   * opts: { compact: bool, peopleById, departmentsById }
   */
  function renderCard(span, peopleById, departmentsById, opts) {
    opts = opts || {};
    var person = peopleById[span.personId];
    var dept = departmentsById[span.departmentId];
    var color = colorFor(person.id);
    var days = diffDaysISO(span.end, span.start) + 1;
    var compact = opts.compact !== undefined ? opts.compact : days < 3;
    var isLead = !!span.lead;

    var el = document.createElement("div");
    el.className = "duty-card shift-" + span.shift + (compact ? " compact" : "");
    el.style.setProperty("--card-color", color.fg);
    el.style.setProperty("--card-bg", color.bg);
    el.tabIndex = 0;
    el.dataset.personId = person.id;
    el.dataset.shift = span.shift;

    var rangeText = formatRangeShort(span.start, span.end);
    var rangeFull = formatRangeFull(span.start, span.end);
    var shiftLabel = SHIFT_LABELS[span.shift] || span.shift;
    var leadSuffix = isLead ? " · ответственный" : "";
    var title = person.fullName + leadSuffix + "\n" + shiftLabel + "\n" + rangeFull + "\n" + dept.name;
    el.dataset.tooltip = title;
    el.setAttribute("aria-label", person.fullName + leadSuffix + ", " + shiftLabel.toLowerCase() + ", " + rangeFull + ", " + dept.name);
    el.setAttribute("role", "button");

    var avatarEl = avatarHtml(person, "avatar-sm dc-avatar", ' aria-hidden="true"', isLead);
    var bodyHtml = '<span class="dc-body"><span class="dc-name">' + escapeHtml(person.fullName) + '</span><span class="dc-range">' + rangeText + '</span></span>';
    var moonHtml = span.shift === "night" ? moonIcon() : "";

    el.innerHTML = avatarEl + moonHtml + (compact ? "" : bodyHtml);
    return el;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ------------------------------------------------------- sprint summary --

  function pluralPeople(n) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "человек";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "человека";
    return "человек";
  }
  function pluralShift(n) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "смена";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "смены";
    return "смен";
  }

  /** Итоги по спринту поверх per-department строк buildSprintSummary. */
  function buildSprintTotals(summaryRows) {
    var totalPeople = 0, totalHours = 0;
    var byShift = { day: 0, night: 0, weekend: 0 };
    summaryRows.forEach(function (row) {
      totalPeople += row.peopleCount;
      totalHours += row.totalHours;
      Object.keys(byShift).forEach(function (s) { byShift[s] += row.byShift[s] || 0; });
    });
    return { totalPeople: totalPeople, totalHours: totalHours, byShift: byShift };
  }

  /**
   * Рендерит содержимое сводки по КОНКРЕТНОМУ спринту в container: общие
   * итоги (человек/смен/часов) сверху и по department'ам ниже — сколько
   * человек и человеко-часов по типу смены, разворачиваемый список
   * сотрудников. Используется внутри модалки (см. initSprintSummaryModal),
   * поэтому не содержит собственного верхнеуровневого сворачивания.
   */
  function renderSprintSummaryBody(container, visibleDepts, filteredDuties, peopleById, sprint) {
    if (!sprint) { container.innerHTML = ""; return; }
    var summary = buildSprintSummary(filteredDuties, peopleById, visibleDepts, sprint);
    var totals = buildSprintTotals(summary);

    var metaHtml = '<div class="ss-modal-meta">' +
      '<span class="ss-sprint-id">' + sprint.id + '</span>' +
      '<span class="ss-sprint-range">' + formatRangeFull(sprint.start, sprint.end) + '</span>' +
      (sprint.current ? '<span class="badge badge-success">Текущий</span>' : '') +
      '</div>';

    var shiftTotals = ["day", "night", "weekend"].map(function (shift) {
      if (!totals.byShift[shift]) return "";
      return totals.byShift[shift] + " " + SHIFT_LABELS_SHORT[shift] + " " + pluralShift(totals.byShift[shift]);
    }).filter(Boolean).join(" · ");

    var totalsHtml = '<div class="ss-totals">Всего: <strong>' + totals.totalPeople + ' ' + pluralPeople(totals.totalPeople) + '</strong>' +
      (shiftTotals ? ' · ' + shiftTotals : '') +
      ' · <strong>' + totals.totalHours + ' чел-ч</strong> за спринт</div>';

    var bodyHtml = summary.map(function (row) {
      var chips = ["day", "night", "weekend"].map(function (shift) {
        if (!row.byShift[shift]) return "";
        return '<span class="ss-stat ss-stat-' + shift + '">' + row.byShift[shift] + ' ' + SHIFT_LABELS_SHORT[shift] +
          ' · ' + row.hours[shift] + ' ч</span>';
      }).join("");

      // Лид намеренно не показываем в сводке: доля спринта "был ответственным"
      // — это свойство конкретного дежурства/карточки, а не осмысленный
      // агрегат за весь спринт (см. комментарий у LEAD_SPLIT_DAYS в data.js).
      var employeesHtml = row.employees.length ? row.employees.map(function (e) {
        var parts = ["day", "night", "weekend"].map(function (shift) {
          return e.days[shift] ? (e.days[shift] + " " + SHIFT_LABELS_SHORT[shift]) : "";
        }).filter(Boolean).join(" · ");
        return '<div class="ss-employee">' +
          avatarHtml(e.person, "avatar-sm", "", false) +
          '<span class="ss-employee-name">' + escapeHtml(e.person.fullName) + '</span>' +
          '<span class="ss-employee-meta">' + parts + '</span>' +
          '</div>';
      }).join("") : '<div class="ss-empty">Нет дежурств в этом спринте</div>';

      return '<div class="ss-dept" data-dept="' + row.dept.id + '">' +
        '<button type="button" class="ss-dept-toggle" aria-expanded="false">' +
        '<svg class="ss-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span class="ss-dept-name">' + escapeHtml(row.dept.name) + '</span>' +
        '<span class="ss-dept-count">' + row.peopleCount + ' ' + pluralPeople(row.peopleCount) + '</span>' +
        '<span class="ss-dept-chips">' + (chips || '<span class="ss-stat ss-stat-empty">нет дежурств</span>') + '</span>' +
        '</button>' +
        '<div class="ss-dept-employees" hidden>' + employeesHtml + '</div>' +
        '</div>';
    }).join("");

    container.innerHTML = metaHtml + totalsHtml + '<div class="ss-body">' + bodyHtml + '</div>';

    if (!container.dataset.ssWired) {
      container.dataset.ssWired = "1";
      container.addEventListener("click", function (e) {
        var deptToggle = e.target.closest(".ss-dept-toggle");
        if (deptToggle) {
          var exp = deptToggle.getAttribute("aria-expanded") === "true";
          deptToggle.setAttribute("aria-expanded", exp ? "false" : "true");
          var emp = deptToggle.parentElement.querySelector(".ss-dept-employees");
          if (emp) emp.hidden = exp;
        }
      });
    }
  }

  /**
   * Вешает делегированный клик на rootEl: любой элемент с data-sprint-id
   * внутри (заголовок спринта в режиме "Спринты"/"2 спринта", группа
   * спринта в "Квартал") открывает модалку со сводкой по этому спринту.
   * opts: { sprints, getContext: () => {visibleDepts, filteredDuties, peopleById} }
   */
  function initSprintSummaryModal(rootEl, opts) {
    var overlay = document.getElementById("summaryModalOverlay");
    var body = document.getElementById("summaryModalBody");
    var closeBtn = document.getElementById("summaryModalClose");
    if (!overlay || !body || !closeBtn) return;

    var lastFocused = null;

    function open(sprintId) {
      var sprint = opts.sprints.find(function (s) { return s.id === sprintId; });
      if (!sprint) return;
      var ctx = opts.getContext();
      renderSprintSummaryBody(body, ctx.visibleDepts, ctx.filteredDuties, ctx.peopleById, sprint);
      lastFocused = document.activeElement;
      overlay.hidden = false;
      closeBtn.focus();
    }
    function close() {
      overlay.hidden = true;
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    rootEl.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-sprint-id]");
      if (trigger) { open(trigger.dataset.sprintId); }
    });
    rootEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var trigger = e.target.closest("[data-sprint-id]");
      if (trigger) { e.preventDefault(); open(trigger.dataset.sprintId); }
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) close();
    });
  }

  // ------------------------------------------------------------ tooltip --

  /**
   * Кастомный тултип (взамен нативного title): один переиспользуемый DOM-
   * узел, показывается/позиционируется по наведению/фокусу на любой элемент
   * с атрибутом data-tooltip. Стилизован под Untitled UI (см. .rt-tooltip
   * в common.css), в отличие от нативного не зависит от ОС/браузера.
   */
  var tooltipEl = null;
  function ensureTooltipEl() {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "rt-tooltip";
      tooltipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function positionTooltip(el, target) {
    var r = target.getBoundingClientRect();
    var tw = el.offsetWidth, th = el.offsetHeight;
    var cx = r.left + r.width / 2;
    var top = r.top - th - 8;
    var placement = "top";
    if (top < 8) { top = r.bottom + 8; placement = "bottom"; }
    var left = cx - tw / 2;
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
    el.style.left = Math.round(left + window.scrollX) + "px";
    el.style.top = Math.round(top + window.scrollY) + "px";
    el.dataset.placement = placement;
    el.style.setProperty("--rt-arrow-left", Math.round(cx - left) + "px");
  }

  function showTooltip(target) {
    var text = target.getAttribute("data-tooltip");
    if (!text) return;
    var el = ensureTooltipEl();
    el.textContent = text;
    el.classList.add("is-visible");
    positionTooltip(el, target);
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove("is-visible");
  }

  /**
   * Вешает делегированные обработчики на rootEl: наведение/фокус на любой
   * потомок с data-tooltip показывает общий тултип рядом с этим элементом.
   * Достаточно вызвать один раз на корневой контейнер страницы.
   */
  function enableTooltips(rootEl) {
    rootEl.addEventListener("mouseover", function (e) {
      var t = e.target.closest("[data-tooltip]");
      if (t) showTooltip(t);
    });
    rootEl.addEventListener("mouseout", function (e) {
      var t = e.target.closest("[data-tooltip]");
      if (t && !t.contains(e.relatedTarget)) hideTooltip();
    });
    rootEl.addEventListener("focusin", function (e) {
      var t = e.target.closest("[data-tooltip]");
      if (t) showTooltip(t);
    });
    rootEl.addEventListener("focusout", function (e) {
      var t = e.target.closest("[data-tooltip]");
      if (t) hideTooltip();
    });
    rootEl.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
  }

  // ---------------------------------------------------------- highlight --

  /**
   * Вешает делегированную подсветку hover/focus по data-person-id на все
   * .duty-card внутри container.
   */
  function wireHighlight(container) {
    function setActive(personId) {
      var cards = container.querySelectorAll(".duty-card");
      cards.forEach(function (c) {
        if (!personId) {
          c.classList.remove("is-highlight", "is-dimmed");
        } else if (c.dataset.personId === personId) {
          c.classList.add("is-highlight");
          c.classList.remove("is-dimmed");
        } else {
          c.classList.add("is-dimmed");
          c.classList.remove("is-highlight");
        }
      });
    }
    container.addEventListener("mouseover", function (e) {
      var card = e.target.closest(".duty-card");
      if (card) setActive(card.dataset.personId);
    });
    container.addEventListener("mouseout", function (e) {
      var card = e.target.closest(".duty-card");
      if (card && !container.contains(e.relatedTarget)) setActive(null);
    });
    container.addEventListener("focusin", function (e) {
      var card = e.target.closest(".duty-card");
      if (card) setActive(card.dataset.personId);
    });
    container.addEventListener("focusout", function (e) {
      var card = e.target.closest(".duty-card");
      if (card) setActive(null);
    });
  }

  // -------------------------------------------------------------- public --

  return {
    toISO: toISO,
    fromISO: fromISO,
    addDays: addDays,
    addDaysDate: addDaysDate,
    diffDaysISO: diffDaysISO,
    isWeekendISO: isWeekendISO,
    weekdayLetter: weekdayLetter,
    monthShort: monthShort,
    monthFull: monthFull,
    dayNum: dayNum,
    formatRangeShort: formatRangeShort,
    formatRangeFull: formatRangeFull,
    avatarHtml: avatarHtml,
    peopleInRange: peopleInRange,
    personDaysInMonth: personDaysInMonth,
    buildColumns: buildColumns,
    spanMatchesColumn: spanMatchesColumn,
    buildSprintSummary: buildSprintSummary,
    buildSprintTotals: buildSprintTotals,
    renderSprintSummaryBody: renderSprintSummaryBody,
    initSprintSummaryModal: initSprintSummaryModal,
    enableTooltips: enableTooltips,
    colorFor: colorFor,
    colorIndexFor: colorIndexFor,
    AVATAR_PALETTE: AVATAR_PALETTE,
    SHIFT_LABELS: SHIFT_LABELS,
    buildSpans: buildSpans,
    assignLanes: assignLanes,
    renderCard: renderCard,
    wireHighlight: wireHighlight,
    escapeHtml: escapeHtml
  };
})();
