const API_BASE = "/api";
const TOKEN_KEY = "divaj_access";
const REFRESH_KEY = "divaj_refresh";

function extractError(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  const firstKey = Object.keys(data)[0];
  if (firstKey) {
    const v = data[firstKey];
    if (Array.isArray(v)) return `${firstKey}: ${v[0]}`;
    if (typeof v === "string") return v;
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

export const usersApi = {
  list: () => request("/users/"),
  create: (data) => request("/users/", { method: "POST", body: data }),
};
