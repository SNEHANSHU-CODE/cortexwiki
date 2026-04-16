import axios from "axios";
import { clearSession, finishHydration, setSession } from "../redux/slices/authSlice";

const baseURL = import.meta.env.VITE_API_BASE_URL || "";

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

  httpClient.interceptors.request.use((config) => {
    const token = boundStore.getState().auth.accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

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
        const session = await refreshSession();
        boundStore.dispatch(
          setSession({
            accessToken: session.access_token,
            user: session.user,
            expiresAt: session.expires_at,
          }),
        );
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${session.access_token}`;
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
    refreshPromise = refreshClient
      .post("/api/auth/refresh")
      .then((response) => response.data)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export default httpClient;
