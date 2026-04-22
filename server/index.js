import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const app = express();
const upload = multer({ dest: path.join(rootDir, ".tmp_uploads") });
const port = Number(process.env.PORT || 8787);
const widgetSessionTokens = new Map();
const demoVoiceSessionTokens = new Map();

app.use(express.json({ limit: "2mb" }));
app.use(corsForConfiguredOrigins);

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode: process.env.NODE_ENV || "development",
    kollectgptConfigured: Boolean(process.env.KOLLECTGPT_API_URL && process.env.KOLLECTGPT_API_KEY),
    voicebotConfigured: isVoiceBotConfigured()
  });
});

app.post("/api/kollectgpt/chat", async (request, response) => {
  const { sessionId, messages = [] } = request.body || {};
  const userMessage = getLatestUserMessage(messages);

  if (!process.env.KOLLECTGPT_API_URL || !process.env.KOLLECTGPT_API_KEY) {
    return response.json({
      reply: mockKollectGptReply(messages),
      mocked: true,
      sessionId
    });
  }

  try {
    const upstream = await fetch(resolveKollectGptChatUrl(), {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.KOLLECTGPT_TIMEOUT_MS || 180000)),
      headers: {
        Authorization: `Bearer ${process.env.KOLLECTGPT_API_KEY}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cleanObject({
        message: userMessage,
        session_id: isUuid(sessionId) ? sessionId : undefined,
        think_enabled: false,
        web_search_enabled: false
      }))
    });

    const data = await readKollectGptResponse(upstream);
    if (!upstream.ok) {
      return response.status(upstream.status).json({
        error: data.error || `KollectGPT upstream returned ${upstream.status}`,
        message: data.error || data.message || `KollectGPT upstream returned ${upstream.status}`,
        raw: data
      });
    }

    response.status(upstream.ok ? 200 : upstream.status).json({
      reply: extractText(data),
      sessionId: data.sessionId || sessionId,
      raw: data
    });
  } catch (error) {
    response.status(502).json({
      error: "KollectGPT upstream request failed",
      message: error.message
    });
  }
});

app.post("/api/kollectgpt/chat/stream", async (request, response) => {
  const { sessionId, messages = [] } = request.body || {};
  const userMessage = getLatestUserMessage(messages);

  startSse(response);

  if (!process.env.KOLLECTGPT_API_URL || !process.env.KOLLECTGPT_API_KEY) {
    await streamMockKollectGptResponse({
      response,
      reply: mockKollectGptReply(messages),
      sessionId: sessionId || `mock_${cryptoRandom()}`
    });
    return;
  }

  try {
    const upstream = await fetch(resolveKollectGptChatUrl(), {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.KOLLECTGPT_TIMEOUT_MS || 180000)),
      headers: {
        Authorization: `Bearer ${process.env.KOLLECTGPT_API_KEY}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cleanObject({
        message: userMessage,
        session_id: isUuid(sessionId) ? sessionId : undefined,
        think_enabled: false,
        web_search_enabled: false
      }))
    });

    await streamKollectGptResponse({
      upstream,
      response,
      fallbackSessionId: sessionId
    });
  } catch (error) {
    sendSseEvent(response, "error", {
      message: "KollectGPT upstream request failed",
      detail: error.message
    });
    sendSseEvent(response, "final", {
      reply: "",
      sessionId
    });
    response.end();
  }
});

