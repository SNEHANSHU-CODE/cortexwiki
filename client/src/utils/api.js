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

export async function sendOtpRequest(payload) {
  const { data } = await httpClient.post("/api/auth/otp/send", payload);
  return data;
}

export async function checkOtpRequest(payload) {
  const { data } = await httpClient.post("/api/auth/otp/check", payload);
  return data;
}

export async function verifyOtpRequest(payload) {
  const { data } = await httpClient.post("/api/auth/otp/verify", payload);
  return data;
}

export async function resetPasswordRequest(payload) {
  const { data } = await httpClient.post("/api/auth/password-reset", payload);
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

export async function generateMCQ(wikiId) {
  const { data } = await httpClient.post(`/api/wikis/${wikiId}/mcq`);
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
export async function ingestYouTube(url, wikiId, batchId) {
  const { data } = await httpClient.post("/api/ingest/youtube", {
    url,
    wiki_id: wikiId,
    batch_id: batchId ?? null,
  });
  return data;
}

export async function ingestWeb(url, wikiId, batchId) {
  const { data } = await httpClient.post("/api/ingest/web", {
    url,
    wiki_id: wikiId,
    batch_id: batchId ?? null,
  });
  return data;
}

export async function ingestPDF(file, wikiId, batchId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("wiki_id", wikiId);
  if (batchId) formData.append("batch_id", batchId); // Only append if present — avoids sending "null"
  const { data } = await httpClient.post("/api/ingest/pdf", formData);
  return data;
}

export async function submitFallbackIngest({ url, wikiId, content, type, batchId }) {
  const { data } = await httpClient.post("/api/ingest/fallback", {
    url,
    wiki_id: wikiId,
    content,
    type,
    batch_id: batchId ?? null,
  });
  return data;
}

export async function fetchIngestionHistory(wikiId) {
  const { data } = await httpClient.get("/api/ingest/history", {
    params: wikiId ? { wiki_id: wikiId } : undefined,
  });
  return data;
}

export async function fetchUndoIngestion(wikiId, steps = 1) {
  const { data } = await httpClient.post(`/api/ingest/${wikiId}/undo`, null, { params: { steps } });
  return data;
}

export async function fetchPageByUrl(wikiId, url) {
  const { data } = await httpClient.get("/api/ingest/pages", {
    params: { wiki_id: wikiId, url },
  });
  return data;
}

// ── Query ─────────────────────────────────────────────────────────────────
export async function queryKnowledge(payload, config = {}) {
  const { data } = await httpClient.post("/api/query", payload, config);
  return data;
}

export async function fetchChatHistory(wikiId) {
  const { data } = await httpClient.get("/api/query/history", { params: { wiki_id: wikiId } });
  return data;
}

export async function deleteChatHistory(wikiId) {
  await httpClient.delete("/api/query/history", { params: { wiki_id: wikiId } });
}

// ── Graph ─────────────────────────────────────────────────────────────────
export async function fetchKnowledgeGraph(wikiId, topic = "", config = {}) {
  const { data } = await httpClient.get("/api/graph", {
    ...config,
    params: { wiki_id: wikiId, topic },
  });
  return data;
}

// ── Public Directory & Share ──────────────────────────────────────────────
export async function toggleWikiPublic(wikiId, isPublic) {
  const { data } = await httpClient.patch(`/api/wikis/${wikiId}/public`, { is_public: isPublic });
  return data;
}

export async function fetchPublicWikis(search = "", skip = 0, limit = 20, sortBy = "newest") {
  const { data } = await httpClient.get("/api/wikis/public", {
    params: { search, skip, limit, sort_by: sortBy },
  });
  return data;
}

export async function fetchPublicWikiBySlug(slug) {
  const { data } = await httpClient.get(`/api/wikis/public/${slug}`);
  return data;
}

export async function likePublicWiki(slug) {
  const { data } = await httpClient.post(`/api/wikis/public/${slug}/like`);
  return data;
}

export async function recordPublicWikiVisit(slug) {
  const { data } = await httpClient.post(`/api/wikis/public/${slug}/visit`);
  return data;
}