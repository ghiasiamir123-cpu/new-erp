from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MANAGER = "manager", "مدیر"
        DATA_ENTRY = "data_entry", "کاربر ثبت"
        VIEWER = "viewer", "ناظر"
        DRIVER = "driver", "راننده"
        ACCOUNTANT = "accountant", "حسابداری"

    name = models.CharField(max_length=150)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    position = models.CharField(max_length=100, blank=True)
    must_change_password = models.BooleanField(default=False)

    def __str__(self):
        return self.username


class Project(models.Model):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class ProjectStage(models.Model):
    """مرحله‌ای که یک پروژه شامل آن است: متراژ خودش را دارد و جداگانه تیک انجام می‌خورد."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="stages")
    name = models.CharField(max_length=100)
    area = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    done = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        unique_together = [("project", "name")]

    def __str__(self):
        return f"{self.project.name} · {self.name}"


class Employee(models.Model):
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Material(models.Model):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=30, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class MaterialUsageReport(models.Model):
    """گزارش روزانهٔ مصرف مواد یک کاربر — دقیقاً مثل گزارش کار روزانه تأیید می‌شود."""

    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="material_usage_reports")
    recorded_by_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    resubmitted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.recorded_by_name}"


class MaterialUsageFeedback(models.Model):
    report = models.ForeignKey(MaterialUsageReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


class MaterialUsage(models.Model):
    report = models.ForeignKey(MaterialUsageReport, on_delete=models.CASCADE, related_name="items")
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    material = models.ForeignKey(Material, on_delete=models.SET_NULL, null=True, blank=True)
    material_name = models.CharField(max_length=200, blank=True)
    material_code = models.CharField(max_length=50, blank=True)
    unit = models.CharField(max_length=30, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class Driver(models.Model):
    name = models.CharField(max_length=150)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class DriverReport(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    driver = models.ForeignKey(Driver, on_delete=models.SET_NULL, null=True, blank=True)
    driver_name = models.CharField(max_length=150, blank=True)

    morning_scheduled_time = models.CharField(max_length=20, blank=True)
    morning_arrival_time = models.CharField(max_length=20, blank=True)
    morning_passengers = models.CharField(max_length=300, blank=True)

    evening_scheduled_time = models.CharField(max_length=20, blank=True)
    evening_arrival_time = models.CharField(max_length=20, blank=True)
    evening_passengers = models.CharField(max_length=300, blank=True)

    odometer_start = models.DecimalField(max_digits=10, decimal_places=1, default=0)
    odometer_end = models.DecimalField(max_digits=10, decimal_places=1, default=0)

    recorded_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="driver_reports")
    recorded_by_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    resubmitted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.driver_name}"


class DriverFeedback(models.Model):
    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


class DriverDelay(models.Model):
    class Period(models.TextChoices):
        MORNING = "morning", "صبح"
        EVENING = "evening", "عصر"

    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="delays")
    period = models.CharField(max_length=10, choices=Period.choices, default=Period.MORNING)
    reason = models.CharField(max_length=300)


class DriverTask(models.Model):
    report = models.ForeignKey(DriverReport, on_delete=models.CASCADE, related_name="tasks")
    time = models.CharField(max_length=20, blank=True)
    destination = models.CharField(max_length=300, blank=True)
    description = models.CharField(max_length=500, blank=True)


class DailyReport(models.Model):
    class Shift(models.TextChoices):
        MORNING = "صبح", "صبح"
        EVENING = "عصر", "عصر"
        NIGHT = "شب", "شب"

    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        WAITING = "waiting", "در انتظار تأیید"
        APPROVED = "approved", "تأیید شد"
        REVISION = "revision", "نیاز به اصلاح"

    date = models.DateField()
    shift = models.CharField(max_length=10, choices=Shift.choices)
    supervisor = models.ForeignKey(User, on_delete=models.PROTECT, related_name="reports")
    supervisor_name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    # وقتی گزارشی که نیاز به اصلاح داشته دوباره ارسال می‌شود، تا تصمیم بعدی مدیر true می‌ماند.
    resubmitted = models.BooleanField(default=False)
    description = models.TextField(blank=True)
    problems = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.date} · {self.shift} · {self.supervisor_name}"


class ReportItem(models.Model):
    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="items")
    employee = models.CharField(max_length=150)
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    activity = models.CharField(max_length=100)
    hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class ReportProgress(models.Model):
    """متراژ کارِ انجام‌شدهٔ هر روز، یک‌بار برای هر پروژه/مرحله — نه به‌ازای هر نفر."""

    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="progress")
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True)
    project_name = models.CharField(max_length=200, blank=True)
    stage = models.CharField(max_length=100)
    area = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    desc = models.CharField(max_length=500, blank=True)


class Feedback(models.Model):
    report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name="feedback")
    manager_name = models.CharField(max_length=150)
    text = models.TextField()
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at"]


# ============ حقوق و دستمزد ============
# ارقام حقوق به ریال است و چون مبالغ بزرگ‌اند، همه‌جا DecimalField با ۲ رقم اعشار
# استفاده شده تا خطای گِردکردن اعشاری پیش نیاید.

DEFAULT_COMPONENTS = [
    {"key": "base", "name": "حقوق پایه", "dailyRate": 5541850,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    {"key": "house", "name": "حق مسکن", "dailyRate": 1000000,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    # نرخ روزانه از تقسیم رقم ماهانهٔ بخشنامه بر ۳۰ می‌آید؛ با تمام دقت ذخیره می‌شود
    # تا ضرب دوبارهٔ آن در ۳۰ دقیقاً همان رقم ماهانه شود.
    {"key": "bon", "name": "بن خواروبار", "dailyRate": 22000000 / 30,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": False},
    {"key": "marr", "name": "حق تأهل", "dailyRate": 5000000 / 30,
     "prorate": True, "ins": True, "tax": True, "perChild": False, "marriedOnly": True},
    {"key": "child", "name": "حق اولاد (هر فرزند)", "dailyRate": 554185,
     "prorate": True, "ins": False, "tax": False, "perChild": True, "marriedOnly": False},
]

# پله‌های مالیات: اندازهٔ هر پله (مازاد بر معافیت). upto=null یعنی «مازاد بر آن».
DEFAULT_BRACKETS = [
    {"upto": 400000000, "rate": 10},
    {"upto": 200000000, "rate": 15},
    {"upto": 200000000, "rate": 20},
    {"upto": 200000000, "rate": 25},
    {"upto": None, "rate": 30},
]


class PayrollSettings(models.Model):
    """تنظیمات مشترک محاسبهٔ حقوق — همیشه فقط یک ردیف دارد."""

    daily_hours = models.DecimalField(max_digits=5, decimal_places=2, default=7.33)
    ot_mult = models.DecimalField(max_digits=5, decimal_places=2, default=1.4)
    ins_rate = models.DecimalField(max_digits=5, decimal_places=2, default=7)
    tax_exempt = models.DecimalField(max_digits=16, decimal_places=2, default=400000000)
    components = models.JSONField(default=list)
    brackets = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Payroll settings"

    @classmethod
    def load(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create(
                components=list(DEFAULT_COMPONENTS), brackets=list(DEFAULT_BRACKETS)
            )
        return obj


class PayrollStaff(models.Model):
    """پرسنل حقوق‌بگیر — مستقل از لیست کارگرهای گزارش روزانه."""

    name = models.CharField(max_length=150)
    dept = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    married = models.BooleanField(default=False)
    children = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name


class PayrollMonth(models.Model):
    """یک دورهٔ حقوق — مثلاً «مرداد ۱۴۰۵»."""

    label = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.label


class PayrollEntry(models.Model):
    """ارقام متغیر یک نفر در یک ماه."""

    month = models.ForeignKey(PayrollMonth, on_delete=models.CASCADE, related_name="entries")
    staff = models.ForeignKey(PayrollStaff, on_delete=models.SET_NULL, null=True, blank=True)
    staff_name = models.CharField(max_length=150, blank=True)
    dept = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    married = models.BooleanField(default=False)
    children = models.PositiveSmallIntegerField(default=0)

    absent_days = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    worked_days = models.DecimalField(max_digits=5, decimal_places=2, default=30)
    ot_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    short_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)

    kpi = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    seniority = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    transport = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    responsibility = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    # صفر یعنی «بیمه خودکار ۷٪»؛ عدد یعنی بیمهٔ دستی.
    insurance_manual = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    advance = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    reserve = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    loan = models.DecimalField(max_digits=16, decimal_places=2, default=0)

    class Meta:
        ordering = ["id"]
        unique_together = [("month", "staff")]


# ============ انبار ============
# مبنای طراحی: موجودی هیچ‌وقت به‌صورت یک عدد ذخیره نمی‌شود که رویش بنویسیم.
# هر تغییر یک ردیف در StockMovement است و موجودی = جمع همان ردیف‌ها. این‌طور
# همیشه می‌شود پرسید «این عدد از کجا آمد؟» — و انبار قابل اعتماد می‌ماند.


class Supplier(models.Model):
    name = models.CharField(max_length=150, unique=True)
    lead_time_days = models.PositiveSmallIntegerField(default=0)  # چند روز تا رسیدن سفارش
    note = models.CharField(max_length=300, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Warehouse(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=30, blank=True)
    # کارگاه مواد را از این انبار برمی‌دارد.
    supplies_workshop = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Product(models.Model):
    """کالای پایه. یک کالا ممکن است در چند بسته/اندازه عرضه شود."""

    # کد سایت؛ یکتا نیست چون چند واریانت (گرید/شید) کد یکسان دارند.
    code = models.CharField(max_length=80, blank=True, db_index=True)
    name = models.CharField(max_length=300)
    brand = models.CharField(max_length=100, blank=True, db_index=True)
    category = models.CharField(max_length=150, blank=True, db_index=True)

    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True)
    sepidar_item_id = models.CharField(max_length=60, blank=True)

    # فروشی = در سایت دیده می‌شود. مواد مصرفی کارگاه فروشی نیستند.
    sellable = models.BooleanField(default=True)
    # فقط رنگ و هاردنر و امثال آن بچ و تاریخ انقضا می‌خواهند؛ سنباده و ابزار نه.
    batch_tracked = models.BooleanField(default=False)
    hazardous = models.BooleanField(default=False)  # آتش‌زا مثل تینر
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["brand", "name"]

    def __str__(self):
        return self.name


class Sku(models.Model):
    """بستهٔ قابل شمارش — واحد واقعی انبار.

    «شناسه بسته» در سایت فروش، که کلید اتصال دو سیستم است.
    """

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="skus")
    site_package_id = models.CharField(max_length=40, unique=True, db_index=True)
    # کد همین کالا در سپیدار. موجودی در سطح بسته نگهداری می‌شود، پس نگاشت هم
    # باید همین‌جا بنشیند نه روی محصول.
    sepidar_item_id = models.CharField(max_length=60, blank=True, db_index=True)
    pack_size = models.CharField(max_length=60, blank=True)   # «1L» ، «جعبه ۱۰۰ عددی» ، «عدد»

    # واحد اندازه‌گیری، به سبک سپیدار: موجودی همیشه به «واحد اصلی» نگهداری
    # می‌شود و «واحد فرعی» فقط راهی برای وارد کردن مقدار است.
    # alt_to_base = چند واحد اصلی در یک واحد فرعی.
    #   حلب ۲۵ کیلویی → اصلی «حلب»، فرعی «کیلوگرم»، نرخ 0.04
    #   جعبهٔ ۱۰۰ تایی → اصلی «جعبه»، فرعی «عدد»،    نرخ 0.01
    base_unit = models.CharField(max_length=30, blank=True)
    alt_unit = models.CharField(max_length=30, blank=True)
    alt_to_base = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    grit = models.CharField(max_length=40, blank=True)        # شماره سنباده
    shade = models.CharField(max_length=80, blank=True)       # بیس / شید
    barcode = models.CharField(max_length=60, blank=True)
    # وزن واقعی یک بسته — از API سایت می‌آید و برای حمل و کنترل تبدیل واحد به کار می‌رود.
    weight_kg = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)

    # قیمت فروش مرجعش سایت است و اینجا فقط برای گزارش نگه داشته می‌شود.
    sale_price = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    # قیمت خرید فقط انباری است و هرگز به سایت فرستاده نمی‌شود.
    cost_price = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["product__brand", "product__name", "pack_size"]

    def __str__(self):
        bits = [self.product.name, self.pack_size, self.grit, self.shade]
        return " · ".join(b for b in bits if b)


class PackConversion(models.Model):
    """۱ جعبهٔ ۱۰۰ عددی = ۱۰۰ عدد. برای وقتی بسته باز و تکی فروخته می‌شود."""

    box_sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name="unpacks_to")
    unit_sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name="packs_from")
    factor = models.PositiveIntegerField()

    class Meta:
        unique_together = [("box_sku", "unit_sku")]

    def __str__(self):
        return f"۱ × {self.box_sku.pack_size} = {self.factor} × {self.unit_sku.pack_size}"


class StockBatch(models.Model):
    """سری ساخت — فقط برای کالاهایی که batch_tracked دارند."""

    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name="batches")
    batch_no = models.CharField(max_length=80)
    produced_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = [("sku", "batch_no")]
        ordering = ["expires_on", "batch_no"]

    def __str__(self):
        return f"{self.sku} — بچ {self.batch_no}"


class StockItem(models.Model):
    """مشخصات یک کالا در یک انبار: قفسه، حداقل موجودی، رزرو.

    خودِ موجودی اینجا نیست — از جمع گردش‌ها به‌دست می‌آید.
    """

    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name="stock_items")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stock_items")
    shelf_code = models.CharField(max_length=60, blank=True)
    min_qty = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # مقداری که برای سفارش ثبت‌شده کنار گذاشته شده و نباید دوباره فروخته شود.
    reserved_qty = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    counted_at = models.DateField(null=True, blank=True)  # آخرین انبارگردانی

    class Meta:
        unique_together = [("sku", "warehouse")]

    def __str__(self):
        return f"{self.sku} @ {self.warehouse}"


class StockMovement(models.Model):
    """دفتر گردش کالا. مقدار علامت‌دار است: ورود مثبت، خروج منفی."""

    class Kind(models.TextChoices):
        RECEIPT = "receipt", "ورود کالا"
        SALE = "sale", "فروش"
        RETURN = "return", "مرجوعی"
        WORKSHOP = "workshop", "مصرف کارگاه"
        TRANSFER_OUT = "transfer_out", "انتقال — خروج"
        TRANSFER_IN = "transfer_in", "انتقال — ورود"
        UNPACK_OUT = "unpack_out", "شکستن بسته — خروج"
        UNPACK_IN = "unpack_in", "شکستن بسته — ورود"
        COUNT = "count", "اصلاح انبارگردانی"

    sku = models.ForeignKey(Sku, on_delete=models.PROTECT, related_name="movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="movements")
    batch = models.ForeignKey(StockBatch, on_delete=models.PROTECT, null=True, blank=True,
                              related_name="movements")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # همیشه به واحد اصلیِ کالا. سه رقم اعشار تا تبدیل واحد فرعی گِرد نشود.
    qty = models.DecimalField(max_digits=14, decimal_places=3)
    # آنچه کاربر واقعاً وارد کرده — برای اینکه در سابقه «۳ کیلوگرم» دیده شود نه «۰٫۱۲ حلب».
    entered_qty = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    entered_unit = models.CharField(max_length=30, blank=True)
    unit_cost = models.DecimalField(max_digits=16, decimal_places=2, default=0)  # فقط هنگام ورود

    date = models.DateField()
    # حواله‌ای که این گردش از آن ساخته شده (اگر از حواله آمده باشد).
    voucher = models.ForeignKey("StockVoucher", on_delete=models.PROTECT, null=True, blank=True,
                                related_name="movements")
    # ارجاع به منبع: شمارهٔ سفارش سایت، گزارش مصرف کارگاه و…
    ref = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="stock_movements")
    created_by_name = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["sku", "warehouse"]),
            models.Index(fields=["date"]),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} {self.qty} — {self.sku}"


class StockVoucher(models.Model):
    """حوالهٔ ورود/خروج — یک برگه با چند قلم کالا.

    تا وقتی «پیش‌نویس» است روی موجودی اثری ندارد؛ با «ثبت نهایی» گردش‌هایش
    ساخته می‌شود و برگه قفل می‌گردد. اصلاح یک حوالهٔ ثبت‌شده با حوالهٔ معکوس
    انجام می‌شود، نه با پاک‌کردن — تا سابقه دست‌نخورده بماند.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "پیش‌نویس"
        POSTED = "posted", "ثبت نهایی"

    # جهت حواله از همین نوع گردش فهمیده می‌شود.
    INBOUND_KINDS = ("receipt", "return", "transfer_in")

    number = models.CharField(max_length=40, unique=True)
    movement_kind = models.CharField(max_length=20, choices=StockMovement.Kind.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    date = models.DateField()
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="vouchers")
    # مقصدِ انتقال. یک حواله هر دو طرف را می‌سازد تا کالا بین دو انبار گم نشود.
    to_warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="incoming_vouchers")
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True)
    # طرف مقابل: تأمین‌کننده، مشتری، پروژه یا هرچه که کالا از/به آن رفته.
    counterparty = models.CharField(max_length=200, blank=True)
    ref = models.CharField(max_length=120, blank=True)   # شمارهٔ فاکتور یا بارنامه
    note = models.CharField(max_length=500, blank=True)

    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="stock_vouchers")
    created_by_name = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]

    @property
    def is_inbound(self):
        return self.movement_kind in self.INBOUND_KINDS

    def __str__(self):
        return f"{self.number} — {self.get_movement_kind_display()}"


class StockVoucherLine(models.Model):
    voucher = models.ForeignKey(StockVoucher, on_delete=models.CASCADE, related_name="lines")
    sku = models.ForeignKey(Sku, on_delete=models.PROTECT, related_name="voucher_lines")
    # همیشه مثبت؛ جهت را نوع حواله تعیین می‌کند. به واحدی که در unit آمده.
    qty = models.DecimalField(max_digits=14, decimal_places=3)
    unit = models.CharField(max_length=30, blank=True)   # خالی = واحد اصلی
    unit_cost = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    batch_no = models.CharField(max_length=80, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["id"]
