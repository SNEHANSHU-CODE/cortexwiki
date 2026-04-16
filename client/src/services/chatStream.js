import axios from "axios";
import { clearSession, finishHydration, setSession } from "../redux/slices/authSlice";

const baseURL = import.meta.env.VITE_API_BASE_URL || "";

export const httpClient = axios.create({
  baseURL,
  timeout: 30_000,
  withCredentials: true,
});

// Separate client for refresh — never intercepted to avoid infinite loops.
const refreshClient = axios.create({
  baseURL,
  timeout: 15_000,
  withCredentials: true,
});

let boundStore = null;
// Single in-flight refresh promise shared across all concurrent 401 retries.
let refreshPromise = null;

export function initializeHttpClient(store) {
  if (boundStore) return; // idempotent
  boundStore = store;

  // ── Request: attach latest access token ──────────────────────────────────
  httpClient.interceptors.request.use((config) => {
    const token = boundStore.getState().auth.accessToken;
    if (token) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // ── Response: silent token refresh on 401 ────────────────────────────────
  httpClient.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;
      const status   = error.response?.status;

      const skip =
        !boundStore ||
        status !== 401 ||
        original?._retry ||
        original?.url?.includes("/api/auth/refresh") ||
        original?.url?.includes("/api/auth/login") ||
        original?.url?.includes("/api/auth/register");

      if (skip) throw error;

      original._retry = true;

      try {
        const session = await refreshSession();
        boundStore.dispatch(
          setSession({
            accessToken: session.access_token,
            user:        session.user,
            expiresAt:   session.expires_at ?? null,
          }),
        );
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${session.access_token}`;
        return await httpClient(original);
      } catch (refreshError) {
        boundStore.dispatch(clearSession());
        boundStore.dispatch(finishHydration());
        throw refreshError;
      }
    },
  );
}

/**
 * Refresh the session. Multiple callers that arrive while a refresh is
 * in-flight all share the same promise — prevents duplicate /refresh calls.
 */
export async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post("/api/auth/refresh")
      .then((res) => res.data)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export default httpClient;