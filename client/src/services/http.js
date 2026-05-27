import axios from "axios";
import { clearSession, finishHydration, setSession } from "../redux/slices/authSlice";

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "";
  if (!configured || typeof window === "undefined") return configured;

  try {
    const url = new URL(configured);
    const host = window.location.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const isApiLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

    // Keep browser and API on same local hostname family to avoid cookie same-site mismatches.
    if (isLocalHost && isApiLocalHost && url.hostname !== host) {
      url.hostname = host;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // keep configured value
  }

  return configured;
}

const baseURL = resolveBaseUrl();

const httpClient = axios.create({
  baseURL,
  timeout: 30000,
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL,
  timeout: 30000,
  withCredentials: true,
});

let boundStore = null;
let refreshPromise = null;

export function initializeHttpClient(store) {
  if (boundStore) {
    return;
  }

  boundStore = store;

  // Request interceptor: add Bearer token from Redux state to Authorization header
  httpClient.interceptors.request.use((config) => {
    const state = boundStore?.getState?.();
    const accessToken = state?.auth?.accessToken;
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  // Response interceptor: handle 401 by refreshing token automatically
  httpClient.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const isUnauthorized = error.response?.status === 401;
      const isRefreshRequest = originalRequest?.url?.includes("/api/auth/refresh");
      const isAuthMutation = originalRequest?.url?.includes("/api/auth/login") || originalRequest?.url?.includes("/api/auth/register");

      if (!boundStore || !isUnauthorized || originalRequest?._retry || isRefreshRequest || isAuthMutation) {
        throw error;
      }

      try {
        originalRequest._retry = true;
        // BUG FIX #13: Limit retries to max 2 to prevent infinite loops
        const retryCount = (originalRequest._retryCount || 0) + 1;
        if (retryCount > 2) {
          throw error;  // Give up after 2 retries
        }
        originalRequest._retryCount = retryCount;
        const session = await refreshSession();
        boundStore.dispatch(
          setSession({
            user: session.user,
            refreshToken: session.refresh_token,
            accessTokenExpiresAt: session.expires_at,
            accessToken: session.access_token,
          }),
        );
        // Retry original request — access token will be added by the request interceptor
        return await httpClient(originalRequest);
      } catch (refreshError) {
        boundStore.dispatch(clearSession());
        boundStore.dispatch(finishHydration());
        throw refreshError;
      }
    },
  );
}

export async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await refreshClient.post("/api/auth/refresh");
      return response.data;
    })()
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export default httpClient;
