import { useState, useMemo, useRef } from "react";

/* =================== قرارداد‌ساز (ادغام‌شده در اپ) =================== */
const T = {
  ink: "#1b232c", ink2: "#48565f", panel: "#ffffff", line: "#d7dde0",
  steel: "#2f6f72", steelDk: "#255759", amber: "#b9772e", soft: "#f4f7f7", warn: "#9a3b2f",
};

const BLANK = "..............................";

const B = (v, ph = BLANK) => (v && String(v).trim() ? v : ph);

const JOBS = {
  operator_paint: {
    label: "اپراتور رنگ (رنگ‌کار / پیستوله‌کار)", title: "اپراتور رنگ (رنگ‌کار)", unit: "واحد رنگ / خط پوشش", skill: "skilled",
    duties: [
      "آماده‌سازی و تنظیم رنگ، آستر (پرایمر)، سیلر و کیلر مطابق نسبت‌های اعلامی و برگهٔ فنی رنگ رنر (Renner).",
      "پاشش رنگ پلی‌یورتان روی قطعات چوب و ام‌دی‌اف با پیستوله و تنظیم فشار/دبی هوا مطابق استاندارد.",
      "کنترل کیفیت لایه‌های پوشش (ضخامت، یکنواختی، عاری‌بودن از پرتقالی‌شدن و پاشش خشک) در هر گیت.",
      "رعایت مناطق سه‌گانهٔ آلودگی (کثیف/انتقال/تمیز) و بهداشت اتاق پاشش و آبشار خشک.",
      "ثبت اطلاعات فرآیندی روی پاسپورت دیجیتال (NFC) قطعه و کنترل گردش ترولی.",
      "استفادهٔ صحیح از ماسک تنفسی، دستکش و تجهیزات حفاظت فردی و رعایت الزامات HSE.",
    ],
  },
  sanding: {
    label: "متصدی زیرسازی و سنباده‌کاری", title: "متصدی زیرسازی و سنباده", unit: "اتاق سنباده / زیرکاری", skill: "skilled",
    duties: [
      "سنباده‌زنی و زیرسازی سطوح چوب و ام‌دی‌اف پیش و پس از آستر مطابق دستورالعمل هر مرحله.",
      "کار با میز سنباده مکنده‌دار (Downdraft) و رعایت روشن‌بودن سیستم مکش هنگام کار.",
      "کنترل صافی و آماده‌بودن سطح در گیت QC1 پیش از انتقال به واحد آستر/رنگ.",
      "پاک‌سازی گرد و غبار سطح با روش صحیح پیش از تحویل قطعه.",
      "ثبت وضعیت قطعه روی پاسپورت NFC و تحویل با ترولی به ایستگاه بعد.",
      "رعایت کامل الزامات ایمنی، ماسک ضدگردوغبار و بهداشت محیط کار.",
    ],
  },
  qc: {
    label: "متصدی کنترل کیفیت (QC)", title: "متصدی کنترل کیفیت فرآیند", unit: "واحد تضمین کیفیت", skill: "skilled",
    duties: [
      "اجرای بازرسی در چهار گیت رسمی: گیت ورودی، QC1 پیش از آستر، QC2 پیش از کیلر و QC3 نهایی.",
      "تکمیل فرم‌های کنترل کیفیت و ثبت عیوب (پرتقالی‌شدن، شره، حباب، گردوغبار، اختلاف رنگ).",
      "صدور مجوز عبور یا ارجاع قطعه به فرآیند دوباره‌کاری با ثبت علت.",
      "پایش رطوبت هوای فشرده و شرایط محیطی اتاق خشک‌کن و اعلام مغایرت.",
      "به‌روزرسانی وضعیت کیفی روی پاسپورت دیجیتال قطعه و گزارش نرخ دوباره‌کاری.",
      "همکاری در ریشه‌یابی عیوب تکرارشونده و پیشنهاد اقدام اصلاحی.",
    ],
  },
  warehouse: {
    label: "انباردار و تدارکات", title: "انباردار و متصدی تدارکات", unit: "انبار و تدارکات", skill: "skilled",
    duties: [
      "تحویل، شمارش و ثبت ورود/خروج مواد اولیه، رنگ، حلال و قطعات در فرم‌های انبار.",
      "کنترل موجودی، نقطهٔ سفارش و انقضای رنگ و مواد شیمیایی و اعلام کسری به‌موقع.",
      "نگهداری اصولی مواد قابل‌اشتعال مطابق الزامات ایمنی و HSE.",
      "تطبیق اسناد خرید با کالای دریافتی و همکاری در کنترل هزینه.",
      "مدیریت گردش قطعات نیمه‌ساخته و آماده در انبار میان‌مرحله‌ای.",
      "ثبت داده‌ها در سامانه و ارائهٔ گزارش موجودی دوره‌ای.",
    ],
  },
  simple: {
    label: "کارگر ساده تولید", title: "کارگر تولید", unit: "خط تولید / پوشش", skill: "simple",
    duties: [
      "جابه‌جایی قطعات و بارگیری/تخلیهٔ ترولی‌ها میان ایستگاه‌های کاری.",
      "کمک به اپراتورها در آماده‌سازی سطح، ماسکه‌کاری و پاک‌سازی قطعات.",
      "نظافت مستمر محیط کار، اتاق پاشش و منطقهٔ خشک‌کن.",
      "کمک در بارگیری، بسته‌بندی و آماده‌سازی سفارش‌های خروجی.",
      "رعایت کامل نظم کارگاه، ایمنی و استفاده از تجهیزات حفاظت فردی.",
      "انجام سایر امور محوله در محدودهٔ وظایف شغلی توسط سرپرست.",
    ],
  },
  packing: {
    label: "متصدی بسته‌بندی و ارسال", title: "متصدی بسته‌بندی و ارسال", unit: "بسته‌بندی و ارسال", skill: "simple",
    duties: [
      "بازرسی ظاهری نهایی قطعه پس از گیت QC3 پیش از بسته‌بندی.",
      "بسته‌بندی استاندارد قطعات رنگ‌شده برای جلوگیری از آسیب سطح پوشش.",
      "تطبیق قطعات با سفارش، تکمیل فرم بسته‌بندی و برگهٔ ارسال.",
      "بارگیری ایمن و هماهنگی تحویل با واحد حمل.",
      "ثبت خروج قطعه از پاسپورت دیجیتال و بستن پروندهٔ پروژه.",
      "رعایت ایمنی جابه‌جایی و نظافت محیط.",
    ],
  },
  supervisor: {
    label: "سرپرست خط تولید", title: "سرپرست خط تولید و پوشش", unit: "سرپرستی تولید", skill: "skilled",
    duties: [
      "برنامه‌ریزی، تخصیص کار و کنترل گردش پروژه‌ها و ترولی‌ها در ۱۶ مرحلهٔ تولید.",
      "پایش ظرفیت خط، شناسایی گلوگاه (به‌ویژه اتاق خشک‌کن ثانویه) و مدیریت زمان.",
      "نظارت بر اجرای گیت‌های کنترل کیفیت و کاهش نرخ دوباره‌کاری.",
      "مدیریت و آموزش نیروهای تحت سرپرستی و رعایت انضباط کارگاه.",
      "کنترل مصرف رنگ و مواد، همکاری با انبار و واحد مالی در کنترل هزینه.",
      "ارائهٔ گزارش کار روزانه، تحلیل عملکرد و پیشنهاد بهبود فرآیند.",
    ],
  },
  trainee: {
    label: "کمک‌رنگ‌کار / نیروی کارآموز", title: "کارآموز پوشش (کمک‌اپراتور)", unit: "خط پوشش", skill: "simple",
    duties: [
      "آموزش عملی مراحل زیرسازی، آستر و پاشش زیر نظر اپراتور ارشد.",
      "کمک در آماده‌سازی رنگ، ماسکه‌کاری و پاک‌سازی قطعات.",
      "آشنایی با مناطق سه‌گانهٔ آلودگی و اصول ایمنی کار با رنگ.",
      "مشارکت در نظافت و نگهداری ایستگاه کاری.",
      "ثبت اطلاعات پایه در سامانه زیر نظر مربی.",
      "رعایت کامل الزامات ایمنی و استفاده از تجهیزات حفاظت فردی.",
    ],
  },
};