app.post("/api/voicebot/session", async (_request, response) => {
  if (isPublicDemoVoiceBot()) {
    return response.json({
      sessionId: `voice_demo_${cryptoRandom()}`,
      greeting: "Live voice demo is ready. Start a call to connect to VoiceBot.",
      voiceOnly: true,
      publicDemoVoice: true
    });
  }

  if (isPublicWidgetVoiceBot()) {
    try {
      const session = await startPublicWidgetTextSession({});
      return response.json({
        sessionId: session.session_id,
        greeting: session.greeting,
        history: session.history || [],
        support: session.support || null,
        publicWidget: true
      });
    } catch (error) {
      return response.status(502).json({
        error: "VoiceBot public widget session request failed",
        message: error.message
      });
    }
  }

  if (!process.env.VOICEBOT_API_URL || !process.env.VOICEBOT_API_KEY) {
    return response.json({
      sessionId: `voice_mock_${cryptoRandom()}`,
      mocked: true
    });
  }

  try {
    const upstream = await fetch(joinUrl(process.env.VOICEBOT_API_URL, "/session"), {
      method: "POST",
      headers: voicebotHeaders(),
      body: JSON.stringify({
        agentId: process.env.VOICEBOT_AGENT_ID || undefined
      })
    });
    const data = await readUpstreamJson(upstream);

    response.status(upstream.ok ? 200 : upstream.status).json({
      sessionId: data.sessionId || data.id || data.conversationId,
      raw: data
    });
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot session request failed",
      message: error.message
    });
  }
});

app.post("/api/voicebot/message", async (request, response) => {
  const { sessionId, text } = request.body || {};

  if (isPublicDemoVoiceBot()) {
    return response.status(400).json({
      error: "Text fallback is not available in public demo voice mode",
      message: "This VoiceBot deployment supports live voice sessions only. Start a call to continue.",
      sessionId
    });
  }

  if (isPublicWidgetVoiceBot()) {
    try {
      const token = widgetSessionTokens.get(sessionId) || (await bootstrapPublicWidget()).embedToken;
      const data = await publicWidgetFetch("/text/message", {
        token,
        body: {
          session_id: sessionId,
          user_text: text
        }
      });

      if (data.session_id && token) {
        widgetSessionTokens.set(data.session_id, token);
      }

      return response.json({
        sessionId: data.session_id || sessionId,
        reply: data.reply_text || extractText(data),
        raw: data,
        publicWidget: true
      });
    } catch (error) {
      return response.status(502).json({
        error: "VoiceBot public widget message request failed",
        message: error.message
      });
    }
  }

  if (!process.env.VOICEBOT_API_URL || !process.env.VOICEBOT_API_KEY) {
    return response.json({
      reply: mockVoiceBotReply(text),
      mocked: true,
      sessionId
    });
  }

  try {
    const upstream = await fetch(joinUrl(process.env.VOICEBOT_API_URL, "/message"), {
      method: "POST",
      headers: voicebotHeaders(),
      body: JSON.stringify({
        sessionId,
        text,
        agentId: process.env.VOICEBOT_AGENT_ID || undefined
      })
    });
    const data = await readUpstreamJson(upstream);

    response.status(upstream.ok ? 200 : upstream.status).json({
      reply: extractText(data),
      transcript: data.transcript,
      audioUrl: data.audioUrl || data.audio_url,
      raw: data
    });
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot message request failed",
      message: error.message
    });
  }
});

