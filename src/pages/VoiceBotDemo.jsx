import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { PageShell } from "../components/Shell.jsx";
import StatusPanel from "../components/StatusPanel.jsx";
import {
  createVoiceSession,
  endVoiceSession,
  getDemoHealth,
  getVoiceConfig,
  sendVoiceCandidate,
  sendVoiceOffer,
  sendVoiceText
} from "../lib/api.js";
import { createSessionId } from "../lib/session.js";

const DEFAULT_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
];

const LIVE_STATES = new Set(["connecting", "reconnecting", "connected", "listening", "speaking", "processing", "ending"]);

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function stateLabel(voiceState, fallbackStatus) {
  if (voiceState === "connecting") return "Connecting";
  if (voiceState === "reconnecting") return "Reconnecting";
  if (voiceState === "connected") return "Connected";
  if (voiceState === "listening") return "Listening";
  if (voiceState === "speaking") return "VoiceBot speaking";
  if (voiceState === "processing") return "Thinking";
  if (voiceState === "ending") return "Ending";
  if (voiceState === "failed") return "Voice unavailable";
  return fallbackStatus;
}

export default function VoiceBotDemo() {
  const fallbackSessionId = useMemo(() => createSessionId("voice"), []);
  const callerId = useMemo(() => `demo-${createSessionId("caller").slice(0, 28)}`, []);
  const [activeMode, setActiveMode] = useState("voice");
  const [sessionId, setSessionId] = useState(fallbackSessionId);
  const [status, setStatus] = useState("Ready");
  const [voiceState, setVoiceState] = useState("idle");
  const [isStarting, setIsStarting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);
  const [voiceConfig, setVoiceConfig] = useState(null);
  const [turns, setTurns] = useState([
    {
      speaker: "VoiceBot",
      text: "Hi, I am Kollect AI VoiceBot. Start a live call or type below to talk to the Kollect Systems bot."
    }
  ]);

  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const micStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const voiceSessionRef = useRef("");
  const transcriptRef = useRef(null);
  const timerRef = useRef(null);
  const aiDraftRef = useRef("");
  const reconnectAttemptedRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const manualStopRef = useRef(false);

  const isLive = LIVE_STATES.has(voiceState);
  const canStartLiveVoice = Boolean(
    voiceConfig?.configured &&
    voiceConfig?.nativeVoice &&
    voiceConfig?.connectionReady !== false
  );
  const isVoiceOnly = Boolean(voiceConfig?.voiceOnly);
  const browserVoiceReady =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof RTCPeerConnection !== "undefined";
  const iceServers = Array.isArray(voiceConfig?.iceServers) && voiceConfig.iceServers.length > 0
    ? voiceConfig.iceServers
    : DEFAULT_ICE_SERVERS;
  const displayStatus = stateLabel(voiceState, status);
  const modeStatus = activeMode === "voice" ? displayStatus : status === "Processing" ? "Thinking" : "Text mode";

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getDemoHealth().catch(() => null),
      getVoiceConfig().catch(() => null),
      createVoiceSession().catch(() => null)
    ]).then(([nextHealth, nextVoiceConfig, initialSession]) => {
      if (cancelled) return;

      setHealth(nextHealth);
      setVoiceConfig(nextVoiceConfig);

      if (initialSession?.sessionId) {
        setSessionId(initialSession.sessionId);
      }
      if (initialSession?.greeting) {
        setTurns([{ speaker: "VoiceBot", text: initialSession.greeting }]);
      } else if (!initialSession) {
        setStatus("Local demo mode");
      }
    });

    return () => {
      cancelled = true;
      clearReconnectTimer();
      manualStopRef.current = true;
      closeLocalVoice();
    };
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns]);

  function startClock() {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => {
      setCallSeconds((current) => current + 1);
    }, 1000);
  }

  function stopClock() {
    if (!timerRef.current) return;
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function clearReconnectTimer() {
    if (!reconnectTimerRef.current) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function appendTurn(speaker, text, meta = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    setTurns((current) => [...current, { speaker, text: cleanText, ...meta }]);
  }

  function upsertPartialTurn(speaker, text, meta = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    setTurns((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.speaker === speaker && last.partial) {
        next[next.length - 1] = { ...last, text: cleanText, ...meta };
      } else {
        next.push({ speaker, text: cleanText, partial: true, ...meta });
      }
      return next;
    });
  }

  function finalizeTurn(speaker, text, meta = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    setTurns((current) => [
      ...current.filter((turn) => !(turn.speaker === speaker && turn.partial)),
      { speaker, text: cleanText, ...meta }
    ]);
  }

  function handleDataMessage(payload) {
    const type = String(payload?.type || "").trim();
    const payloadSessionId = String(payload?.session_id || "").trim();
    if (payloadSessionId && voiceSessionRef.current && payloadSessionId !== voiceSessionRef.current) {
      return;
    }

    if (type === "vad.start") {
      setVoiceState("listening");
      return;
    }

    if (type === "vad.end") {
      setVoiceState("processing");
      return;
    }

    if (type === "transcript.partial") {
      setVoiceState("listening");
      upsertPartialTurn("You", payload.full_text || payload.text || payload.live_text || "");
      return;
    }

    if (type === "transcript.final" || type === "stt_final") {
      setVoiceState("processing");
      finalizeTurn("You", payload.text || "");
      return;
    }

    if (type === "ai_text_delta") {
      const next = payload.delta ? `${aiDraftRef.current}${payload.delta}` : payload.text || "";
      aiDraftRef.current = next;
      upsertPartialTurn("VoiceBot", next);
      return;
    }

    if (type === "ai_text_final") {
      aiDraftRef.current = "";
      finalizeTurn(
        String(payload.source || payload.role || "").toLowerCase() === "agent" ? "Agent" : "VoiceBot",
        payload.text || ""
      );
      return;
    }

    if (type === "tts.start") {
      setVoiceState("speaking");
      return;
    }

    if (type === "tts.stop") {
      setVoiceState("listening");
      return;
    }

    if (type === "handoff.waiting" || type === "handoff.claimed") {
      appendTurn("VoiceBot", payload.message || "A human handoff has been requested.");
      return;
    }

    if (type === "call.ending") {
      setVoiceState("ending");
      return;
    }

    if (type === "session.ended") {
      appendTurn("VoiceBot", payload.message || "The call has ended.");
      closeLocalVoice();
      setStatus("Call ended");
    }
  }

  function sendControl(payload) {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(payload));
    return true;
  }

  function scheduleReconnect(reason = "The live voice connection dropped.") {
    if (manualStopRef.current || activeMode !== "voice" || reconnectAttemptedRef.current) {
      return;
    }

    reconnectAttemptedRef.current = true;
    clearReconnectTimer();
    closeLocalVoice();
    setVoiceState("reconnecting");
    setStatus("Reconnecting");
    setError(`${reason} Trying one quick reconnect now.`);

    reconnectTimerRef.current = window.setTimeout(() => {
      startLiveCall({
        reconnect: true,
        preserveConversation: true,
        requestedSessionId: voiceSessionRef.current || sessionId || createSessionId("webrtc")
      });
    }, 1400);
  }

  async function switchMode(nextMode) {
    const normalizedMode = nextMode === "voice" ? "voice" : "text";
    if (normalizedMode === activeMode) return;
    if (normalizedMode === "text" && isVoiceOnly) {
      setError("This VoiceBot deployment is voice-only. Start a live call to continue.");
      return;
    }

    setError("");
    clearReconnectTimer();
    if (normalizedMode === "text" && isLive) {
      await stopLiveCall();
    }
    setActiveMode(normalizedMode);
    setStatus(normalizedMode === "voice" ? "Ready" : "Text mode");
  }

  async function ensureTextSession() {
    if (String(sessionId || "").startsWith("text-")) {
      return sessionId;
    }

    const data = await createVoiceSession();
    if (data.sessionId) {
      setSessionId(data.sessionId);
    }
    if (data.greeting) {
      setTurns((current) => {
        const hasGreeting = current.some((turn) => turn.speaker === "VoiceBot" && turn.text === data.greeting);
        return hasGreeting ? current : [...current, { speaker: "VoiceBot", text: data.greeting }];
      });
    }
    return data.sessionId || sessionId;
  }

  function closeLocalVoice() {
    stopClock();

    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch {
        // Best-effort local cleanup.
      }
      dataChannelRef.current = null;
    }

    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Best-effort local cleanup.
      }
      pcRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    setIsMuted(false);
    setCallSeconds(0);
    setVoiceState("idle");
  }

  async function startLiveCall({
    reconnect = false,
    preserveConversation = false,
    requestedSessionId = ""
  } = {}) {
    setError("");

    if (!canStartLiveVoice) {
      setError(
        voiceConfig?.bootstrapError ||
        "VoiceBot is not configured for native voice yet. Check the VoiceBot environment settings and try again."
      );
      return;
    }

    if (!browserVoiceReady) {
      setError("This browser does not support live microphone WebRTC. Use the text fallback below.");
      return;
    }

    manualStopRef.current = false;
    clearReconnectTimer();
    setIsStarting(true);
    setVoiceState(reconnect ? "reconnecting" : "connecting");
    setStatus(reconnect ? "Reconnecting" : "Connecting");

    try {
      closeLocalVoice();
      setVoiceState(reconnect ? "reconnecting" : "connecting");
      setCallSeconds(0);

      const liveSessionId = requestedSessionId || createSessionId("webrtc");
      voiceSessionRef.current = liveSessionId;
      setSessionId(liveSessionId);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const remoteAudio = remoteAudioRef.current || new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      remoteAudioRef.current = remoteAudio;

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      const channel = pc.createDataChannel("agent");
      dataChannelRef.current = channel;

      channel.onopen = () => {
        reconnectAttemptedRef.current = false;
        setVoiceState("connected");
        setStatus("Connected");
      };

      channel.onmessage = (event) => {
        try {
          handleDataMessage(JSON.parse(event.data));
        } catch {
          // Ignore malformed data-channel events.
        }
      };

      channel.onerror = () => {
        setError("Live call controls are temporarily unavailable.");
      };

      channel.onclose = () => {
        scheduleReconnect("The live control channel closed.");
      };

      pc.ontrack = (event) => {
        const inboundStream = event.streams?.[0] || new MediaStream([event.track]);
        remoteAudio.srcObject = inboundStream;
        remoteAudio.play().catch(() => {});
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !voiceSessionRef.current) return;
        sendVoiceCandidate({
          session_id: voiceSessionRef.current,
          candidate: event.candidate.toJSON()
        }).catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        const next = String(pc.connectionState || "").toLowerCase();
        if (next === "connected") {
          reconnectAttemptedRef.current = false;
          setVoiceState("connected");
          setStatus("Connected");
          startClock();
        } else if (next === "connecting") {
          setVoiceState(reconnect ? "reconnecting" : "connecting");
        } else if (next === "failed" || next === "disconnected") {
          scheduleReconnect("The live voice connection dropped.");
        } else if (next === "closed") {
          stopClock();
        }
      };

      pc.oniceconnectionstatechange = () => {
        const next = String(pc.iceConnectionState || "").toLowerCase();
        if (next === "failed" || next === "disconnected") {
          scheduleReconnect("The WebRTC media path was interrupted.");
        } else if (next === "closed" || next === "completed") {
          stopClock();
        }
      };

      pc.addTransceiver("audio", { direction: "sendrecv" });
      const micTrack = stream.getAudioTracks()[0];
      if (micTrack) {
        pc.addTrack(micTrack, stream);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await sendVoiceOffer({
        sdp: offer.sdp,
        type: offer.type,
        session_id: liveSessionId,
        caller_id: callerId,
        reconnect,
        preserve_conversation: preserveConversation,
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        client_utc_offset_min: new Date().getTimezoneOffset(),
        client_language: navigator.language || "en",
        privacy_notice_accepted: true,
        privacy_notice_language: navigator.language || "en",
        recording_consent_resolved: null,
        recording_consent_granted: null
      });

      if (answer.session_id) {
        voiceSessionRef.current = answer.session_id;
        setSessionId(answer.session_id);
      }

      await pc.setRemoteDescription(new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }));
      setStatus("Connected");
    } catch (err) {
      clearReconnectTimer();
      closeLocalVoice();
      setVoiceState("failed");
      setStatus("Ready");
      setError(
        reconnect
          ? "Live voice reconnection failed. Retry the call or switch to text mode."
          : err.message || "Failed to start the live voice session."
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function stopLiveCall() {
    const activeSessionId = voiceSessionRef.current;
    manualStopRef.current = true;
    reconnectAttemptedRef.current = false;
    clearReconnectTimer();
    setVoiceState("ending");
    sendControl({
      type: "call_end_requested",
      reason: "caller_requested_end_call",
      immediate: true,
      source: "demo_website"
    });
    closeLocalVoice();
    setStatus("Ready");

    if (activeSessionId) {
      try {
        await endVoiceSession({ sessionId: activeSessionId });
      } catch {
        // Local teardown has already happened; backend cleanup is best effort.
      }
      voiceSessionRef.current = "";
    }

    try {
      const textSession = await createVoiceSession();
      if (textSession.sessionId) {
        setSessionId(textSession.sessionId);
      }
    } catch {
      setSessionId(fallbackSessionId);
    }
  }

  async function retryLiveCall() {
    setError("");
    reconnectAttemptedRef.current = false;
    await startLiveCall({
      reconnect: Boolean(voiceSessionRef.current),
      preserveConversation: true,
      requestedSessionId: voiceSessionRef.current || sessionId || createSessionId("webrtc")
    });
  }

  async function resetDemoSession() {
    clearReconnectTimer();
    reconnectAttemptedRef.current = false;
    manualStopRef.current = true;

    if (isLive) {
      await stopLiveCall();
    } else {
      closeLocalVoice();
    }

    aiDraftRef.current = "";
    setError("");
    setStatus("Ready");
    setTurns([
      {
        speaker: "VoiceBot",
        text: "Hi, I am Kollect AI VoiceBot. Start a live call or type below to talk to the Kollect Systems bot."
      }
    ]);

    try {
      const textSession = await createVoiceSession();
      if (textSession.sessionId) {
        setSessionId(textSession.sessionId);
      }
      if (textSession.greeting) {
        setTurns([{ speaker: "VoiceBot", text: textSession.greeting }]);
      }
    } catch {
      setSessionId(fallbackSessionId);
    }
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    sendControl({ type: "caller_activity", kind: nextMuted ? "mic_muted" : "mic_unmuted" });
  }

  async function submitText(event) {
    event.preventDefault();
    const cleanText = draft.trim();
    if (!cleanText) return;

    setDraft("");
    setError("");
    appendTurn("You", cleanText);

    if (isLive && sendControl({ type: "text_input", text: cleanText })) {
      setVoiceState("processing");
      return;
    }

    if (isVoiceOnly) {
      setError("This VoiceBot deployment is voice-only. Start a live call to continue.");
      return;
    }

    setStatus("Processing");
    try {
      const textSessionId = activeMode === "text" ? await ensureTextSession() : sessionId;
      const data = await sendVoiceText({ sessionId: textSessionId, text: cleanText });
      appendVoiceResponse(data);
    } catch (err) {
      setError(err.message);
      appendTurn("VoiceBot", "The voice service is not reachable right now. Check backend environment settings and try again.");
    } finally {
      setStatus("Ready");
    }
  }

  function appendVoiceResponse(data) {
    const text = data.reply || data.transcript || "Voice turn completed.";
    appendTurn("VoiceBot", text);

    if (data.audioUrl) {
      const audio = new Audio(data.audioUrl);
      audio.play().catch(() => {});
    }
  }

  const statusItems = [
    {
      label: "Demo API",
      value: health?.ok ? "Online" : "Checking",
      hint: "The local website server that brokers both demo integrations.",
      tone: health?.ok ? "good" : "neutral"
    },
    {
      label: "VoiceBot backend",
      value: voiceConfig?.configured ? "Configured" : "Needs config",
      hint: isVoiceOnly
        ? "This deployment uses the demo voice bootstrap flow and must approve this exact site origin."
        : "The native voice controls need the public widget VoiceBot environment values and a reachable upstream service.",
      tone: voiceConfig?.configured ? "good" : "warn"
    },
    {
      label: "Native voice",
      value: canStartLiveVoice ? "Enabled" : "Unavailable",
      hint: voiceConfig?.bootstrapError
        ? voiceConfig.bootstrapError
        : "Live WebRTC voice is enabled by config here, then fully verified when a session starts successfully.",
      tone: canStartLiveVoice ? "good" : "warn"
    },
    {
      label: "Browser mic",
      value: browserVoiceReady ? "Supported" : "Unavailable",
      hint: "If this is unavailable, the operator can still keep the demo moving in text mode.",
      tone: browserVoiceReady ? "good" : "warn"
    }
  ];

  return (
    <PageShell className="demo-page">
      <main className="demo-layout voice-layout">
        <aside className="demo-aside">
          <div className="eyebrow">
            <Icon name="mic" size={16} />
            VoiceBot Demo
          </div>
          <h1>Speak with Kollect AI VoiceBot.</h1>
          <p>
            A custom demo console for the Kollect Systems bot, connected to the live VoiceBot backend with
            microphone audio, real-time transcript, and typed fallback in one flow.
          </p>
          <div className="session-card">
            <span>Status</span>
            <strong>{modeStatus}</strong>
            <code>{sessionId.slice(0, 30)}</code>
          </div>
          <StatusPanel items={statusItems} title="Readiness" />
          <div className="console-actions sidebar-actions">
            <button className="secondary-action" onClick={resetDemoSession} type="button">
              <Icon name="refresh" size={16} />
              New session
            </button>
            <button
              className="secondary-action"
              disabled={!canStartLiveVoice || isStarting}
              onClick={retryLiveCall}
              type="button"
            >
              <Icon name="mic" size={16} />
              Retry voice
            </button>
          </div>
        </aside>

        <section className={`voice-console native-console mode-${activeMode}`} aria-label="Kollect AI VoiceBot demo">
          <div className="console-header voice-console-header">
            <span>
              <span className={`status-light ${isLive ? "live" : ""}`} />
              Kollect Systems bot
            </span>
            <div className="voice-header-meta">
              <div className="mode-toggle" aria-label="Conversation mode">
                <button
                  aria-pressed={activeMode === "voice"}
                  className={activeMode === "voice" ? "active" : ""}
                  onClick={() => switchMode("voice")}
                  type="button"
                >
                  <Icon name="mic" size={16} />
                  Voice
                </button>
                <button
                  aria-pressed={activeMode === "text"}
                  className={activeMode === "text" ? "active" : ""}
                  disabled={isVoiceOnly}
                  onClick={() => switchMode("text")}
                  type="button"
                >
                  <Icon name="chat" size={16} />
                  Text
                </button>
              </div>
              <code>{voiceConfig?.environment || "development"}</code>
              <code>{formatDuration(callSeconds)}</code>
            </div>
          </div>

          {activeMode === "voice" ? (
            <div className={`voice-stage native-voice-stage voice-state-${voiceState}`}>
              <div className="voice-stage-copy">
                <span>{displayStatus}</span>
                <strong>{isLive ? "Live voice session" : "Ready for a live call"}</strong>
              </div>

              <button
                aria-label={isLive ? "End live call" : "Start live call"}
                className={`record-button native-call-button ${isLive ? "recording" : ""}`}
                disabled={isStarting}
                onClick={isLive ? stopLiveCall : startLiveCall}
                type="button"
              >
                <Icon name={isLive ? "pause" : "mic"} size={34} />
              </button>

              <div className="record-label">
                {isStarting ? "Opening microphone" : isLive ? "End Call" : "Start Call"}
              </div>

              <div className="native-call-actions">
                <button disabled={!isLive} onClick={toggleMute} type="button">
                  <Icon name={isMuted ? "pause" : "mic"} size={17} />
                  {isMuted ? "Unmute" : "Mute"}
                </button>
                <button disabled={!isLive} onClick={() => sendControl({ type: "request_greeting" })} type="button">
                  <Icon name="spark" size={17} />
                  Greet
                </button>
              </div>

              <div className={`ring-visual ${isLive ? "active" : ""}`} aria-hidden="true">
                {Array.from({ length: 28 }).map((_, index) => (
                  <span key={index} style={{ "--level": `${22 + ((index * 19) % 68)}%` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-mode-stage">
              <div className="text-mode-icon">
                <Icon name="chat" size={32} />
              </div>
              <div>
                <span>Text mode</span>
                <strong>Chat with the same Kollect Systems bot.</strong>
              </div>
            </div>
          )}

          {activeMode === "voice" && !canStartLiveVoice && (
            <div className="inline-error">
              {voiceConfig?.bootstrapError ||
                "Native VoiceBot is not configured yet. Set the VoiceBot env values and make sure this site origin is approved."}
            </div>
          )}

          <div className="transcript native-transcript" ref={transcriptRef}>
            {turns.map((turn, index) => (
              <article
                className={turn.speaker === "You" ? "turn user-turn" : "turn bot-turn"}
                key={`${turn.speaker}-${index}-${turn.text.slice(0, 12)}`}
              >
                <span>{turn.partial ? `${turn.speaker} live` : turn.speaker}</span>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>

          {error && <div className="inline-error">{error}</div>}
          {error && (
            <div className="inline-actions">
              <button className="secondary-action" disabled={!canStartLiveVoice || isStarting} onClick={retryLiveCall} type="button">
                <Icon name="mic" size={16} />
                Retry voice
              </button>
              <button className="secondary-action" onClick={() => switchMode("text")} type="button">
                <Icon name="chat" size={16} />
                Use text mode
              </button>
            </div>
          )}

          <form className="composer" onSubmit={submitText}>
            <input
              aria-label="Type to VoiceBot"
              onChange={(event) => setDraft(event.target.value)}
              placeholder={activeMode === "voice" && isLive ? "Type into the live call" : "Type a message"}
              value={draft}
            />
            <button aria-label="Send typed message" disabled={!draft.trim()} type="submit">
              <Icon name="send" />
            </button>
          </form>
        </section>
      </main>
    </PageShell>
  );
}