const LEGAL = {
  overtime: "۴۰٪", nightShift: "۳۵٪", holiday: "۴۰٪",
  shift_am_pm: "۱۰٪", shift_am_pm_night: "۱۵٪", shift_am_night: "۲۲٫۵٪",
};

function buildEmployment(s) {
  const skillLabel = s.skill === "skilled" ? "ماهر/دارای تخصص (سقف مجاز دورهٔ آزمایشی: ۳ ماه)" : "ساده/نیمه‌ماهر (سقف مجاز دورهٔ آزمایشی: ۱ ماه)";
  const sec = [];
  sec.push({ type: "h1", text: "قرارداد کار" });
  sec.push({ type: "sub", text: "تنظیم‌شده بر مبنای قانون کار جمهوری اسلامی ایران و مقررات وزارت تعاون، کار و رفاه اجتماعی" });
  sec.push({ type: "para", text: `این قرارداد کار در تاریخ ${B(s.contractDate)} فی‌مابین طرفین ذیل، با استناد به مواد ۷، ۱۰، ۲۱ و ۲۵ قانون کار و آیین‌نامه‌های اجرایی مربوطه، با ارادهٔ آزاد و آگاهی کامل از مفاد و آثار حقوقی آن منعقد گردید و طرفین خود را ملزم به رعایت کلیهٔ شروط آن می‌دانند.` });
  sec.push({ type: "h2", text: "ماده ۱: طرفین قرارداد" });
  sec.push({ type: "c", text: `۱-۱ کارفرما: ${B(s.coName)}${s.coBrand ? " («" + s.coBrand + "»)" : ""} به شناسهٔ ملی ${B(s.coNationalId)} و شمارهٔ ثبت ${B(s.coRegNo)}، دارای کد اقتصادی ${B(s.coEcoCode)} و شناسهٔ کارگاهی ${B(s.coWorkshopId)} نزد سازمان تأمین اجتماعی، با نمایندگی ${B(s.coRepName)} به سمت ${B(s.coRepRole)}، به نشانی ${B(s.coAddress)}، کدپستی ${B(s.coPostal)}، تلفن ${B(s.coPhone)} و ایمیل ${B(s.coEmail)}؛ که از این پس «کارفرما» نامیده می‌شود.` });
  sec.push({ type: "c", text: `۱-۲ کارگر: ${B(s.wName)} فرزند ${B(s.wFather)} به شمارهٔ شناسنامه ${B(s.wIdNo)} و کد ملی ${B(s.wNationalId)} صادره از ${B(s.wIssue)}، متولد ${B(s.wBirth)}، دارای مدرک ${B(s.wDegree)} در رشتهٔ ${B(s.wField)} با ${B(s.wExp)} سابقهٔ کار مرتبط، به نشانی ${B(s.wAddress)}، کدپستی ${B(s.wPostal)}، تلفن همراه ${B(s.wMobile)} و ایمیل ${B(s.wEmail)}؛ که از این پس «کارگر» نامیده می‌شود.` });
  sec.push({ type: "h2", text: "ماده ۲: موضوع قرارداد و شرح وظایف" });
  sec.push({ type: "c", text: `۲-۱ موضوع قرارداد، اشتغال کارگر در سمت «${B(s.jobTitle)}»${s.jobCode ? " با کد شغلی " + s.jobCode : ""} در واحد ${B(s.unit)} تحت سرپرستی مستقیم ${B(s.supervisor, "سرپرست مربوطه")} است.` });
  sec.push({ type: "c", text: "۲-۲ شرح کلی وظایف و مسئولیت‌های کارگر:" });
  (s.duties || []).forEach((d) => sec.push({ type: "li", text: d }));
  sec.push({ type: "c", text: "و سایر اموری که در محدودهٔ وظایف شغلی کارگر بوده و از سوی مقام مافوق محول می‌گردد." });
  sec.push({ type: "c", text: "۲-۳ کارگر متعهد است وظایف محوله را با دقت، امانت‌داری و مطابق استانداردهای فنی و ایمنی مربوطه انجام دهد." });
  sec.push({ type: "h2", text: "ماده ۳: نوع و مدت قرارداد" });
  sec.push({ type: "c", text: `۳-۱ نوع قرارداد: ${B(s.contractKind)}.` });
  sec.push({ type: "c", text: `۳-۲ مدت قرارداد از ${B(s.startDate)} تا ${B(s.endDate)} به مدت ${B(s.duration)} است.` });
  sec.push({ type: "c", text: `۳-۳ دورهٔ آزمایشی: ${B(s.probation)}. نوع شغل: ${skillLabel}. در طول دورهٔ آزمایشی هر یک از طرفین می‌تواند بدون اخطار قبلی، رابطهٔ کاری را قطع کند؛ چنانچه قطع از سوی کارفرما باشد، حقوق تمام دورهٔ آزمایشی به کارگر پرداخت می‌شود (مادهٔ ۱۱ قانون کار).` });
  sec.push({ type: "c", text: `۳-۴ تمدید قرارداد منوط به توافق کتبی طرفین است و حداقل ${B(s.noticeDays, "۳۰")} روز پیش از انقضا اعلام می‌گردد.` });
  sec.push({ type: "note", text: "توجه حقوقی: چنانچه طبیعت کار مستمر باشد، مطابق تبصرهٔ ۲ مادهٔ ۷ قانون کار، ماهیت رابطه ممکن است دائمی تلقی شود؛ تبدیل قرارداد به دائم تابع «ماهیت کار» است، نه صرفِ تعداد دفعات تمدید." });
  sec.push({ type: "h2", text: "ماده ۴: محل انجام کار" });
  sec.push({ type: "c", text: `۴-۱ محل انجام کار: ${B(s.workPlace)} (شهر ${B(s.city, "اصفهان")}).` });
  sec.push({ type: "c", text: "۴-۲ کارفرما می‌تواند در صورت ضرورت محل کار را در همان شهر و با حفظ شأن شغلی کارگر تغییر دهد، مشروط بر اینکه موجب عسر و حرج نگردد. تغییر به شهر دیگر منوط به توافق کتبی است." });
  sec.push({ type: "h2", text: "ماده ۵: ساعات و ایام کار" });
  sec.push({ type: "c", text: `۵-۱ ساعات کار از ${B(s.workStart)} تا ${B(s.workEnd)} در روزهای ${B(s.workDays)}، مجموعاً ${B(s.weeklyHours)} ساعت در هفته (مطابق مادهٔ ۵۱ قانون کار، حداکثر ۴۴ ساعت).` });
  sec.push({ type: "c", text: `۵-۲ اضافه‌کاری با درخواست کتبی کارفرما و موافقت کارگر و با ${LEGAL.overtime} اضافه بر مزد ساعتی (مادهٔ ۵۹) و حداکثر ۴ ساعت در روز محاسبه می‌شود.` });
  sec.push({ type: "c", text: `۵-۳ فوق‌العادهٔ نوبت‌کاری (مادهٔ ۵۶): نوبت صبح و عصر ${LEGAL.shift_am_pm}؛ نوبت صبح، عصر و شب ${LEGAL.shift_am_pm_night}؛ نوبت صبح و شب یا عصر و شب ${LEGAL.shift_am_night} اضافه بر مزد.` });
  sec.push({ type: "c", text: `۵-۴ کار شب (۲۲ تا ۶ بامداد) ${LEGAL.nightShift} و کار در تعطیلات رسمی ${LEGAL.holiday} اضافه بر مزد ساعتی خواهد داشت.` });
  sec.push({ type: "c", text: "۵-۵ کارگر موظف به ثبت ورود و خروج در سامانهٔ حضور و غیاب است؛ عدم ثبت بدون عذر موجه، غیبت تلقی می‌گردد." });
  sec.push({ type: "h2", text: "ماده ۶: حقوق و مزایا" });
  sec.push({ type: "c", text: `۶-۱ حقوق پایهٔ ماهانه: ${B(s.baseSalary)} ریال (کمتر از حداقل مزد مصوب شورای عالی کار نخواهد بود).` });
  sec.push({ type: "c", text: `۶-۲ حق مسکن: ${B(s.housing)} ریال در ماه.` });
  sec.push({ type: "c", text: `۶-۳ کمک‌هزینهٔ اقلام مصرفی (بن خواروبار): ${B(s.food)} ریال در ماه.` });
  sec.push({ type: "c", text: `۶-۴ کمک‌هزینهٔ ایاب و ذهاب: ${B(s.transport)} ریال در ماه.` });
  sec.push({ type: "c", text: "۶-۵ حق اولاد مطابق مقررات جاری (سه برابر حداقل مزد روزانه به ازای هر فرزند مشمول) پرداخت می‌شود." });
  sec.push({ type: "c", text: "۶-۶ عیدی و پاداش سالانه معادل ۶۰ روز آخرین مزد، مشروط بر آنکه از دو برابر حداقل مزد ماهانه کمتر و از سه برابر آن بیشتر نباشد." });
  sec.push({ type: "c", text: "۶-۷ حق سنوات/مزایای پایان کار به ازای هر سال سابقه معادل یک ماه آخرین مزد (شامل مزد و مزایای مستمر) مطابق مادهٔ ۲۴ محاسبه و پرداخت می‌گردد." });
  sec.push({ type: "c", text: "۶-۸ کارفرما مکلف است کارگر را از روز نخست نزد سازمان تأمین اجتماعی بیمه کند و حق بیمه را مطابق قانون بپردازد." });
  sec.push({ type: "note", text: "توجه: مبالغ حق مسکن، بن و حداقل مزد باید مطابق آخرین مصوبهٔ شورای عالی کار در سال جاری تکمیل شود و از مصوبهٔ قانونی کمتر نباشد." });
  sec.push({ type: "h2", text: "ماده ۷: مرخصی‌ها و تعطیلات" });
  sec.push({ type: "c", text: `۷-۱ مرخصی استحقاقی سالانه یک ماه (${B(s.leaveDays, "۲۶")} روز کاری با احتساب جمعه‌ها) با استفاده از حقوق و مزایا؛ ماندهٔ مرخصی به سال بعد منتقل می‌شود (مادهٔ ۶۴).` });
  sec.push({ type: "c", text: "۷-۲ مرخصی استعلاجی با گواهی پزشک؛ بیش از سه روز متوالی، منوط به تأیید پزشک معتمد تأمین اجتماعی و پرداخت مطابق مقررات آن سازمان." });
  sec.push({ type: "c", text: "۷-۳ مرخصی‌های خاص: ازدواج ۳ روز، فوت بستگان درجهٔ یک ۳ روز، زایمان بانوان ۹ ماه و شیردهی روزانه یک ساعت تا ۲۴ماهگی فرزند." });
  sec.push({ type: "c", text: "۷-۴ کارگر از کلیهٔ تعطیلات رسمی با استفاده از حقوق و مزایا برخوردار است." });
  sec.push({ type: "h2", text: "ماده ۸: ایمنی، بهداشت و آموزش (HSE)" });
  sec.push({ type: "c", text: "۸-۱ کارگر ملزم به رعایت اصول ایمنی و بهداشت کار و استفاده از تجهیزات حفاظت فردی (ماسک تنفسی، دستکش، عینک) به‌ویژه در کار با رنگ، حلال و مواد پلی‌یورتان است." });
  sec.push({ type: "c", text: "۸-۲ کارفرما موظف است محیط ایمن و بهداشتی، تهویهٔ مناسب اتاق پاشش و تجهیزات حفاظتی لازم را فراهم و آموزش‌های ایمنی و تخصصی را ارائه کند." });
  sec.push({ type: "c", text: "۸-۳ در صورت بروز حادثهٔ ناشی از کار، کارفرما موظف است مراتب را فوراً به تأمین اجتماعی اطلاع و مساعدت‌های لازم را انجام دهد." });
  sec.push({ type: "h2", text: "ماده ۹: ارزیابی عملکرد" });
  sec.push({ type: "c", text: `۹-۱ عملکرد کارگر به‌صورت ${B(s.evalPeriod, "دوره‌ای")} ارزیابی و نتایج مبنای پاداش، ارتقا و افزایش حقوق قرار می‌گیرد.` });
  sec.push({ type: "c", text: "۹-۲ نتایج ارزیابی به اطلاع کارگر می‌رسد و کارگر حق اعتراض به آن را دارد." });
  sec.push({ type: "h2", text: "ماده ۱۰: تعهدات کارگر" });
  sec.push({ type: "c", text: "۱۰-۱ انجام وظایف با رعایت سلسله‌مراتب و آیین‌نامه‌های داخلی؛ ۱۰-۲ حضور به‌موقع و خودداری از ترک محل کار بدون اذن؛ غیبت غیرموجه موجب کسر حقوق روزانه به‌نسبت است." });
  sec.push({ type: "c", text: "۱۰-۳ حفظ و نگهداری اموال، اسناد و تجهیزات کارفرما؛ در صورت خسارت ناشی از تقصیر یا تعدی و تفریط، کارگر ملزم به جبران است." });
  sec.push({ type: "c", text: `۱۰-۴ رازداری: کارگر متعهد است اطلاعات محرمانهٔ کارفرما (فرمول رنگ، مشتریان، اطلاعات مالی و فرآیندی) را افشا نکند؛ این تعهد تا ${B(s.confYears, "دو")} سال پس از خاتمهٔ قرارداد معتبر است.` });
  sec.push({ type: "c", text: "۱۰-۵ اطلاع فوری هرگونه تغییر نشانی/تماس و رعایت شئونات و پوشش متناسب با محیط کار." });
  sec.push({ type: "h2", text: "ماده ۱۱: تعهدات کارفرما" });
  sec.push({ type: "c", text: "۱۱-۱ پرداخت به‌موقع حقوق و مزایا در پایان هر ماه؛ ۱۱-۲ فراهم‌کردن ابزار و تجهیزات لازم و محیط ایمن؛ ۱۱-۳ بیمهٔ کارگر و ارسال لیست بیمه و مالیات در موعد مقرر." });
  sec.push({ type: "c", text: "۱۱-۴ ارائهٔ گواهی اشتغال در پایان قرارداد و تسویهٔ مرخصی‌های استفاده‌نشده بر اساس آخرین حقوق و مزایا." });
  sec.push({ type: "h2", text: "ماده ۱۲: مالکیت فکری" });
  sec.push({ type: "c", text: "۱۲-۱ هر ابتکار، اختراع یا بهبود فرآیندی که کارگر در راستای وظایف شغلی و با استفاده از امکانات کارفرما پدید آورد، متعلق به کارفرماست و نام کارگر به‌عنوان پدیدآورنده در اسناد مربوط درج می‌شود." });
  sec.push({ type: "c", text: "۱۲-۲ چنانچه ابتکار خارج از وظایف شغلی و بدون استفاده از امکانات کارفرما ایجاد شده باشد، حقوق مادی آن متعلق به کارگر است." });
  sec.push({ type: "h2", text: "ماده ۱۳: شرایط فسخ قرارداد" });
  sec.push({ type: "c", text: "۱۳-۱ موارد خاتمهٔ قرارداد مطابق مادهٔ ۲۱ قانون کار: توافق کتبی طرفین، فوت یا ازکارافتادگی کلی، انقضای مدت، استعفا و بازنشستگی کارگر." });
  sec.push({ type: "c", text: "۱۳-۲ کارفرما تنها در موارد مادهٔ ۲۷ قانون کار (قصور در انجام وظایف پس از دو تذکر کتبی و تأیید شورای اسلامی کار/انجمن صنفی یا مراجع حل اختلاف) می‌تواند قرارداد را فسخ کند." });
  sec.push({ type: "c", text: `۱۳-۳ استعفای کارگر با اعلام کتبی و رعایت مهلت ${B(s.resignNotice, "۱۵")} روز و تسویهٔ اموال و اسناد در اختیار، قطعی می‌شود.` });
  sec.push({ type: "c", text: "۱۳-۴ کارفرما موظف است پس از خاتمه، ظرف مهلت قانونی نسبت به تسویهٔ کامل با کارگر اقدام کند." });
  sec.push({ type: "h2", text: "ماده ۱۴: حل اختلاف و قانون حاکم" });
  sec.push({ type: "c", text: "۱۴-۱ اختلافات ابتدا از طریق مذاکره و در صورت عدم توافق، از طریق هیأت‌های تشخیص و حل اختلاف موضوع قانون کار پیگیری می‌شود." });
  sec.push({ type: "c", text: "۱۴-۲ این قرارداد تابع قانون کار مصوب ۱۳۶۹ و اصلاحات آن، قانون تأمین اجتماعی و مقررات مرتبط است؛ در موارد سکوت، مقررات آمرهٔ قانون کار حاکم است." });
  sec.push({ type: "h2", text: "ماده ۱۵: مفاد پایانی" });
  sec.push({ type: "c", text: `۱۵-۱ این قرارداد در ${B(s.copies, "۲")} نسخهٔ دارای اعتبار یکسان و پیوست‌های آن جزء لاینفک قرارداد تنظیم شد. هرگونه اصلاح صرفاً با توافق کتبی طرفین ممکن است.` });
  return sec;
}