app.post("/api/voicebot/audio", upload.single("audio"), async (request, response) => {
  const sessionId = request.body?.sessionId;

  if (isPublicWidgetVoiceBot()) {
    cleanupUpload(request.file);
    return response.status(400).json({
      error: "Recorded audio upload is not used by the public widget integration",
      message: "Use the embedded VoiceBot widget on the demo page for live microphone/WebRTC voice sessions.",
      sessionId
    });
  }

  if (!process.env.VOICEBOT_API_URL || !process.env.VOICEBOT_API_KEY) {
    cleanupUpload(request.file);
    return response.json({
      reply: "I received the audio sample. In live mode I would transcribe it, continue the call flow, and return the spoken response.",
      mocked: true,
      sessionId
    });
  }

  try {
    const audioBuffer = fs.readFileSync(request.file.path);
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("agentId", process.env.VOICEBOT_AGENT_ID || "");
    formData.append(
      "audio",
      new Blob([audioBuffer], { type: request.file.mimetype || "audio/webm" }),
      request.file.originalname || "voice-demo.webm"
    );

    const upstream = await fetch(joinUrl(process.env.VOICEBOT_API_URL, "/audio"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOICEBOT_API_KEY}`
      },
      body: formData
    });
    const data = await readUpstreamJson(upstream);

    response.status(upstream.ok ? 200 : upstream.status).json({
      reply: extractText(data),
      transcript: data.transcript,
      audioUrl: data.audioUrl || data.audio_url,
      raw: data
    });
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot audio request failed",
      message: error.message
    });
  } finally {
    cleanupUpload(request.file);
  }
});

app.post("/api/voicebot/webrtc/offer", async (request, response) => {
  if (isPublicDemoVoiceBot()) {
    if (!process.env.VOICEBOT_API_URL || !process.env.VOICEBOT_DEMO_KEY) {
      return response.status(400).json({
        error: "VoiceBot public demo voice integration is not configured",
        message: "Set VOICEBOT_API_URL and VOICEBOT_DEMO_KEY in .env."
      });
    }

    try {
      const body = request.body || {};
      const requestedSessionId = String(body.session_id || body.sessionId || "").trim();
      const bootstrap = await bootstrapPublicDemoVoice();
      const token = demoVoiceSessionTokens.get(requestedSessionId) || bootstrap.demoToken;
      const payload = await publicDemoVoiceFetch("/webrtc/offer", {
        token,
        sessionId: requestedSessionId,
        body: {
          ...body,
          session_id: requestedSessionId || body.session_id,
          client_surface: "public_demo_voice",
          privacy_notice_accepted: true,
          recording_consent_resolved: true,
          recording_consent_granted: false
        }
      });

      const sessionId = String(payload.session_id || requestedSessionId || "").trim();
      if (sessionId && token) {
        demoVoiceSessionTokens.set(sessionId, token);
      }
      if (requestedSessionId && token) {
        demoVoiceSessionTokens.set(requestedSessionId, token);
      }

      response.json(payload);
    } catch (error) {
      response.status(502).json({
        error: "VoiceBot demo voice offer request failed",
        message: error.message
      });
    }
    return;
  }

  if (!isPublicWidgetVoiceBot()) {
    return response.status(400).json({
      error: "Native WebRTC demo requires VOICEBOT_INTEGRATION_MODE=public_widget"
    });
  }

  if (!process.env.VOICEBOT_API_URL || !process.env.VOICEBOT_WIDGET_KEY) {
    return response.status(400).json({
      error: "VoiceBot public widget integration is not configured",
      message: "Set VOICEBOT_API_URL and VOICEBOT_WIDGET_KEY in DEMO_WEBSITE/.env."
    });
  }

  try {
    const body = request.body || {};
    const requestedSessionId = String(body.session_id || body.sessionId || "").trim();
    const bootstrap = await bootstrapPublicWidget();
    const token = widgetSessionTokens.get(requestedSessionId) || bootstrap.embedToken;
    const payload = await publicWidgetFetch("/webrtc/offer", {
      token,
      body: {
        ...body,
        session_id: requestedSessionId || body.session_id,
        client_surface: "public_widget"
      },
      extraHeaders: requestedSessionId ? { "X-Voice-Session-ID": requestedSessionId } : {}
    });

    const sessionId = String(payload.session_id || requestedSessionId || "").trim();
    if (sessionId && token) {
      widgetSessionTokens.set(sessionId, token);
    }
    if (requestedSessionId && token) {
      widgetSessionTokens.set(requestedSessionId, token);
    }

    response.json(payload);
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot WebRTC offer request failed",
      message: error.message
    });
  }
});

app.post("/api/voicebot/webrtc/candidate", async (request, response) => {
  if (isPublicDemoVoiceBot()) {
    try {
      const body = request.body || {};
      const sessionId = String(body.session_id || body.sessionId || "").trim();
      const token = demoVoiceSessionTokens.get(sessionId) || (await bootstrapPublicDemoVoice()).demoToken;
      const payload = await publicDemoVoiceFetch("/webrtc/candidate", {
        token,
        sessionId,
        body: {
          session_id: sessionId,
          candidate: body.candidate
        }
      });

      if (sessionId && token) {
        demoVoiceSessionTokens.set(sessionId, token);
      }

      response.json(payload);
    } catch (error) {
      response.status(502).json({
        error: "VoiceBot demo voice ICE candidate request failed",
        message: error.message
      });
    }
    return;
  }

  if (!isPublicWidgetVoiceBot()) {
    return response.status(400).json({
      error: "Native WebRTC demo requires VOICEBOT_INTEGRATION_MODE=public_widget"
    });
  }

  try {
    const body = request.body || {};
    const sessionId = String(body.session_id || body.sessionId || "").trim();
    const token = widgetSessionTokens.get(sessionId) || (await bootstrapPublicWidget()).embedToken;
    const payload = await publicWidgetFetch("/webrtc/candidate", {
      token,
      body: {
        session_id: sessionId,
        candidate: body.candidate
      },
      extraHeaders: sessionId ? { "X-Voice-Session-ID": sessionId } : {}
    });

    if (sessionId && token) {
      widgetSessionTokens.set(sessionId, token);
    }

    response.json(payload);
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot ICE candidate request failed",
      message: error.message
    });
  }
});

app.post("/api/voicebot/end-session", async (request, response) => {
  if (isPublicDemoVoiceBot()) {
    try {
      const sessionId = String(request.body?.session_id || request.body?.sessionId || "").trim();
      if (!sessionId) {
        return response.status(400).json({ error: "session_id is required" });
      }

      const token = demoVoiceSessionTokens.get(sessionId) || (await bootstrapPublicDemoVoice()).demoToken;
      const payload = await publicDemoVoiceFetch("/end-session", {
        token,
        sessionId,
        body: { session_id: sessionId }
      });
      demoVoiceSessionTokens.delete(sessionId);
      response.json(payload);
    } catch (error) {
      response.status(502).json({
        error: "VoiceBot demo voice end-session request failed",
        message: error.message
      });
    }
    return;
  }

  if (!isPublicWidgetVoiceBot()) {
    return response.json({ ok: true, mocked: true });
  }

  try {
    const sessionId = String(request.body?.session_id || request.body?.sessionId || "").trim();
    if (!sessionId) {
      return response.status(400).json({ error: "session_id is required" });
    }

    const token = widgetSessionTokens.get(sessionId) || (await bootstrapPublicWidget()).embedToken;
    const payload = await publicWidgetFetch("/end-session", {
      token,
      body: { session_id: sessionId },
      extraHeaders: { "X-Voice-Session-ID": sessionId }
    });
    widgetSessionTokens.delete(sessionId);
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      error: "VoiceBot end-session request failed",
      message: error.message
    });
  }
});

app.get("/api/voicebot/config", async (_request, response) => {
  if (isPublicDemoVoiceBot()) {
    const configuredByEnv = Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_DEMO_KEY);

    let bootstrapError = "";
    let iceServers = [];
    let connectionReady = configuredByEnv;

    if (configuredByEnv) {
      try {
        const bootstrap = await bootstrapPublicDemoVoice();
        iceServers = bootstrap.iceServers || [];
      } catch (error) {
        connectionReady = false;
        bootstrapError = error.message;
      }
    }

    return response.json({
      mode: process.env.VOICEBOT_INTEGRATION_MODE || "generic",
      configured: configuredByEnv,
      connectionReady,
      bootstrapError,
      publicWidget: false,
      publicDemoVoice: true,
      voiceOnly: true,
      widgetUrl: "",
      nativeVoice: true,
      apiBaseUrl: process.env.VOICEBOT_API_URL || "",
      environment: publicDemoVoiceEnvironment(),
      origin: publicDemoVoiceOrigin(),
      iceServers
    });
  }

  response.json({
    mode: process.env.VOICEBOT_INTEGRATION_MODE || "generic",
    configured: isPublicWidgetVoiceBot()
      ? Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_WIDGET_KEY)
      : Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_API_KEY),
    connectionReady: true,
    bootstrapError: "",
    publicWidget: isPublicWidgetVoiceBot(),
    publicDemoVoice: false,
    voiceOnly: false,
    widgetUrl: isPublicWidgetVoiceBot() ? buildPublicWidgetUrl() : "",
    nativeVoice: isPublicWidgetVoiceBot(),
    apiBaseUrl: process.env.VOICEBOT_API_URL || "",
    environment: process.env.VOICEBOT_WIDGET_ENVIRONMENT || "development",
    origin: process.env.VOICEBOT_WIDGET_ORIGIN || "",
    iceServers: []
  });
});

const distDir = path.join(rootDir, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api")) return next();
    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Kollect demo server running on http://localhost:${port}`);
});

function corsForConfiguredOrigins(request, response, next) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.origin;

  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
}

