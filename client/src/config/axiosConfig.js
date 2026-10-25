import axios from "axios";

/**
 * Axios instance configuration for API calls
 * Points to the Express backend server running on localhost:3000
 */

// Use Vite environment variables in the browser: `import.meta.env`.
// If you need to override, set `VITE_API_URL` in a `.env` file at the project root.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Include cookies in requests
});

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_METHODS = new Set(["get", "head", "options"]);
const MAX_RETRIES = 2;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Request Interceptor
 * Auth is now httpOnly cookie only (withCredentials:true).
 * Bearer header removed to prevent XSS token theft via localStorage.
 * Old localStorage tokens are cleared on first request (migration).
 */
apiClient.interceptors.request.use(
  (config) => {
    // One-time migration: clear legacy token if still present
    if (typeof window !== "undefined" && localStorage.getItem("token")) {
      localStorage.removeItem("token");
      // also clear from sessionStorage if attacker stored there
      try { sessionStorage.removeItem("token"); } catch {}
    }

    // Let the browser set multipart boundaries for FormData uploads.
    // Keeping a manual/default Content-Type can make multer fail with
    // "Unexpected end of form" because the boundary is missing or stale.
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
      delete config.headers["content-type"];
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Track if logout redirect is already in progress to avoid duplicate redirects
let _logoutInProgress = false;

const triggerLogout = () => {
  if (_logoutInProgress) return;
  if (window.location.pathname.includes("/login")) return;
  _logoutInProgress = true;
  try { localStorage.removeItem("token"); } catch {}
  try { sessionStorage.removeItem("token"); } catch {}
  localStorage.removeItem("user");
  localStorage.removeItem("expiresAt");
  // Small delay to let any pending state updates complete
  setTimeout(() => {
    window.location.href = "/login";
  }, 100);
};

// Reset the flag when we're on the login page
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (window.location.pathname.includes("/login")) {
      _logoutInProgress = false;
    }
  });
}

/**
 * Response Interceptor
 * Handles errors and token expiration
 */
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const config = error.config || {};
    const method = String(config.method || "get").toLowerCase();
    const status = Number(error.response?.status || 0);
    const isNetworkError =
      !error.response &&
      (error.code === "ECONNABORTED" ||
        String(error.message || "")
          .toLowerCase()
          .includes("network") ||
        String(error.message || "")
          .toLowerCase()
          .includes("timeout"));
    const retryable =
      RETRYABLE_METHODS.has(method) &&
      (RETRYABLE_STATUS_CODES.has(status) || isNetworkError);
    const retryCount = Number(config.__retryCount || 0);

    if (retryable && retryCount < MAX_RETRIES) {
      config.__retryCount = retryCount + 1;
      const backoff = 400 * 2 ** retryCount;
      await wait(backoff);
      return apiClient(config);
    }

    // Handle 401 Unauthorized (token expired or missing)
    if (error.response?.status === 401) {
      // Skip logout redirect if this request opted out
      const skipLogout = Boolean(config._skipAuthRedirect);
      if (!skipLogout) {
        triggerLogout();
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
