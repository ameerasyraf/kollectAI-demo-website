async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data.error || data.message || "Request failed";
    throw new Error(message);
  }

  return data;
}

function parseSseFrame(frame) {
  const cleanFrame = String(frame || "").trim();
  if (!cleanFrame) return null;

  let event = "message";
  const dataLines = [];

  for (const line of cleanFrame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const dataText = dataLines.join("\n");
  return {
    event,
    data: parseSseData(dataText)
  };
}

function parseSseData(dataText) {
  if (!dataText) return {};
  try {
    return JSON.parse(dataText);
  } catch {
    return { text: dataText };
  }
}

export async function streamKollectGPTMessage({
  sessionId,
  messages,
  signal,
  onSession,
  onToken,
  onTaskStatus,
  onHeartbeat,
  onError,
  onFinal
}) {
  const response = await fetch("/api/kollectgpt/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sessionId, messages }),
    signal
  });

  if (!response.ok) {
    return parseResponse(response);
  }

  if (!response.body?.getReader) {
    const data = await parseResponse(response);
    onFinal?.(data);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = {
    reply: "",
    sessionId
  };

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

        if (parsed.event === "session" && parsed.data?.sessionId) {
          finalPayload = { ...finalPayload, sessionId: parsed.data.sessionId };
          onSession?.(parsed.data.sessionId);
        }

        if (parsed.event === "token") {
          const delta = String(parsed.data?.delta || "");
          finalPayload = {
            ...finalPayload,
            reply: String(parsed.data?.reply || finalPayload.reply || "")
          };
          onToken?.({
            delta,
            reply: finalPayload.reply
          });
        }

        if (parsed.event === "task_status") {
          finalPayload = {
            ...finalPayload,
            taskStatus: parsed.data || {}
          };
          onTaskStatus?.(parsed.data || {});
        }

        if (parsed.event === "heartbeat") {
          finalPayload = {
            ...finalPayload,
            heartbeat: parsed.data || {}
          };
          onHeartbeat?.(parsed.data || {});
        }

        if (parsed.event === "error" && parsed.data?.message) {
          finalPayload = {
            ...finalPayload,
            error: parsed.data
          };
          onError?.(parsed.data);
        }

        if (parsed.event === "final") {
          finalPayload = {
            ...finalPayload,
            ...parsed.data
          };
          onFinal?.(finalPayload);
        }
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    const tail = parseSseFrame(buffer.trim());
    if (tail?.event === "final") {
      finalPayload = {
        ...finalPayload,
        ...tail.data
      };
      onFinal?.(finalPayload);
    }
  } finally {
    reader.releaseLock();
  }

  if (finalPayload.error?.message && !finalPayload.reply) {
    throw new Error(finalPayload.error.message);
  }

  return finalPayload;
}

export async function getDemoHealth() {
  const response = await fetch("/api/health");
  return parseResponse(response);
}

export async function createVoiceSession() {
  const response = await fetch("/api/voicebot/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  return parseResponse(response);
}

export async function getVoiceConfig() {
  const response = await fetch("/api/voicebot/config");
  return parseResponse(response);
}

export async function sendVoiceText({ sessionId, text }) {
  const response = await fetch("/api/voicebot/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sessionId, text })
  });

  return parseResponse(response);
}

export async function sendVoiceOffer(payload) {
  const response = await fetch("/api/voicebot/webrtc/offer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseResponse(response);
}

export async function sendVoiceCandidate(payload) {
  const response = await fetch("/api/voicebot/webrtc/candidate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseResponse(response);
}

export async function endVoiceSession({ sessionId }) {
  const response = await fetch("/api/voicebot/end-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ session_id: sessionId })
  });

  return parseResponse(response);
}