async function readUpstreamJson(upstream) {
  const text = await upstream.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function readKollectGptResponse(upstream) {
  const contentType = upstream.headers.get("content-type") || "";
  const text = await readResponseTextLenient(upstream);

  if (!contentType.includes("text/event-stream")) {
    const data = parseJsonOrText(text);
    if (!upstream.ok) {
      return {
        error: data.error || data.message || `KollectGPT upstream returned ${upstream.status}`,
        text: extractText(data),
        raw: data
      };
    }
    return data;
  }

  return parseKollectGptSse(text);
}

async function readResponseTextLenient(upstream) {
  if (!upstream.body?.getReader) {
    return upstream.text();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    text += decoder.decode();
    if (!text.trim()) {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}

function parseKollectGptSse(text = "") {
  const events = [];
  const tokens = [];
  let sessionId = "";
  let metadata = null;
  let error = null;

  for (const frame of text.split(/\r?\n\r?\n/)) {
    if (!frame.trim()) continue;

    let event = "message";
    const dataLines = [];

    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    const rawData = dataLines.join("\n");
    const data = parseJsonOrText(rawData);
    events.push({ event, data });

    if (event === "session" && data?.session_id) {
      sessionId = data.session_id;
    }
    if (event === "token" && data?.content) {
      tokens.push(data.content);
    }
    if (event === "metadata") {
      metadata = data;
    }
    if (event === "error") {
      error = data;
    }
  }

  const content = tokens.join("").trim() || String(metadata?.content || "").trim();

  return {
    reply: content || extractText(error) || "KollectGPT finished without returning a message.",
    sessionId,
    metadata,
    events,
    error
  };
}

async function streamKollectGptResponse({ upstream, response, fallbackSessionId = "" }) {
  const contentType = upstream.headers.get("content-type") || "";
  let sessionId = String(fallbackSessionId || "").trim();
  let reply = "";
  let metadata = null;
  let errorPayload = null;

  if (!contentType.includes("text/event-stream")) {
    const text = await readResponseTextLenient(upstream);
    const data = parseJsonOrText(text);
    sessionId = String(data.sessionId || data.session_id || sessionId || "").trim();
    errorPayload = upstream.ok
      ? null
      : {
          message: data.error || data.message || `KollectGPT upstream returned ${upstream.status}`
        };
    reply = upstream.ok ? String(extractText(data) || "").trim() : "";
  } else if (!upstream.body?.getReader) {
    const text = await readResponseTextLenient(upstream);
    const data = parseKollectGptSse(text);
    sessionId = String(data.sessionId || sessionId || "").trim();
    reply = data.error ? "" : String(data.reply || "").trim();
    metadata = data.metadata || null;
    errorPayload = data.error || null;
  } else {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

          while (buffer.includes("\n\n")) {
            const frameEnd = buffer.indexOf("\n\n");
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);

            const parsed = parseSseFrame(frame);
            if (!parsed) continue;

            const nextSessionId = String(parsed.data?.session_id || "").trim();
            if (nextSessionId) {
              sessionId = nextSessionId;
              sendSseEvent(response, "session", { sessionId });
            }

            if (parsed.event === "token" && parsed.data?.content) {
              const delta = String(parsed.data.content);
              reply += delta;
              sendSseEvent(response, "token", {
                delta,
                reply
              });
            }

            if (parsed.event === "task_status") {
              sendSseEvent(response, "task_status", parsed.data || {});
            }

            if (parsed.event === "heartbeat") {
              sendSseEvent(response, "heartbeat", parsed.data || {});
            }

            if (parsed.event === "metadata") {
              metadata = parsed.data;
            }

            if (parsed.event === "error") {
              errorPayload = parsed.data || { message: "KollectGPT upstream returned an error event" };
              sendSseEvent(response, "error", errorPayload);
            }
          }
        }
      } catch (error) {
        errorPayload = errorPayload || {
          message: error.message || "KollectGPT stream was interrupted"
        };
        sendSseEvent(response, "error", errorPayload);
      }

      buffer += decoder.decode().replace(/\r\n/g, "\n");
      const tail = parseSseFrame(buffer.trim());
      if (tail) {
        const nextSessionId = String(tail.data?.session_id || "").trim();
        if (nextSessionId) {
          sessionId = nextSessionId;
          sendSseEvent(response, "session", { sessionId });
        }
        if (tail.event === "token" && tail.data?.content) {
          const delta = String(tail.data.content);
          reply += delta;
          sendSseEvent(response, "token", {
            delta,
            reply
          });
        }
        if (tail.event === "task_status") {
          sendSseEvent(response, "task_status", tail.data || {});
        }
        if (tail.event === "heartbeat") {
          sendSseEvent(response, "heartbeat", tail.data || {});
        }
        if (tail.event === "metadata") {
          metadata = tail.data;
        }
        if (tail.event === "error") {
          errorPayload = tail.data || { message: "KollectGPT upstream returned an error event" };
          sendSseEvent(response, "error", errorPayload);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (!reply && metadata?.content && !errorPayload) {
    reply = String(metadata.content).trim();
  }

  if (!upstream.ok && !errorPayload) {
    errorPayload = { message: `KollectGPT upstream returned ${upstream.status}` };
    sendSseEvent(response, "error", errorPayload);
  }

  if (sessionId) {
    sendSseEvent(response, "session", { sessionId });
  }
  sendSseEvent(response, "final", {
    reply,
    sessionId,
    metadata,
    error: errorPayload
  });
  response.end();
}

function startSse(response) {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();
}

function sendSseEvent(response, event, payload) {
  if (response.writableEnded) return;
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload || {})}\n\n`);
}

function parseSseFrame(frame = "") {
  const trimmed = String(frame || "").trim();
  if (!trimmed) return null;

  let event = "message";
  const dataLines = [];

  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    event,
    data: parseJsonOrText(dataLines.join("\n"))
  };
}

async function streamMockKollectGptResponse({ response, reply, sessionId }) {
  sendSseEvent(response, "session", { sessionId });

  const tokens = String(reply || "")
    .split(/(\s+)/)
    .filter(Boolean);

  let combined = "";
  for (const token of tokens) {
    combined += token;
    sendSseEvent(response, "token", {
      delta: token,
      reply: combined
    });
    await wait(28);
  }

  sendSseEvent(response, "final", {
    reply: combined,
    sessionId,
    mocked: true
  });
  response.end();
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function parseJsonOrText(text = "") {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function extractText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;

  return (
    data.reply ||
    data.content ||
    data.message ||
    data.answer ||
    data.response ||
    data.output_text ||
    data.text ||
    data?.choices?.[0]?.message?.content ||
    data?.data?.reply ||
    "The upstream service returned a response without a recognized text field."
  );
}

function voicebotHeaders() {
  return {
    Authorization: `Bearer ${process.env.VOICEBOT_API_KEY}`,
    "Content-Type": "application/json"
  };
}

function resolveKollectGptChatUrl() {
  const configured = String(process.env.KOLLECTGPT_API_URL || "").trim();
  const chatPath = String(process.env.KOLLECTGPT_CHAT_PATH || "").trim();

  if (chatPath) {
    return joinUrl(configured, chatPath);
  }

  const url = new URL(configured);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (!pathname || pathname === "/") {
    url.pathname = "/api/chat";
  } else if (pathname === "/api") {
    url.pathname = "/api/chat";
  }

  return url.toString();
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function getLatestUserMessage(messages = []) {
  const lastUserMessage = [...messages].reverse().find((message) => message?.role === "user");
  return String(lastUserMessage?.content || "").trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 12);
}

function cleanupUpload(file) {
  if (!file?.path) return;
  fs.promises.unlink(file.path).catch(() => {});
}

function isPublicWidgetVoiceBot() {
  return String(process.env.VOICEBOT_INTEGRATION_MODE || "").trim().toLowerCase() === "public_widget";
}

function isPublicDemoVoiceBot() {
  return String(process.env.VOICEBOT_INTEGRATION_MODE || "").trim().toLowerCase() === "public_demo_voice";
}

function isVoiceBotConfigured() {
  if (isPublicDemoVoiceBot()) {
    return Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_DEMO_KEY);
  }

  return isPublicWidgetVoiceBot()
    ? Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_WIDGET_KEY)
    : Boolean(process.env.VOICEBOT_API_URL && process.env.VOICEBOT_API_KEY);
}

function publicWidgetApiBase() {
  return String(process.env.VOICEBOT_API_URL || "").replace(/\/+$/, "");
}

function publicWidgetOrigin() {
  return String(process.env.VOICEBOT_WIDGET_ORIGIN || "http://localhost:5177").trim();
}

function publicDemoVoiceOrigin() {
  return String(process.env.VOICEBOT_DEMO_ORIGIN || process.env.VOICEBOT_WIDGET_ORIGIN || "http://localhost:5177").trim();
}

function publicDemoVoiceEnvironment() {
  return String(process.env.VOICEBOT_DEMO_ENVIRONMENT || "development").trim() || "development";
}

function publicWidgetPageUrl() {
  return String(process.env.VOICEBOT_PAGE_URL || `${publicWidgetOrigin()}/voicebot`).trim();
}

function publicWidgetApiRoot() {
  const base = publicWidgetApiBase();
  return base.endsWith("/public/widget") ? base.slice(0, -"/public/widget".length) : base;
}

function buildPublicWidgetUrl() {
  const frameUrl = String(process.env.VOICEBOT_WIDGET_FRAME_URL || "").trim();
  if (!frameUrl || !process.env.VOICEBOT_WIDGET_KEY) return "";

  const url = new URL(frameUrl);
  url.searchParams.set("widget_key", process.env.VOICEBOT_WIDGET_KEY);
  url.searchParams.set("environment", process.env.VOICEBOT_WIDGET_ENVIRONMENT || "development");
  url.searchParams.set("origin", publicWidgetOrigin());
  url.searchParams.set("page_url", publicWidgetPageUrl());
  url.searchParams.set("api_base_url", publicWidgetApiRoot());
  url.searchParams.set("preview", "false");
  url.searchParams.set(
    "overrides",
    JSON.stringify({
      defaultMode: process.env.VOICEBOT_MODE_PREFERENCE || "voice",
      botName: "Kollect VoiceBot",
      launcherStyle: "icon",
      launcherIcon: "microphone",
      primaryColor: "#151516",
      secondaryColor: "#F2B90F",
      headerColor: "#151516",
      showPoweredBy: false
    })
  );
  return url.toString();
}

async function bootstrapPublicWidget() {
  const data = await publicWidgetFetch("/bootstrap", {
    body: {
      widget_key: process.env.VOICEBOT_WIDGET_KEY,
      environment: process.env.VOICEBOT_WIDGET_ENVIRONMENT || "development",
      origin: publicWidgetOrigin(),
      page_url: publicWidgetPageUrl(),
      preview: false,
      mode_preference: process.env.VOICEBOT_MODE_PREFERENCE || "voice",
      overrides: {
        defaultMode: process.env.VOICEBOT_MODE_PREFERENCE || "voice"
      }
    },
    includeToken: false
  });

  return {
    embedToken: data.embed_token,
    raw: data
  };
}

async function bootstrapPublicDemoVoice() {
  const base = String(process.env.VOICEBOT_API_URL || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("VOICEBOT_API_URL is not configured");
  }
  if (!process.env.VOICEBOT_DEMO_KEY) {
    throw new Error("VOICEBOT_DEMO_KEY is not configured");
  }

  const upstream = await fetch(joinUrl(base, "/public/demo-voice/bootstrap"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Demo-Origin": publicDemoVoiceOrigin(),
      Origin: publicDemoVoiceOrigin(),
      Referer: `${publicDemoVoiceOrigin().replace(/\/+$/, "")}/`
    },
    body: JSON.stringify({
      demo_key: process.env.VOICEBOT_DEMO_KEY,
      environment: publicDemoVoiceEnvironment(),
      origin: publicDemoVoiceOrigin()
    })
  });
  const data = await readUpstreamJson(upstream);

  if (!upstream.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      data.message ||
      describeVoiceBotAccessFailure(upstream.status, "public demo voice bootstrap")
    );
  }

  return {
    demoToken: data.demo_token,
    iceServers: Array.isArray(data.ice_servers) ? data.ice_servers : [],
    raw: data
  };
}

async function startPublicWidgetTextSession({ sessionId } = {}) {
  const bootstrap = await bootstrapPublicWidget();
  const data = await publicWidgetFetch("/text/session", {
    token: bootstrap.embedToken,
    body: {
      session_id: sessionId || null,
      caller_id: `demo-${cryptoRandom()}`
    }
  });

  if (data.session_id && bootstrap.embedToken) {
    widgetSessionTokens.set(data.session_id, bootstrap.embedToken);
  }

  return data;
}

async function publicDemoVoiceFetch(pathname, { token = "", sessionId = "", body } = {}) {
  const base = String(process.env.VOICEBOT_API_URL || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("VOICEBOT_API_URL is not configured");
  }
  if (!token) {
    throw new Error("VoiceBot demo token is not available");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Demo-Token": token,
    "X-Demo-Origin": publicDemoVoiceOrigin(),
    Origin: publicDemoVoiceOrigin(),
    Referer: `${publicDemoVoiceOrigin().replace(/\/+$/, "")}/`
  };
  if (sessionId) {
    headers["X-Voice-Session-ID"] = sessionId;
  }

  const upstream = await fetch(joinUrl(base, `/public/demo-voice/${pathname.replace(/^\/+/, "")}`), {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await readUpstreamJson(upstream);

  if (!upstream.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      data.message ||
      describeVoiceBotAccessFailure(upstream.status, "public demo voice request")
    );
  }

  return data;
}

function describeVoiceBotAccessFailure(status, context) {
  if (status === 401) {
    return `VoiceBot denied the ${context}. Check the public endpoint and deployment access rules.`;
  }
  if (status === 403) {
    return `VoiceBot blocked the ${context}. Check that the demo key is valid and this exact origin is approved upstream.`;
  }
  return `VoiceBot upstream returned ${status}`;
}

async function publicWidgetFetch(pathname, { token = "", body, includeToken = true, extraHeaders = {} } = {}) {
  const base = publicWidgetApiBase();
  if (!base) {
    throw new Error("VOICEBOT_API_URL is not configured");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Widget-Origin": publicWidgetOrigin()
  };
  if (includeToken && token) {
    headers["X-Embed-Token"] = token;
  }
  Object.assign(headers, extraHeaders || {});

  const upstream = await fetch(joinUrl(base, pathname), {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await readUpstreamJson(upstream);

  if (!upstream.ok) {
    throw new Error(data.detail || data.error || data.message || `VoiceBot upstream returned ${upstream.status}`);
  }

  return data;
}

function mockKollectGptReply(messages) {
  const last = messages[messages.length - 1]?.content || "";

  if (/payment|reminder|promise/i.test(last)) {
    return "For a collections workflow, I would keep the tone respectful, confirm the customer's situation, offer clear payment options, and capture the next best action for the team.";
  }

  if (/automate|help|team/i.test(last)) {
    return "KollectGPT can assist with account summaries, response drafting, workflow guidance, knowledge lookup, and next-action recommendations for collections teams.";
  }

  return "This is mock demo mode. Once KOLLECTGPT_API_URL and KOLLECTGPT_API_KEY are set, this same chat surface will forward the conversation to the live KollectGPT service.";
}

function mockVoiceBotReply(text = "") {
  if (/hello|hi|hey/i.test(text)) {
    return "Hello. This is Kollect AI VoiceBot in demo mode. I can greet the customer, understand intent, and continue a structured conversation.";
  }

  if (/payment|pay|balance/i.test(text)) {
    return "I can help confirm payment intent, offer available options, and record the customer's preferred next step.";
  }

  return "VoiceBot demo mode is active. Connect VOICEBOT_API_URL and VOICEBOT_API_KEY to route this turn into the live voice automation service.";
}
