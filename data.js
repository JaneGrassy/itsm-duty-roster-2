/* ============================================================================
 * Мок-данные для страницы «График дежурств».
 * Спринты генерируются программно на весь 2026 год (2-недельные, встык),
 * с привязкой к сегодняшней дате так, чтобы текущий спринт стартовал
 * ровно 2026-07-13 (today) — как в примере ТЗ (SPRINT-00004 / SPRINT-00005).
 * ==========================================================================*/

(function () {
  "use strict";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function toISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fromISO(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(d, n) {
    var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
  }

  var TODAY_ISO = "2026-07-13";
  var today = fromISO(TODAY_ISO);

  // --- Спринты -------------------------------------------------------------
  // Находим старт спринта, совпадающий с today, затем идём назад так, чтобы
  // покрыть весь 2026 год, и вперёд до конца 2026 года.
  var jan1 = new Date(2026, 0, 1);
  var dec31 = new Date(2026, 11, 31);

  var firstStart = today;
  while (addDays(firstStart, -14) > jan1) firstStart = addDays(firstStart, -14);
  // ещё один шаг назад, чтобы гарантированно захватить 1 января
  while (firstStart > jan1) firstStart = addDays(firstStart, -14);

  var sprints = [];
  var cursor = firstStart;
  var n = 1;
  while (cursor <= dec31) {
    var start = cursor;
    var end = addDays(cursor, 13);
    var id = "SPRINT-" + String(n).padStart(5, "0");
    var sprint = { id: id, start: toISO(start), end: toISO(end) };
    if (toISO(start) === TODAY_ISO) sprint.current = true;
    sprints.push(sprint);
    cursor = addDays(cursor, 14);
    n++;
  }

  // --- Департаменты ------------------------------------------------------
  // «Поддержка» — ОДИН департамент, но внутри него 4 группы (МПК/ПСУ/Хумо/
  // Узкард — по одной на каждую продуктовую команду, делегирующую своего
  // человека на линию L2). Департамент без "groups" — обычный, целиком одна
  // колонка в графике; департамент с "groups" — рисуется отдельной колонкой
  // на каждую группу, с двухуровневой шапкой (см. Roster.buildColumns).
  var departments = [
    { id: "management", name: "Аппарат управления" },
    { id: "backend", name: "Backend" },
    {
      id: "support",
      name: "Поддержка",
      groups: [
        { id: "mpk", name: "МПК" },
        { id: "psu", name: "ПСУ" },
        { id: "humo", name: "Хумо" },
        { id: "uzcard", name: "Узкард" }
      ]
    }
  ];

  // --- Люди ----------------------------------------------------------------
  // По 2 человека на колонку (департамент или, для "Поддержки", группу
  // внутри неё). Дневная смена — обязательна везде. Ночная — дополнительно,
  // на части департаментов (Backend целиком, и группа "Узкард" внутри
  // Поддержки) — для примера, как это выглядит в UI. ФИО — условные.
  // Дежурят по очереди сменами разной длины (см. generateRotation ниже) —
  // ответственный (duty.lead) это тот, чья смена сейчас идёт, а не
  // постоянная роль персоны.
  var people = [
    { id: "p1", fullName: "Волкова А.С.", initials: "ВА", departmentId: "management" },
    { id: "p2", fullName: "Петров Д.И.", initials: "ПД", departmentId: "management" },

    // Backend: день — обязательно, ночь — дополнительно (пример).
    { id: "p5", fullName: "Морозов К.А.", initials: "МК", departmentId: "backend" },
    { id: "p6", fullName: "Лебедева Т.Н.", initials: "ЛТ", departmentId: "backend" },
    { id: "p7", fullName: "Захаров И.О.", initials: "ЗИ", departmentId: "backend" },
    { id: "p8", fullName: "Кузьмина В.Р.", initials: "КВ", departmentId: "backend" },

    // Поддержка / МПК
    { id: "p9", fullName: "Романов С.Д.", initials: "РС", departmentId: "support", groupId: "mpk" },
    { id: "p10", fullName: "Фомина А.П.", initials: "ФА", departmentId: "support", groupId: "mpk" },
    // Поддержка / ПСУ
    { id: "p11", fullName: "Беляев М.Т.", initials: "БМ", departmentId: "support", groupId: "psu" },
    { id: "p12", fullName: "Орлова Н.К.", initials: "ОН", departmentId: "support", groupId: "psu" },
    // Поддержка / Хумо
    { id: "p13", fullName: "Тарасов Е.В.", initials: "ТЕ", departmentId: "support", groupId: "humo" },
    { id: "p14", fullName: "Никитина Ю.Л.", initials: "НЮ", departmentId: "support", groupId: "humo" },
    // Поддержка / Узкард: день — обязательно, ночь — дополнительно (пример).
    { id: "p15", fullName: "Григорьев А.Н.", initials: "ГА", departmentId: "support", groupId: "uzcard" },
    { id: "p16", fullName: "Семенова О.И.", initials: "СО", departmentId: "support", groupId: "uzcard" },
    { id: "p17", fullName: "Абрамов Д.С.", initials: "АД", departmentId: "support", groupId: "uzcard" },
    { id: "p18", fullName: "Кузнецова Е.А.", initials: "КЕ", departmentId: "support", groupId: "uzcard" }
  ];

  // --- Дежурства ---------------------------------------------------------
  // Правило: в департаменте/группе одновременно дежурят ровно 2 человека
  // каждый день — но график НЕ синхронизирован по спринтам и не выглядит
  // табличным: у каждой колонки (department/group+shift) свой ритм длин
  // смены (STINT_LENGTHS по кругу) и свой фазовый сдвиг старта (seed), так
  // что передача дежурства у разных пар происходит в разные дни — как в
  // жизни, а не "все меняются 13-го". duty.lead — флаг конкретной смены
  // (кто сейчас основной), рисует золотое кольцо на карточке/аватаре, но
  // в сводке по спринту (Roster.renderSprintSummaryBody) не показывается:
  // агрегат "какая доля спринта человек был ответственным" лишний в сводке.
  var STINT_LENGTHS = [8, 13, 10, 6, 12, 9, 11, 7];

  var duties = [];

  function addDutyRange(personId, startISO, endISO, shift, lead) {
    var s = fromISO(startISO), e = fromISO(endISO);
    for (var d = s; d <= e; d = addDays(d, 1)) {
      duties.push({ personId: personId, date: toISO(d), shift: shift, lead: lead });
    }
  }

  // seed — просто индекс колонки: сдвигает и стартовую длину первого отрезка
  // (фаза), и точку входа в круг STINT_LENGTHS, чтобы колонки не совпадали.
  // ОБА члена пары присутствуют КАЖДЫЙ день диапазона (2 параллельные
  // дорожки, без пропусков) — меняется только то, у кого из них сейчас
  // "лид" (duty.lead), и граница этой смены не привязана к спринтам и
  // разная у каждой колонки — отсюда и разные даты типа "13–22" / "14–20".
  function generateRotation(members, shift, seed) {
    var rangeStart = fromISO(sprints[0].start);
    var rangeEnd = fromISO(sprints[sprints.length - 1].end);
    var phaseShift = (seed * 3) % 11; // 0..10 дней — укорачивает самый первый отрезок этой колонки
    var lenIdx = seed;
    var cursor = rangeStart;
    var firstIsLead = true;
    var isFirstSegment = true;

    while (cursor <= rangeEnd) {
      var len = STINT_LENGTHS[lenIdx % STINT_LENGTHS.length];
      if (isFirstSegment) { len = Math.max(3, len - phaseShift); isFirstSegment = false; }
      var segEnd = addDays(cursor, len - 1);
      if (segEnd > rangeEnd) segEnd = rangeEnd;
      var startISO = toISO(cursor), endISO = toISO(segEnd);
      addDutyRange(members[0], startISO, endISO, shift, firstIsLead);
      addDutyRange(members[1], startISO, endISO, shift, !firstIsLead);
      cursor = addDays(segEnd, 1);
      firstIsLead = !firstIsLead;
      lenIdx++;
    }
  }

  generateRotation(["p1", "p2"], "day", 0);     // Аппарат управления
  generateRotation(["p5", "p6"], "day", 1);     // Backend — день
  generateRotation(["p7", "p8"], "night", 2);   // Backend — ночь (доп.)
  generateRotation(["p9", "p10"], "day", 3);    // Поддержка / МПК
  generateRotation(["p11", "p12"], "day", 4);   // Поддержка / ПСУ
  generateRotation(["p13", "p14"], "day", 5);   // Поддержка / Хумо
  generateRotation(["p15", "p16"], "day", 6);   // Поддержка / Узкард — день
  generateRotation(["p17", "p18"], "night", 7); // Поддержка / Узкард — ночь (доп.)

  window.DATA = {
    today: TODAY_ISO,
    sprints: sprints,
    departments: departments,
    people: people,
    duties: duties
  };
})();
