import httpClient, { refreshSession } from "../services/http";

export async function loginRequest(payload) {
  const { data } = await httpClient.post("/api/auth/login", payload);
  return data;
}

export async function registerRequest(payload) {
  const { data } = await httpClient.post("/api/auth/register", payload);
  return data;
}

export async function logoutRequest() {
  const { data } = await httpClient.post("/api/auth/logout");
  return data;
}

export async function getSessionFromRefresh() {
  const data = await refreshSession();
  return data;
}

export async function ingestYouTube(url) {
  const { data } = await httpClient.post("/api/ingest/youtube", { url });
  return data;
}

export async function ingestWeb(url) {
  const { data } = await httpClient.post("/api/ingest/web", { url });
  return data;
}

export async function fetchIngestionHistory() {
  const { data } = await httpClient.get("/api/ingest/history");
  return data;
}

export async function queryKnowledge(payload, config = {}) {
  const { data } = await httpClient.post("/api/query", payload, config);
  return data;
}

export async function fetchKnowledgeGraph(topic = "", config = {}) {
  const { data } = await httpClient.get("/api/graph", {
    ...config,
    params: { topic },
  });
  return data;
}
