import apiClient from "../config/axiosConfig";

const emitAuthChange = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-change"));
  }
};

/**
 * Logs in the user.
 * @param {string} phone - Phone number or Email
 * @param {string} password
 */
export const loginUser = async (phone, password) => {
  try {
    // Ensure previous session data cannot leak into a new login flow.
    try { localStorage.removeItem("token"); } catch {}
    try { sessionStorage.removeItem("token"); } catch {}
    localStorage.removeItem("user");
    localStorage.removeItem("expiresAt");
    emitAuthChange();

    const response = await apiClient.post("/api/auth/login", {
      identifier: phone,
      password,
    });
    // Store basic user info in localStorage (for UI access) — token stays httpOnly cookie only
    if (response.data.user) {
      localStorage.setItem("user", JSON.stringify(response.data.user));
    }
    if (response.data.expiresAt) {
      localStorage.setItem("expiresAt", String(response.data.expiresAt));
    }
    // Legacy cleanup: if server still returns token for compat, do NOT store it
    try { localStorage.removeItem("token"); } catch {}
    try { sessionStorage.removeItem("token"); } catch {}
    emitAuthChange();
    return response.data;
  } catch (error) {
    console.error("Login API Error:", error);
    const status = error.response?.status;
    const responseData = error.response?.data;
    const headers = error.response?.headers || {};
    // Surface rate-limit metadata so Login.jsx can show countdown + scope
    const retryAfter =
      Number(headers["retry-after"] || headers["ratelimit-reset"] || 0) || 0;
    const scope =
      (responseData && typeof responseData === "object" && responseData.scope) ||
      undefined;
    if (typeof responseData === "string") {
      throw { message: responseData, status, retryAfter, scope };
    }
    if (responseData && typeof responseData === "object") {
      throw { ...responseData, status, retryAfter };
    }
    throw { message: error.message || "Login failed", status, retryAfter };
  }
};

/**
 * Changes the user's own password.
 * @param {string} currentPassword
 * @param {string} newPassword
 */
export const changePassword = async (currentPassword, newPassword) => {
  try {
    const response = await apiClient.post("/api/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return response.data;
  } catch (error) {
    const responseData = error.response?.data;
    if (responseData && typeof responseData === "object") throw responseData;
    throw { message: error.message || "Password change failed" };
  }
};

/**
 * Refreshes the current user's session token (httpOnly cookie refreshed server-side).
 */
export const refreshSession = async () => {
  const response = await apiClient.post("/api/auth/refresh");
  if (response.data?.expiresAt) {
    localStorage.setItem("expiresAt", String(response.data.expiresAt));
  }
  // Do NOT store token — cookie is httpOnly
  try { localStorage.removeItem("token"); } catch {}
  return response.data;
};

/**
 * Logs out the user.
 */
export const logoutUser = async () => {
  try {
    // Call backend to clear httpOnly cookies
    await apiClient.post("/api/auth/logout");
  } catch (error) {
    console.error("Logout failed", error);
  } finally {
    // Always clear client-side session, even if API logout fails.
    try { localStorage.removeItem("token"); } catch {}
    try { sessionStorage.removeItem("token"); } catch {}
    localStorage.removeItem("user");
    localStorage.removeItem("expiresAt");
    emitAuthChange();
  }
};
