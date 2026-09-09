const API_BASE = "/api";
const TOKEN_KEY = "divaj_access";
const REFRESH_KEY = "divaj_refresh";

// نام فیلد را به فارسی می‌گوییم؛ کاربر «warehouseCode» را نمی‌شناسد.
const FIELD_FA = {
  name: "نام", brand: "برند", category: "دسته", barcode: "بارکد",
  warehouseCode: "کد انبار", skuCode: "کد SKU", productCode: "کد محصول",
  sepidarItemId: "کد سپیدار", baseUnit: "بسته‌بندی اصلی",
  altUnit: "بسته‌بندی فرعی", altPerBase: "نرخ تبدیل بسته‌بندی",
  costPrice: "قیمت خرید", salePrice: "قیمت فروش", packSize: "اندازهٔ بسته",
  username: "نام کاربری", password: "رمز", qty: "مقدار", date: "تاریخ",
};

function extractError(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  if (Array.isArray(data)) return extractError(data[0]);
  const firstKey = Object.keys(data)[0];
  if (firstKey) {
    const v = data[firstKey];
    const text = Array.isArray(v) ? v[0] : v;
    if (typeof text !== "string") return null;
    // پیام‌هایی که خودشان نام فیلد را دارند، پیشوند لازم ندارند.
    const label = FIELD_FA[firstKey];
    if (!label || text.includes(label)) return text;
    return `${label}: ${text}`;
  }
  return null;
}

