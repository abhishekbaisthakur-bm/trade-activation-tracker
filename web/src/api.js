/**
 * Every call to the backend goes through here. The token is held in
 * sessionStorage so closing the tab ends the session on a shared field phone.
 */

const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const TOKEN_KEY = "tat.token";

let token = null;
try {
  token = window.sessionStorage.getItem(TOKEN_KEY);
} catch (e) {
  token = null;
}

export const getToken = () => token;

export function setToken(value) {
  token = value;
  try {
    if (value) window.sessionStorage.setItem(TOKEN_KEY, value);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* private mode: the token simply lives in memory for this session */
  }
}

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}
export { ApiError };

async function request(path, { method = "GET", body, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: form ? form : body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }

  if (res.status === 401) {
    // A rejected login is not an expired session. Preserve the server's
    // specific credential error and do not emit a global sign-out event.
    if (path === "/auth/login") {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(
        data.error || "That ID and password combination did not match an active account.",
        401,
        data
      );
    }
    setToken(null);
    window.dispatchEvent(new CustomEvent("tat:signed-out"));
    throw new ApiError("Your session expired. Please log in again.", 401);
  }
  if (raw) {
    if (!res.ok) throw new ApiError("That download failed.", res.status);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data);
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  login: (identifier, password) =>
    request("/auth/login", { method: "POST", body: { identifier, password } }),
  me: () => request("/auth/me"),
  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  users: () => request("/admin/users"),
  createUser: (user) => request("/admin/users", { method: "POST", body: user }),
  updateUser: (id, patch) => request(`/admin/users/${id}`, { method: "PATCH", body: patch }),
  deactivateUser: (id) => request(`/admin/users/${id}`, { method: "DELETE" }),

  plans: () => request("/admin/plans"),
  importPlans: (file, replace = true) => {
    const form = new FormData();
    form.append("file", file);
    form.append("replace", String(replace));
    return request("/admin/plans/import", { method: "POST", form });
  },

  pharmacies: (params) => request(`/admin/pharmacies${qs(params)}`),

  activations: (params) => request(`/activations${qs(params)}`),
  activation: (id) => request(`/activations/${id}`),
  setStatus: (id, status, note) =>
    request(`/activations/${id}/status`, { method: "PATCH", body: { status, note } }),

  createActivation: (payload, photos) => {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    Object.entries(photos).forEach(([assetKey, blob]) => {
      form.append(`photo_${assetKey}`, blob, `${assetKey}.jpg`);
    });
    return request("/activations", { method: "POST", form });
  },

  summary: (filters) => request(`/analytics/summary${qs(filters)}`),
  myStats: () => request("/analytics/me"),

  managerTeam: () => request("/analytics/manager/team"),
  managerSummary: (filters) => request(`/analytics/manager/summary${qs(filters)}`),
  managerSalesmanActivations: (userId) =>
  request(`/analytics/manager/team/${userId}/activations`),
  fieldUsers: () => request("/requests/field-users"),
  createFieldUser: (user) =>
  request("/requests/field-users", { method: "POST", body: user }),

updateFieldUser: (id, patch) =>
  request(`/requests/field-users/${id}`, { method: "PATCH", body: patch }),
  requests: (status) => request(`/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  masterDataReviews: (status) =>
    request(`/requests/master-data${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  approveMasterData: (id, note) =>
    request(`/requests/master-data/${id}/approve`, { method: "POST", body: { note } }),
  rejectMasterData: (id, note) =>
    request(`/requests/master-data/${id}/reject`, { method: "POST", body: { note } }),
  masterPharmacies: (search = "") =>
    request(`/requests/master-pharmacies${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  saveMasterPharmacy: (pharmacy) =>
    request("/requests/master-pharmacies", { method: "POST", body: pharmacy }),
  updateMasterPharmacy: (id, pharmacy) =>
    request(`/requests/master-pharmacies/${id}`, { method: "PATCH", body: pharmacy }),
  deactivateMasterPharmacy: (id) =>
    request(`/requests/master-pharmacies/${id}`, { method: "DELETE" }),
  mergeMasterPharmacy: (id, targetId) =>
    request(`/requests/master-pharmacies/${id}/merge`, { method: "POST", body: { targetId } }),
  importMasterPharmacies: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/requests/master-pharmacies/import", { method: "POST", form });
  },
  createRequest: (type, payload, reason) => request("/requests", { method: "POST", body: { type, payload, reason } }),
  approveRequest: (id, payload, note) => request(`/requests/${id}/approve`, { method: "POST", body: { ...(payload ? { payload } : {}), ...(note ? { note } : {}) } }),
  rejectRequest: (id, note) => request(`/requests/${id}/reject`, { method: "POST", body: { note } }),
  deactivateFieldUser: (id) =>
  request(`/requests/field-users/${id}`, { method: "DELETE" }),

  /** Photos are authenticated, so they are fetched as blobs and shown from object URLs. */
  photoUrl: async (activationId, assetKey) => {
    const res = await request(`/activations/${activationId}/photo/${assetKey}`, { raw: true });
    return URL.createObjectURL(await res.blob());
  },

  download: async (path, filename, filters) => {
    const res = await request(`${path}${qs(filters)}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

/** Converts a canvas data URL back to a Blob for multipart upload. */
export function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
