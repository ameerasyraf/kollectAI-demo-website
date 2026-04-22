import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { PageShell } from "../components/Shell.jsx";
import StatusPanel from "../components/StatusPanel.jsx";
import { getDemoHealth, streamKollectGPTMessage } from "../lib/api.js";

const starterPrompts = [
  "What can KollectGPT help a collections team automate?",
  "Draft a polite payment reminder for a customer.",
  "Summarize the next best action after a missed promise-to-pay."
];

const initialAssistantMessage = {
  role: "assistant",
  content: "Hi, I am KollectGPT. I can help with customer engagement, collections workflows, and operational answers."
};

function replaceStreamingAssistant(current, nextContent, extra = {}) {
  const nextMessages = [...current];
  let index = -1;
  for (let cursor = nextMessages.length - 1; cursor >= 0; cursor -= 1) {
    if (nextMessages[cursor]?.streaming) {
      index = cursor;
      break;
    }
  }

  if (index >= 0) {
    nextMessages[index] = {
      ...nextMessages[index],
      content: nextContent,
      ...extra
    };
    return nextMessages;
  }

  return [...nextMessages, { role: "assistant", content: nextContent, streaming: true, ...extra }];
}

export default function KollectGPTDemo() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState([initialAssistantMessage]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);
  const [liveStatus, setLiveStatus] = useState("");
  const [liveDetail, setLiveDetail] = useState("");
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const abortReasonRef = useRef("");

  useEffect(() => {
    getDemoHealth()
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));

    return () => {
      abortReasonRef.current = "dispose";
      abortRef.current?.abort();
    };
  }, []);

  async function submitMessage(text = draft) {
    const cleanText = text.trim();
    if (!cleanText || isSending) return;

    setError("");
    setDraft("");
    const nextMessages = [...messages, { role: "user", content: cleanText }];
    setMessages([...nextMessages, { role: "assistant", content: "", streaming: true }]);
    setIsSending(true);
    setLiveStatus("Connecting to KollectGPT");
    setLiveDetail("Opening a live stream to the real backend.");
    const controller = new AbortController();
    abortRef.current = controller;
    abortReasonRef.current = "";
    let streamedReply = "";

    try {
      const data = await streamKollectGPTMessage({
        sessionId,
        messages: nextMessages,
        signal: controller.signal,
        onSession(nextSessionId) {
          if (nextSessionId) {
            setSessionId(nextSessionId);
          }
        },
        onToken({ reply }) {
          streamedReply = reply;
          setLiveStatus(reply ? "Generating answer" : "Waiting for first token");
          setLiveDetail(reply ? "KollectGPT is streaming the response now." : "The backend is preparing the answer.");
          setMessages((current) =>
            replaceStreamingAssistant(current, reply || "Thinking", {
              streaming: true
            })
          );
        },
        onTaskStatus(payload) {
          const nextStatus = String(payload?.status || payload?.task || "Processing");
          const description = String(
            payload?.detail?.description ||
            payload?.detail?.lane ||
            payload?.phase_name ||
            ""
          ).trim();
          setLiveStatus(nextStatus);
          setLiveDetail(description);
        },
        onHeartbeat(payload) {
          if (!streamedReply) {
            const heartbeatStatus = String(payload?.status || "Still working").trim();
            setLiveStatus(heartbeatStatus || "Still working");
            setLiveDetail("The request is still active upstream.");
          }
        },
        onError(payload) {
          if (payload?.message) {
            setLiveStatus("Upstream reported an issue");
            setLiveDetail(String(payload.message));
          }
        },
        onFinal(payload) {
          if (payload.sessionId) {
            setSessionId(payload.sessionId);
          }
        }
      });

      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
      const finalReply = streamedReply || data.reply || "I received that, but the response did not include text.";
      setLiveStatus("Response complete");
      setLiveDetail("KollectGPT finished this turn.");
      setMessages((current) =>
        replaceStreamingAssistant(current, finalReply, {
          streaming: false
        })
      );
    } catch (err) {
      if (err.name === "AbortError") {
        if (abortReasonRef.current !== "reset" && abortReasonRef.current !== "dispose") {
          const fallbackReply = streamedReply || "Response stopped.";
          setLiveStatus("Response stopped");
          setLiveDetail("Streaming was stopped before the final answer completed.");
          setMessages((current) =>
            replaceStreamingAssistant(current, fallbackReply, {
              streaming: false
            })
          );
        }
      } else {
        setError(err.message);
        setLiveStatus("Request failed");
        setLiveDetail(err.message);
        setMessages((current) =>
          replaceStreamingAssistant(
            current,
            streamedReply || "The demo service is not reachable right now. Check the backend environment settings and try again.",
            {
              streaming: false
            }
          )
        );
      }
    } finally {
      abortReasonRef.current = "";
      abortRef.current = null;
      setIsSending(false);
      inputRef.current?.focus();
    }
  }

  function resetConversation() {
    abortReasonRef.current = "reset";
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionId("");
    setError("");
    setDraft("");
    setIsSending(false);
    setLiveStatus("");
    setLiveDetail("");
    setMessages([initialAssistantMessage]);
  }

  const statusItems = [
    {
      label: "Demo API",
      value: health?.ok ? "Online" : "Checking",
      hint: "The local demo server that powers the browser experience.",
      tone: health?.ok ? "good" : "neutral"
    },
    {
      label: "KollectGPT backend",
      value: health?.kollectgptConfigured ? "Configured" : "Needs config",
      hint: "Streaming and chat replies use the real KollectGPT integration once the upstream endpoint is reachable.",
      tone: health?.kollectgptConfigured ? "good" : "warn"
    },
    {
      label: "VoiceBot backend",
      value: health?.voicebotConfigured ? "Configured" : "Optional",
      hint: "Shown here so the operator can see both demo integrations at a glance.",
      tone: health?.voicebotConfigured ? "good" : "neutral"
    }
  ];

  return (
    <PageShell className="demo-page">
      <main className="demo-layout">
        <aside className="demo-aside">
          <div className="eyebrow">
            <Icon name="chat" size={16} />
            KollectGPT Demo
          </div>
          <h1>Ask KollectGPT.</h1>
          <p>
            Run a guided customer conversation, test collections-specific prompts,
            and see how the assistant handles operational questions.
          </p>
          <div className="prompt-stack">
            {starterPrompts.map((prompt) => (
              <button
                className="prompt-chip"
                disabled={isSending}
                key={prompt}
                onClick={() => submitMessage(prompt)}
                type="button"
              >
                <Icon name="spark" size={15} />
                <span>{prompt}</span>
              </button>
            ))}
          </div>
          <StatusPanel items={statusItems} title="Readiness" />
          <div className="console-actions sidebar-actions">
            <button className="secondary-action" onClick={resetConversation} type="button">
              <Icon name="refresh" size={16} />
              New chat
            </button>
          </div>
        </aside>

        <section className="chat-console" aria-label="KollectGPT conversation">
          <div className="console-header">
            <div className="console-header-copy">
              <span className={`status-light ${isSending ? "live" : ""}`} />
              {isSending ? "Streaming response" : "Demo session"}
            </div>
            <div className="console-actions">
              <code>{sessionId ? sessionId.slice(0, 18) : "new conversation"}</code>
              {isSending ? (
                <button
                  className="secondary-action"
                  onClick={() => {
                    abortReasonRef.current = "stop";
                    abortRef.current?.abort();
                  }}
                  type="button"
                >
                  <Icon name="pause" size={16} />
                  Stop
                </button>
              ) : (
                <button className="secondary-action" onClick={resetConversation} type="button">
                  <Icon name="refresh" size={16} />
                  Reset
                </button>
              )}
            </div>
          </div>

          {(isSending || liveStatus || liveDetail) && (
            <div className="live-status-bar" aria-live="polite">
              <strong>{liveStatus || "Waiting for response"}</strong>
              {liveDetail ? <p>{liveDetail}</p> : null}
            </div>
          )}

          <div className="messages">
            {messages.map((message, index) => (
              <article className={`message ${message.role} ${message.streaming ? "streaming" : ""}`} key={`${message.role}-${index}`}>
                <span>{message.role === "assistant" ? "KollectGPT" : "You"}</span>
                <p className={message.streaming ? "typing" : ""}>{message.content || "Thinking"}</p>
              </article>
            ))}
          </div>

          {error && <div className="inline-error">{error}</div>}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitMessage();
            }}
          >
            <input
              aria-label="Message KollectGPT"
              disabled={isSending}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message KollectGPT"
              ref={inputRef}
              value={draft}
            />
            <button aria-label="Send message" disabled={isSending || !draft.trim()} type="submit">
              <Icon name="send" />
            </button>
          </form>
        </section>
      </main>
    </PageShell>
  );
}