async function tryRefresh() {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.access);
    if (data.refresh) localStorage.setItem(REFRESH_KEY, data.refresh);
    return true;
  } catch {
    return false;
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const doFetch = () => {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();
  if (res.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch();
  }
  if (!res.ok) {
    let msg = `خطا در ارتباط با سرور (${res.status})`;
    try {
      msg = extractError(await res.json()) || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const auth = {
  async login(username, password) {
    const data = await request("/auth/login/", {
      method: "POST",
      body: { username, password },
      auth: false,
    });
    localStorage.setItem(TOKEN_KEY, data.access);
    localStorage.setItem(REFRESH_KEY, data.refresh);
    return data.user;
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  isLoggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  me: () => request("/auth/me/"),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password/", { method: "POST", body: { current_password, new_password } }),
};

export const projectsApi = {
  list: () => request("/projects/"),
  create: (data) => request("/projects/", { method: "POST", body: data }),
  update: (id, data) => request(`/projects/${id}/`, { method: "PATCH", body: data }),
  remove: (id) => request(`/projects/${id}/`, { method: "DELETE" }),
  saveStages: (id, stages) => request(`/projects/${id}/stages/`, { method: "PUT", body: { stages } }),
};

export const employeesApi = {
  list: () => request("/employees/"),
  create: (data) => request("/employees/", { method: "POST", body: data }),
  update: (id, data) => request(`/employees/${id}/`, { method: "PATCH", body: data }),
  remove: (id) => request(`/employees/${id}/`, { method: "DELETE" }),
};

export const reportsApi = {
  list: () => request("/reports/"),
  create: (data) => request("/reports/", { method: "POST", body: data }),
  setWaiting: (id) => request(`/reports/${id}/`, { method: "PATCH", body: { status: "waiting" } }),
  updateSections: (id, body) => request(`/reports/${id}/`, { method: "PATCH", body }),
  feedback: (id, data) => request(`/reports/${id}/feedback/`, { method: "POST", body: data }),
  remove: (id) => request(`/reports/${id}/`, { method: "DELETE" }),
};

export const materialsApi = {
  list: () => request("/materials/"),
  create: (data) => request("/materials/", { method: "POST", body: data }),
  update: (id, data) => request(`/materials/${id}/`, { method: "PATCH", body: data }),
  remove: (id) => request(`/materials/${id}/`, { method: "DELETE" }),
};

export const materialUsageApi = {
  list: () => request("/material-usages/"),
  create: (data) => request("/material-usages/", { method: "POST", body: data }),
  updateSections: (id, body) => request(`/material-usages/${id}/`, { method: "PATCH", body }),
  setWaiting: (id) => request(`/material-usages/${id}/`, { method: "PATCH", body: { status: "waiting" } }),
  feedback: (id, data) => request(`/material-usages/${id}/feedback/`, { method: "POST", body: data }),
  remove: (id) => request(`/material-usages/${id}/`, { method: "DELETE" }),
};

export const driversApi = {
  list: () => request("/drivers/"),
  create: (data) => request("/drivers/", { method: "POST", body: data }),
  update: (id, data) => request(`/drivers/${id}/`, { method: "PATCH", body: data }),
  remove: (id) => request(`/drivers/${id}/`, { method: "DELETE" }),
};

export const driverReportsApi = {
  list: () => request("/driver-reports/"),
  create: (data) => request("/driver-reports/", { method: "POST", body: data }),
  updateSections: (id, body) => request(`/driver-reports/${id}/`, { method: "PATCH", body }),
  setWaiting: (id) => request(`/driver-reports/${id}/`, { method: "PATCH", body: { status: "waiting" } }),
  feedback: (id, data) => request(`/driver-reports/${id}/feedback/`, { method: "POST", body: data }),
  remove: (id) => request(`/driver-reports/${id}/`, { method: "DELETE" }),
};

export const payrollApi = {
  settings: () => request("/payroll-settings/"),
  saveSettings: (data) => request("/payroll-settings/", { method: "PUT", body: data }),
  listStaff: () => request("/payroll-staff/"),
  createStaff: (data) => request("/payroll-staff/", { method: "POST", body: data }),
  updateStaff: (id, data) => request(`/payroll-staff/${id}/`, { method: "PATCH", body: data }),
  removeStaff: (id) => request(`/payroll-staff/${id}/`, { method: "DELETE" }),
  listMonths: () => request("/payroll-months/"),
  openMonth: (label) => request("/payroll-months/open/", { method: "POST", body: { label } }),
  saveMonth: (id, data) => request(`/payroll-months/${id}/`, { method: "PATCH", body: data }),
  removeMonth: (id) => request(`/payroll-months/${id}/`, { method: "DELETE" }),
};

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function upload(path, file, extra = {}) {
  const form = new FormData();
  form.append("file", file);
  Object.entries(extra).forEach(([k, v]) => form.append(k, v));
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    let msg = `خطا در ارتباط با سرور (${res.status})`;
    try { msg = extractError(await res.json()) || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const warehouseApi = {
  list: () => request("/warehouses/"),
  createWarehouse: (data) => request("/manage-warehouses/", { method: "POST", body: data }),
  createWorkshopItem: (data) => request("/workshop-items/", { method: "POST", body: data }),
  importCatalog: (file, dryRun) => upload("/catalog-import/", file, { dryRun: dryRun ? "1" : "" }),
  canUnpack: (sku) => request(`/unpack/${qs({ sku })}`),
  unpack: (data) => request("/unpack/", { method: "POST", body: data }),
  vouchers: (params) => request(`/stock-vouchers/${qs(params)}`),
  createVoucher: (data) => request("/stock-vouchers/", { method: "POST", body: data }),
  updateVoucher: (id, data) => request(`/stock-vouchers/${id}/`, { method: "PATCH", body: data }),
  postVoucher: (id) => request(`/stock-vouchers/${id}/post_voucher/`, { method: "POST", body: {} }),
  removeVoucher: (id) => request(`/stock-vouchers/${id}/`, { method: "DELETE" }),
  items: (params) => request(`/items/${qs(params)}`),
  createItem: (data) => request("/items/", { method: "POST", body: data }),
  updateItem: (id, data) => request(`/items/${id}/`, { method: "PATCH", body: data }),
  removeItem: (id) => request(`/items/${id}/`, { method: "DELETE" }),
  meta: (params) => request(`/stock/meta/${qs(params)}`),
  stock: (params) => request(`/stock/${qs(params)}`),
  updateStock: (id, data) => request(`/stock/${id}/`, { method: "PATCH", body: data }),
  movements: (params) => request(`/stock-movements/${qs(params)}`),
  addMovement: (data) => request("/stock-movements/", { method: "POST", body: data }),
};

export const usersApi = {
  list: () => request("/users/"),
  create: (data) => request("/users/", { method: "POST", body: data }),
  setWarehouseAccess: (username, allowed) =>
    request(`/users/${encodeURIComponent(username)}/`,
            { method: "PATCH", body: { canAccessWarehouse: allowed } }),
};
