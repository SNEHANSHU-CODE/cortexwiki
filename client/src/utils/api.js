import httpClient, { refreshSession } from "../services/http";

// ── Auth ──────────────────────────────────────────────────────────────────
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
  return refreshSession();
}

// ── Wikis ─────────────────────────────────────────────────────────────────
export async function fetchWikis() {
  const { data } = await httpClient.get("/api/wikis");
  return data;
}

export async function fetchWikiDetail(wikiId) {
  const { data } = await httpClient.get(`/api/wikis/${wikiId}`);
  return data;
}

export async function fetchCreateWiki(payload) {
  const { data } = await httpClient.post("/api/wikis", payload);
  return data;
}

export async function fetchUpdateWiki(wikiId, payload) {
  const { data } = await httpClient.patch(`/api/wikis/${wikiId}`, payload);
  return data;
}

export async function fetchDeleteWiki(wikiId) {
  // DELETE /api/wikis/:id returns 204 No Content — no .data to destructure
  await httpClient.delete(`/api/wikis/${wikiId}`);
}

// ── Ingest ────────────────────────────────────────────────────────────────
export async function ingestYouTube(url, wikiId) {
  const { data } = await httpClient.post("/api/ingest/youtube", {
    url,
    wiki_id: wikiId,
  });
  return data;
}

export async function ingestWeb(url, wikiId) {
  const { data } = await httpClient.post("/api/ingest/web", {
    url,
    wiki_id: wikiId,
  });
  return data;
}

export async function ingestPDF(file, wikiId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("wiki_id", wikiId);
  const { data } = await httpClient.post("/api/ingest/pdf", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function submitFallbackIngest({ url, wikiId, content, type }) {
  const { data } = await httpClient.post("/api/ingest/fallback", {
    url,
    wiki_id: wikiId,
    content,
    type,
  });
  return data;
}

export async function fetchIngestionHistory(wikiId) {
  const { data } = await httpClient.get("/api/ingest/history", {
    params: wikiId ? { wiki_id: wikiId } : undefined,
  });
  return data;
}

export async function fetchDeleteIngestedPage(pageId) {
  await httpClient.delete(`/api/ingest/pages/${pageId}`);
}

// ── Query ─────────────────────────────────────────────────────────────────
export async function queryKnowledge(payload, config = {}) {
  const { data } = await httpClient.post("/api/query", payload, config);
  return data;
}

// ── Graph ─────────────────────────────────────────────────────────────────
export async function fetchKnowledgeGraph(wikiId, topic = "", config = {}) {
  const { data } = await httpClient.get("/api/graph", {
    ...config,
    params: { wiki_id: wikiId, topic },
  });
  return data;
}