function buildCommission(s) {
  const sec = [];
  sec.push({ type: "h1", text: "قرارداد همکاری بازاریابی و جذب مشتری (پورسانتی)" });
  sec.push({ type: "sub", text: "این قرارداد یک قرارداد تجاری مستقل است و رابطهٔ کارگری/کارفرمایی مشمول قانون کار ایجاد نمی‌کند." });
  sec.push({ type: "para", text: `این قرارداد در تاریخ ${B(s.contractDate)} فی‌مابین ${B(s.coName)}${s.coBrand ? " («" + s.coBrand + "»)" : ""} به نمایندگی ${B(s.coRepName)} («کارفرما») و ${B(s.wName)} به کد ملی ${B(s.wNationalId)} («بازاریاب») با اقرار به اهلیت قانونی منعقد گردید.` });
  sec.push({ type: "h2", text: "ماده ۱: تعاریف" });
  sec.push({ type: "c", text: "مشتری: شخص معرفی‌شده توسط بازاریاب. مشتری مؤثر: مشتری‌ای که حداقل ۳۰٪ مبلغ قرارداد را پرداخت کرده و ظرف ۱۵ روز انصراف نداده باشد. لید: اطلاعات اولیهٔ مشتری بالقوه. فروش خالص: مبلغ فاکتور پس از کسر مالیات، عوارض و تخفیف. حق دنباله: پورسانت خریدهای بعدی مشتری معرفی‌شده." });
  sec.push({ type: "h2", text: "ماده ۲: موضوع و محدوده" });
  sec.push({ type: "c", text: `۲-۱ بازاریابی، معرفی و جذب مشتری برای محصولات و خدمات کارفرما (پوشش پلی‌یورتان چوب و ام‌دی‌اف و رنگ رنر) با رعایت قوانین جاری.` });
  sec.push({ type: "c", text: `۲-۲ محدودهٔ جغرافیایی فعالیت: ${B(s.territory)}. فهرست محصولات و نرخ‌ها در پیوست ۱.` });
  sec.push({ type: "h2", text: "ماده ۳: استقلال رابطه (مهم)" });
  sec.push({ type: "c", text: "۳-۱ بازاریاب به‌صورت مستقل و بدون تابعیت حقوقی و ساعت کاری معیّن فعالیت می‌کند؛ ابزار، مکان و روش کار در اختیار خود اوست و کارفرما حق مدیریت و نظارت مستمر بر نحوهٔ انجام کار را ندارد." });
  sec.push({ type: "c", text: "۳-۲ کارفرما تعهدی به بیمه، حقوق ثابت یا مزایای کارمندی ندارد و مسئولیت مالیات و بیمهٔ بازاریاب بر عهدهٔ خود اوست." });
  sec.push({ type: "note", text: "توجه حقوقی: برای پرهیز از تشخیص «رابطهٔ کارگری» توسط اداره کار/تأمین اجتماعی، از تعیین ساعت حضور اجباری، حقوق ثابت ماهانه و نظارت مستمر بر بازاریاب خودداری کنید. پرداخت باید صرفاً پورسانتی و نتیجه‌محور باشد." });
  sec.push({ type: "h2", text: "ماده ۴: تعهدات بازاریاب" });
  sec.push({ type: "c", text: "معرفی صحیح و بدون اغراق محصولات؛ رعایت اخلاق حرفه‌ای؛ ثبت مشتری در فرم استاندارد (پیوست ۲)؛ ارائهٔ گزارش دوره‌ای عملکرد (تعداد لید، جلسات، نرخ تبدیل)." });
  sec.push({ type: "c", text: "ممنوعیت‌ها: دریافت مستقیم وجه از مشتری؛ انعقاد قرارداد به نمایندگی کارفرما؛ ارائهٔ تضمین یا تخفیف بدون مجوز کتبی؛ ثبت دامنه یا صفحهٔ مجازی با نام کارفرما." });
  sec.push({ type: "h2", text: "ماده ۵: تعهدات کارفرما" });
  sec.push({ type: "c", text: "تأمین کاتالوگ، اطلاعات فنی و قیمت؛ پاسخ به استعلام فنی ظرف ۲۴ ساعت کاری؛ صدور معرفی‌نامهٔ رسمی با ذکر حدود اختیارات؛ اطلاع تغییر قیمت حداقل ۱۰ روز پیش از اجرا." });
  sec.push({ type: "h2", text: "ماده ۶: نظام پورسانت" });
  sec.push({ type: "c", text: `۶-۱ نرخ پورسانت پایه بر مبنای فروش خالص: ${B(s.commissionTable, "طبق جدول پیوست ۱")}.` });
  sec.push({ type: "c", text: "۶-۲ حق دنباله: خرید مجدد تا ۶ ماه ۵۰٪ پورسانت اصلی؛ ۶ تا ۱۲ ماه ۳۰٪؛ پس از ۱۲ ماه بدون پورسانت." });
  sec.push({ type: "c", text: "۶-۳ زمان‌بندی پرداخت: ۵۰٪ پورسانت پس از دریافت پیش‌پرداخت مشتری و ۵۰٪ باقی پس از تسویهٔ کامل، هر یک ظرف ۷ روز کاری، پس از ارائهٔ مستندات (کپی قرارداد مشتری، تأییدیهٔ واحد فروش، رسید وجه)." });
  sec.push({ type: "c", text: "۶-۴ کسورات قانونی (مالیات) اعمال و گواهی پرداخت جهت امور مالیاتی صادر می‌شود." });
  sec.push({ type: "h2", text: "ماده ۷: محرمانگی" });
  sec.push({ type: "c", text: `اطلاعات محرمانه شامل فهرست مشتریان، استراتژی فروش، اسرار فنی و اطلاعات مالی است. این تعهد تا ۳ سال پس از خاتمه معتبر است؛ نقض آن موجب پرداخت ${B(s.penalty)} ریال خسارت مقطوع می‌گردد.` });
  sec.push({ type: "h2", text: "ماده ۸: تضامین" });
  sec.push({ type: "c", text: `بازاریاب یک فقره ${B(s.security, "چک/سفته")} به مبلغ ${B(s.securityAmount)} ریال به‌عنوان تضمین حسن انجام تعهدات ارائه می‌کند که پس از تسویهٔ کامل و رفع تعهدات مسترد می‌شود.` });
  sec.push({ type: "note", text: "توجه: در اخذ چک/سفتهٔ تضمینی، مطابق قانون صدور چک، بابت آن را «تضمین حسن انجام تعهد» قید کنید تا از ابهام حقوقی جلوگیری شود." });
  sec.push({ type: "h2", text: "ماده ۹: فسخ قرارداد" });
  sec.push({ type: "c", text: `۹-۱ هر یک از طرفین با اعلام کتبی و مهلت ${B(s.terminationNotice, "۳۰")} روزه می‌تواند قرارداد را فسخ کند.` });
  sec.push({ type: "c", text: "۹-۲ در صورت نقض جوهری تعهدات (ارائهٔ اطلاعات نادرست، دریافت وجه از مشتری، افشای اطلاعات)، طرف مقابل با اخطار کتبی ۷ روزه حق فسخ فوری دارد." });
  sec.push({ type: "h2", text: "ماده ۱۰: حل اختلاف و قانون حاکم" });
  sec.push({ type: "c", text: "اختلافات ابتدا از طریق مذاکره (۱۵ روز) و سپس داوری یا مراجع قضایی صالح حل می‌شود. این قرارداد تابع قوانین جمهوری اسلامی ایران است و در ۳ نسخهٔ دارای اعتبار یکسان تنظیم گردید." });
  sec.push({ type: "note", text: "توجه: «شرط عدم رقابت پس از پایان قرارداد» در حقوق ایران محل تردید و اغلب غیرقابل‌اجراست (اصل آزادی کار)؛ در صورت درج، آن را محدود، متعارف و همراه با عوض قرار دهید." });
  return sec;
}

