import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  fetchCreateWiki,
  fetchDeleteWiki,
  fetchUpdateWiki,
  fetchWikiDetail,
  fetchWikis,
} from "../../utils/api";
import { buildErrorMessage } from "../../utils/sliceUtils";

export const loadWikis = createAsyncThunk("wiki/loadWikis", async (_, { rejectWithValue }) => {
  try {
    const data = await fetchWikis();
    return data?.wikis ?? data ?? [];
  } catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to load wikis.")); }
});

export const createWiki = createAsyncThunk("wiki/createWiki", async ({ name, description = "" }, { rejectWithValue }) => {
  try { return await fetchCreateWiki({ name, description }); }
  catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to create wiki.")); }
});

export const deleteWiki = createAsyncThunk("wiki/deleteWiki", async (wikiId, { rejectWithValue }) => {
  try { await fetchDeleteWiki(wikiId); return wikiId; }
  catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to delete wiki.")); }
});

export const loadWikiDetail = createAsyncThunk("wiki/loadWikiDetail", async (wikiId, { rejectWithValue }) => {
  try { return await fetchWikiDetail(wikiId); }
  catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to load wiki.")); }
});

export const renameWiki = createAsyncThunk("wiki/renameWiki", async ({ wikiId, name, description }, { rejectWithValue }) => {
  try { return await fetchUpdateWiki(wikiId, { name, description }); }
  catch (e) { return rejectWithValue(buildErrorMessage(e, "Unable to update wiki.")); }
});

const initialState = {
  wikis:        [],
  activeWikiId: null,
  activeWiki:   null,
  listStatus:   "idle",
  detailStatus: "idle",
  createStatus: "idle",
  error:        null,
  rightView:    "note",
};

const wikiSlice = createSlice({
  name: "wiki",
  initialState,
  reducers: {
    setActiveWiki(state, action) {
      state.activeWikiId = action.payload;
      state.rightView    = "note";
      if (state.activeWiki?.id !== action.payload) state.activeWiki = null;
    },
    setRightView(state, action) { state.rightView = action.payload; },
    clearActiveWiki(state) {
      state.activeWikiId = null;
      state.activeWiki   = null;
      state.rightView    = "note";
    },
    clearWikiError(state) { state.error = null; },
    // Full reset on logout
    resetWikiState() { return initialState; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWikis.pending,   (s) => { s.listStatus = "loading"; s.error = null; })
      .addCase(loadWikis.fulfilled, (s, a) => {
        s.listStatus = "succeeded";
        s.wikis = a.payload;
        // If active wiki was deleted externally, clear it
        if (s.activeWikiId && !s.wikis.some((w) => w.id === s.activeWikiId)) {
          s.activeWikiId = null; s.activeWiki = null; s.rightView = "note";
        }
      })
      .addCase(loadWikis.rejected,  (s, a) => { s.listStatus = "failed"; s.error = a.payload; })

      .addCase(createWiki.pending,   (s) => { s.createStatus = "loading"; s.error = null; })
      .addCase(createWiki.fulfilled, (s, a) => {
        s.createStatus = "succeeded";
        s.wikis = [a.payload, ...s.wikis.filter((w) => w.id !== a.payload.id)];
        s.activeWikiId = a.payload.id;
        s.activeWiki   = a.payload;
        s.rightView    = "note";
      })
      .addCase(createWiki.rejected,  (s, a) => { s.createStatus = "failed"; s.error = a.payload; })

      .addCase(deleteWiki.fulfilled, (s, a) => {
        s.wikis = s.wikis.filter((w) => w.id !== a.payload);
        if (s.activeWikiId === a.payload) {
          s.activeWikiId = s.wikis[0]?.id ?? null;
          s.activeWiki   = s.wikis[0] ?? null;
          s.rightView    = "note";
        }
      })
      .addCase(deleteWiki.rejected, (s, a) => { s.error = a.payload; })

      .addCase(loadWikiDetail.pending,   (s) => { s.detailStatus = "loading"; })
      .addCase(loadWikiDetail.fulfilled, (s, a) => {
        s.detailStatus = "succeeded";
        s.activeWiki   = a.payload;
        s.wikis = s.wikis.map((w) => w.id === a.payload.id ? { ...w, ...a.payload } : w);
      })
      .addCase(loadWikiDetail.rejected,  (s, a) => { s.detailStatus = "failed"; s.error = a.payload; })

      .addCase(renameWiki.fulfilled, (s, a) => {
        s.wikis = s.wikis.map((w) => w.id === a.payload.id ? { ...w, ...a.payload } : w);
        if (s.activeWikiId === a.payload.id) s.activeWiki = { ...(s.activeWiki ?? {}), ...a.payload };
      })
      .addCase(renameWiki.rejected, (s, a) => { s.error = a.payload; });
  },
});

export const { setActiveWiki, setRightView, clearActiveWiki, clearWikiError, resetWikiState } = wikiSlice.actions;
export default wikiSlice.reducer;