const baseUrl = process.env.DEMO_BASE_URL || "http://localhost:8787";

async function request(path, options = {}) {
  const { timeoutMs = 180000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {})
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}: ${data.message || data.error || text}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSseFrame(frame) {
  const clean = String(frame || "").trim();
  if (!clean) return null;

  let event = "message";
  const dataLines = [];
  for (const line of clean.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const dataText = dataLines.join("\n");
  return {
    event,
    data: dataText ? JSON.parse(dataText) : {}
  };
}

async function readKollectGptStream({ message, timeoutMs = 30000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/kollectgpt/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`/api/kollectgpt/chat/stream returned ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new Error("KollectGPT stream reader is not available");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let sessionId = "";
    let reply = "";
    let taskStatus = "";

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

        if (parsed.event === "session" && parsed.data?.sessionId) {
          sessionId = parsed.data.sessionId;
        }
        if (parsed.event === "token" && parsed.data?.reply) {
          reply = parsed.data.reply;
        }
        if (parsed.event === "task_status" && parsed.data?.status) {
          taskStatus = parsed.data.status;
        }
        if (parsed.event === "final") {
          return {
            sessionId: parsed.data?.sessionId || sessionId,
            reply: parsed.data?.reply || reply,
            taskStatus
          };
        }
      }
    }

    return { sessionId, reply, taskStatus };
  } finally {
    clearTimeout(timeout);
  }
}

function pass(label, detail = "") {
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
}

const config = await request("/api/voicebot/config");
if (!config.configured || !config.nativeVoice) {
  throw new Error(`VoiceBot config is not ready: ${JSON.stringify(config)}`);
}
pass("voicebot config", config.apiBaseUrl || "");

if (config.mode !== "public_demo_voice") {
  const session = await request("/api/voicebot/session", {
    method: "POST",
    body: JSON.stringify({})
  });
  if (!session.sessionId || !String(session.sessionId).startsWith("text-")) {
    throw new Error(`Text session did not return a text-* session id: ${JSON.stringify(session)}`);
  }
  pass("text session", session.sessionId);

  const message = await request("/api/voicebot/message", {
    method: "POST",
    body: JSON.stringify({
      sessionId: session.sessionId,
      text: "Hello, this is a demo smoke test. What can you help with?"
    })
  });
  if (!message.reply) {
    throw new Error(`Text message did not return a reply: ${JSON.stringify(message)}`);
  }
  pass("text message", message.reply.slice(0, 90));
} else {
  pass("text mode", "skipped because public_demo_voice is voice-only");
}

const badOffer = await fetch(`${baseUrl}/api/voicebot/webrtc/offer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sdp: "invalid-smoke-sdp",
    type: "offer",
    session_id: `webrtc_smoke_${Date.now()}`,
    caller_id: `smoke-${Date.now()}`
  })
});
const badOfferBody = await badOffer.text();
if (![400, 502].includes(badOffer.status)) {
  throw new Error(`Invalid WebRTC offer returned unexpected status ${badOffer.status}: ${badOfferBody}`);
}
if (!/Invalid SDP offer|VoiceBot WebRTC offer request failed|VoiceBot demo voice offer request failed|Invalid SDP/i.test(badOfferBody)) {
  throw new Error(`Invalid WebRTC offer failed with an unexpected body: ${badOfferBody}`);
}
pass("webrtc proxy reachable", `expected invalid SDP failure (${badOffer.status})`);

const health = await request("/api/health");
if (health.kollectgptConfigured) {
  const gpt = await readKollectGptStream({
    message: "Give me one short KollectGPT demo answer."
  });
  if (!gpt.sessionId && !gpt.taskStatus && !gpt.reply) {
    throw new Error(`KollectGPT stream did not return any useful progress: ${JSON.stringify(gpt)}`);
  }
  const detail = gpt.reply
    ? `${String(gpt.sessionId || "no-session").slice(0, 8)} - ${gpt.reply.slice(0, 90)}`
    : `status: ${gpt.taskStatus || "stream connected"}`;
  pass("kollectgpt chat", detail);
} else {
  pass("kollectgpt chat", "skipped because KOLLECTGPT_API_URL/API_KEY are not configured");
}

console.log("Smoke test finished.");