function toPlainText(sections) {
  const lines = [];
  sections.forEach((b) => {
    if (b.type === "h1") lines.push("\n" + b.text + "\n");
    else if (b.type === "sub") lines.push("[" + b.text + "]\n");
    else if (b.type === "h2") lines.push("\n" + b.text);
    else if (b.type === "li") lines.push("   • " + b.text);
    else if (b.type === "note") lines.push("(( " + b.text + " ))");
    else lines.push(b.text);
  });
  lines.push("\n\nامضای کارفرما: ..............................   تاریخ: ..............");
  lines.push("امضای طرف مقابل: ..............................   تاریخ: ..............");
  lines.push("شاهد اول: ......................   شاهد دوم: ......................");
  return lines.join("\n");
}

export function ContractGenerator({ session }) {
  const [mode, setMode] = useState("employment");
  const [jobKey, setJobKey] = useState("operator_paint");
  const docRef = useRef(null);
  const [f, setF] = useState({
    coName: "شرکت / مرکز پوشش دیواژ", coBrand: "دیواژ",
    coNationalId: "", coRegNo: "", coEcoCode: "", coWorkshopId: "",
    coRepName: session?.role === "manager" ? session.name : "", coRepRole: "مدیرعامل",
    coAddress: "", coPostal: "", coPhone: "", coEmail: "", city: "اصفهان",
    wName: "", wFather: "", wIdNo: "", wNationalId: "", wIssue: "", wBirth: "",
    wDegree: "", wField: "", wExp: "", wAddress: "", wPostal: "", wMobile: "", wEmail: "",
    contractDate: "", jobTitle: JOBS.operator_paint.title, jobCode: "",
    unit: JOBS.operator_paint.unit, supervisor: "سرپرست خط تولید",
    skill: JOBS.operator_paint.skill, duties: JOBS.operator_paint.duties,
    contractKind: "موقت (مدت معیّن)", startDate: "", endDate: "", duration: "یک سال",
    probation: "یک ماه", noticeDays: "۳۰",
    workPlace: "کارگاه/سالن پوشش دیواژ", workStart: "۸:۰۰", workEnd: "۱۶:۰۰",
    workDays: "شنبه تا چهارشنبه", weeklyHours: "۴۴",
    baseSalary: "", housing: "", food: "", transport: "",
    leaveDays: "۲۶", evalPeriod: "شش‌ماهه", confYears: "دو",
    resignNotice: "۱۵", copies: "۲",
    territory: "استان اصفهان", commissionTable: "", penalty: "", security: "چک تضمینی",
    securityAmount: "", terminationNotice: "۳۰",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target?.value ?? e }));
  const applyJob = (k) => { const j = JOBS[k]; setJobKey(k); setF((p) => ({ ...p, jobTitle: j.title, unit: j.unit, skill: j.skill, duties: j.duties })); };
  const sections = useMemo(() => (mode === "employment" ? buildEmployment(f) : buildCommission(f)), [mode, f]);
  const copyText = () => { navigator.clipboard?.writeText(toPlainText(sections)); };
  const printDoc = () => window.print();

  return (
    <div dir="rtl" className="contract-root">
      <style>{`
        .contract-root{font-family:'Vazirmatn',Tahoma,sans-serif;color:${T.ink};padding-bottom:24px}
        .contract-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;max-width:1180px;margin:0 auto;padding:12px 14px 0}
        .cb-title{font-weight:700;font-size:14px;color:${T.steelDk}}
        .cb-actions{display:flex;gap:8px}
        .contract-grid{max-width:1180px;margin:0 auto;padding:14px;display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
        @media(min-width:860px){.contract-grid{grid-template-columns:minmax(320px,420px) 1fr}}
        .field{display:flex;flex-direction:column;gap:4px}
        .field label{font-size:12px;color:${T.ink2};font-weight:500}
        .field input,.field select,.field textarea{font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:#fff;color:${T.ink};outline:none;width:100%}
        .field input:focus,.field select:focus,.field textarea:focus{border-color:${T.steel};box-shadow:0 0 0 3px ${T.steel}22}
        .grid{display:grid;gap:12px}
        .btn{font-family:inherit;cursor:pointer;border:none;border-radius:9px;padding:9px 16px;font-weight:600;font-size:13px}
        .doc h1{font-size:20px;text-align:center;margin:0 0 4px;letter-spacing:.2px}
        .doc .subline{text-align:center;font-size:12px;color:${T.ink2};margin-bottom:18px}
        .doc h2{font-size:14px;color:${T.steelDk};border-bottom:1px solid ${T.line};padding-bottom:4px;margin:18px 0 8px}
        .doc p.cl{font-size:12.5px;line-height:2;margin:5px 0;text-align:justify}
        .doc li{font-size:12.5px;line-height:2;margin:3px 0}
        .doc .note{font-size:12px;line-height:1.9;background:${T.soft};border-right:3px solid ${T.amber};padding:8px 12px;margin:8px 0;color:${T.ink2};border-radius:6px}
        @media print{.no-print{display:none!important}.doc-wrap{box-shadow:none!important;margin:0!important;max-width:100%!important;border:none!important}}
      `}</style>

      <div className="contract-bar no-print">
        <div className="cb-title">مولد قرارداد — دیواژ</div>
        <div className="cb-actions">
          <button className="btn" onClick={copyText} style={{ background: "#3a4650", color: "#fff" }}>کپی متن</button>
          <button className="btn" onClick={printDoc} style={{ background: T.amber, color: "#fff" }}>چاپ / ذخیره PDF</button>
        </div>
      </div>

      <div className="contract-grid">
        <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 6, background: "#fff", padding: 6, borderRadius: 12, border: `1px solid ${T.line}` }}>
            {[["employment", "قرارداد کار (استخدام)"], ["commission", "قرارداد پورسانتی (بازاریاب)"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className="btn" style={{ flex: 1, background: mode === k ? T.steel : "transparent", color: mode === k ? "#fff" : T.ink2 }}>{l}</button>
            ))}
          </div>

          {mode === "employment" && (
            <Panel title="۱) انتخاب شغل">
              <div className="field">
                <label>قالب شغلی مرکز پوشش</label>
                <select value={jobKey} onChange={(e) => applyJob(e.target.value)}>
                  {Object.entries(JOBS).map(([k, j]) => <option key={k} value={k}>{j.label}</option>)}
                </select>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <F label="عنوان دقیق سمت" v={f.jobTitle} on={set("jobTitle")} />
                <F label="کد شغلی (اختیاری)" v={f.jobCode} on={set("jobCode")} />
                <F label="واحد سازمانی" v={f.unit} on={set("unit")} />
                <F label="مقام مافوق" v={f.supervisor} on={set("supervisor")} />
              </div>
              <div className="field">
                <label>شرح وظایف (هر خط یک وظیفه)</label>
                <textarea rows={6} value={(f.duties || []).join("\n")} onChange={(e) => setF((p) => ({ ...p, duties: e.target.value.split("\n").filter(Boolean) }))} />
              </div>
            </Panel>
          )}

          <Panel title="۲) کارفرما (دیواژ)">
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="نام شرکت/مرکز" v={f.coName} on={set("coName")} />
              <F label="نام تجاری" v={f.coBrand} on={set("coBrand")} />
              <F label="شناسهٔ ملی" v={f.coNationalId} on={set("coNationalId")} />
              <F label="شمارهٔ ثبت" v={f.coRegNo} on={set("coRegNo")} />
              <F label="کد اقتصادی" v={f.coEcoCode} on={set("coEcoCode")} />
              <F label="شناسهٔ کارگاهی (بیمه)" v={f.coWorkshopId} on={set("coWorkshopId")} />
              <F label="نمایندهٔ قانونی" v={f.coRepName} on={set("coRepName")} />
              <F label="سمت نماینده" v={f.coRepRole} on={set("coRepRole")} />
            </div>
            <F label="نشانی کارفرما" v={f.coAddress} on={set("coAddress")} />
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="کدپستی" v={f.coPostal} on={set("coPostal")} />
              <F label="تلفن" v={f.coPhone} on={set("coPhone")} />
              <F label="ایمیل" v={f.coEmail} on={set("coEmail")} />
              <F label="شهر" v={f.city} on={set("city")} />
            </div>
          </Panel>

          <Panel title={mode === "employment" ? "۳) کارگر" : "۳) بازاریاب"}>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <F label="نام و نام خانوادگی" v={f.wName} on={set("wName")} />
              <F label="کد ملی" v={f.wNationalId} on={set("wNationalId")} />
              {mode === "employment" && <>
                <F label="نام پدر" v={f.wFather} on={set("wFather")} />
                <F label="شمارهٔ شناسنامه" v={f.wIdNo} on={set("wIdNo")} />
                <F label="محل صدور" v={f.wIssue} on={set("wIssue")} />
                <F label="تاریخ تولد" v={f.wBirth} on={set("wBirth")} />
                <F label="مدرک تحصیلی" v={f.wDegree} on={set("wDegree")} />
                <F label="رشته" v={f.wField} on={set("wField")} />
                <F label="سابقهٔ مرتبط" v={f.wExp} on={set("wExp")} />
              </>}
              <F label="تلفن همراه" v={f.wMobile} on={set("wMobile")} />
            </div>
            <F label="نشانی" v={f.wAddress} on={set("wAddress")} />
          </Panel>

          {mode === "employment" ? (
            <>
              <Panel title="۴) شرایط قرارداد">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="تاریخ تنظیم" v={f.contractDate} on={set("contractDate")} />
                  <SelF label="نوع قرارداد" v={f.contractKind} on={set("contractKind")} opts={["دائم", "موقت (مدت معیّن)", "کار معیّن", "کارآموزی"]} />
                  <F label="تاریخ شروع" v={f.startDate} on={set("startDate")} />
                  <F label="تاریخ پایان" v={f.endDate} on={set("endDate")} />
                  <F label="مدت" v={f.duration} on={set("duration")} />
                  <F label="دورهٔ آزمایشی" v={f.probation} on={set("probation")} />
                </div>
                <SelF label="سطح مهارت (سقف آزمایشی)" v={f.skill} on={set("skill")} opts={[["simple", "ساده/نیمه‌ماهر — سقف ۱ ماه"], ["skilled", "ماهر/متخصص — سقف ۳ ماه"]]} pairs />
                <F label="محل انجام کار" v={f.workPlace} on={set("workPlace")} />
              </Panel>

              <Panel title="۵) ساعات کار">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="شروع" v={f.workStart} on={set("workStart")} />
                  <F label="پایان" v={f.workEnd} on={set("workEnd")} />
                  <F label="روزهای کاری" v={f.workDays} on={set("workDays")} />
                  <F label="ساعت در هفته (حداکثر ۴۴)" v={f.weeklyHours} on={set("weeklyHours")} />
                </div>
              </Panel>

              <Panel title="۶) حقوق و مزایا (ریال)">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="حقوق پایهٔ ماهانه" v={f.baseSalary} on={set("baseSalary")} />
                  <F label="حق مسکن" v={f.housing} on={set("housing")} />
                  <F label="بن خواروبار" v={f.food} on={set("food")} />
                  <F label="ایاب و ذهاب" v={f.transport} on={set("transport")} />
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <F label="روز مرخصی سالانه" v={f.leaveDays} on={set("leaveDays")} />
                  <SelF label="دورهٔ ارزیابی" v={f.evalPeriod} on={set("evalPeriod")} opts={["ماهانه", "فصلی", "شش‌ماهه"]} />
                </div>
                <p style={{ fontSize: 11, color: T.warn, margin: 0 }}>مبالغ را با آخرین مصوبهٔ شورای عالی کار سال جاری تکمیل کنید و از حداقل قانونی کمتر نباشد.</p>
              </Panel>
            </>
          ) : (
            <Panel title="۴) شرایط پورسانت و تضمین">
              <F label="تاریخ تنظیم" v={f.contractDate} on={set("contractDate")} />
              <F label="محدودهٔ جغرافیایی" v={f.territory} on={set("territory")} />
              <F label="جدول/نرخ پورسانت" v={f.commissionTable} on={set("commissionTable")} />
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <F label="نوع تضمین" v={f.security} on={set("security")} />
                <F label="مبلغ تضمین (ریال)" v={f.securityAmount} on={set("securityAmount")} />
                <F label="خسارت نقض محرمانگی (ریال)" v={f.penalty} on={set("penalty")} />
                <F label="مهلت اعلام فسخ (روز)" v={f.terminationNotice} on={set("terminationNotice")} />
              </div>
            </Panel>
          )}
        </div>

        <div className="doc-wrap" ref={docRef} style={{ background: T.panel, borderRadius: 12, boxShadow: "0 1px 3px #0001", padding: "34px 40px", border: `1px solid ${T.line}` }}>
          <div className="doc">
            {sections.map((b, i) => {
              if (b.type === "h1") return <h1 key={i}>{b.text}</h1>;
              if (b.type === "sub") return <div key={i} className="subline">{b.text}</div>;
              if (b.type === "para") return <p key={i} className="cl" style={{ background: T.soft, padding: "10px 12px", borderRadius: 8 }}>{b.text}</p>;
              if (b.type === "h2") return <h2 key={i}>{b.text}</h2>;
              if (b.type === "li") return <li key={i} style={{ listStyle: "none" }}><span style={{ color: T.steel, fontWeight: 700 }}>◆ </span>{b.text}</li>;
              if (b.type === "note") return <div key={i} className="note">⚠ {b.text}</div>;
              return <p key={i} className="cl">{b.text}</p>;
            })}
            <div style={{ marginTop: 26, borderTop: `1px dashed ${T.line}`, paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, fontSize: 12.5, lineHeight: 2.2 }}>
              <div>
                <div style={{ fontWeight: 700 }}>کارفرما</div>
                <div>نام: {B(f.coRepName)}</div>
                <div>سمت: {B(f.coRepRole)}</div>
                <div>تاریخ و امضا/مهر: ....................</div>
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{mode === "employment" ? "کارگر" : "بازاریاب"}</div>
                <div>نام: {B(f.wName)}</div>
                <div>کد ملی: {B(f.wNationalId)}</div>
                <div>تاریخ و امضا: ....................</div>
              </div>
              <div>شاهد اول: ............................... امضا: ..............</div>
              <div>شاهد دوم: ............................... امضا: ..............</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: T.steelDk }}>{title}</div>
      {children}
    </div>
  );
}

function F({ label, v, on }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={v} onChange={on} />
    </div>
  );
}

function SelF({ label, v, on, opts, pairs }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={v} onChange={on}>
        {opts.map((o) => pairs ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
