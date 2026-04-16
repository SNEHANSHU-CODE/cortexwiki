import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  messages: [],
  pendingMessageId: null,
  status: "idle",           // idle | streaming | error
  error: null,
  connectionState: "fallback", // connected | fallback | disconnected
};

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    addUserMessage(state, action) {
      state.messages.push(action.payload);
      state.error = null;
    },

    startAssistantMessage(state, action) {
      const { id, createdAt } = action.payload;
      // Guard: never create a duplicate placeholder
      if (!state.messages.find((m) => m.id === id)) {
        state.messages.push({
          id,
          role: "assistant",
          content: "",
          status: "streaming",
          createdAt,
          metadata: null,
        });
      }
      state.pendingMessageId = id;
      state.status = "streaming";
      state.error = null;
    },

    appendAssistantChunk(state, action) {
      const { id, chunk } = action.payload;
      if (!chunk) return;
      const message = state.messages.find((m) => m.id === id);
      if (message) {
        message.content += chunk;
        message.status = "streaming";
      }
    },

    finishAssistantMessage(state, action) {
      const { id, content, metadata } = action.payload;
      const message = state.messages.find((m) => m.id === id);
      if (message) {
        if (content != null) message.content = content;
        message.status   = "complete";
        message.metadata = metadata ?? null;
      }
      state.pendingMessageId = null;
      state.status = "idle";
    },

    failAssistantMessage(state, action) {
      const { id, content, metadata, error } = action.payload;
      const message = state.messages.find((m) => m.id === id);
      if (message) {
        if (content) message.content = content;
        message.status   = "error";
        message.metadata = metadata ?? null;
      }
      state.error            = error || "Unable to complete this response.";
      state.pendingMessageId = null;
      state.status           = "error";
    },

    setChatError(state, action) {
      state.error            = action.payload;
      state.pendingMessageId = null;
      state.status           = "error";
    },

    clearChatError(state) {
      state.error  = null;
      state.status = "idle";
    },

    setConnectionState(state, action) {
      state.connectionState = action.payload;
    },

    clearMessages(state) {
      // Preserve connectionState across resets
      const connectionState = state.connectionState;
      Object.assign(state, { ...initialState, connectionState });
    },
  },
});

export const {
  addUserMessage,
  appendAssistantChunk,
  clearChatError,
  clearMessages,
  failAssistantMessage,
  finishAssistantMessage,
  setConnectionState,
  setChatError,
  startAssistantMessage,
} = chatSlice.actions;

export default chatSlice.reducer;