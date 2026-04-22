import Icon from "../components/Icon.jsx";
import { ButtonLink, PageShell } from "../components/Shell.jsx";

const capabilities = [
  "Natural customer conversations",
  "Private service integration",
  "Desktop and mobile demo flows"
];

export default function LandingPage() {
  return (
    <PageShell>
      <main>
        <section className="hero-band">
          <div className="hero-copy">
            <div className="eyebrow">
              <Icon name="spark" size={16} />
              Kollect AI Demo Portal
            </div>
            <h1>Try Kollect AI VoiceBot and KollectGPT from the browser.</h1>
            <p>
              A focused demo site for showcasing voice automation and intelligent
              chat experiences through a clean customer-facing browser flow.
            </p>
            <div className="hero-actions">
              <ButtonLink href="/voicebot" icon="mic">Take VoiceBot Demo</ButtonLink>
              <ButtonLink href="/kollectgpt" variant="secondary" icon="chat">Try KollectGPT</ButtonLink>
            </div>
            <div className="capability-strip" aria-label="Highlights">
              {capabilities.map((item) => (
                <span key={item}>
                  <Icon name="check" size={16} />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="hero-product" aria-label="Kollect product preview">
            <div className="voice-signal-panel">
              <div className="signal-header">
                <span className="status-light" />
                VoiceBot live session
              </div>
              <div className="waveform">
                {Array.from({ length: 36 }).map((_, index) => (
                  <span key={index} style={{ "--height": `${28 + ((index * 17) % 58)}%` }} />
                ))}
              </div>
              <div className="voice-preview-row">
                <span>Intent detected</span>
                <strong>Payment reminder</strong>
              </div>
              <div className="voice-preview-row">
                <span>Next action</span>
                <strong>Confirm promise date</strong>
              </div>
            </div>

            <div className="chat-preview-panel">
              <div className="mini-chat assistant">I can explain account options and guide the next step.</div>
              <div className="mini-chat user">Can you summarize my payment choices?</div>
              <div className="mini-chat assistant accent">Yes. Here are the clearest options.</div>
            </div>
          </div>
        </section>

        <section className="product-band voice-band" id="voicebot">
          <div className="section-copy">
            <div className="section-icon"><Icon name="mic" /></div>
            <h2>Kollect AI VoiceBot</h2>
            <p>
              Let visitors experience a browser-based voice interaction that can
              greet, understand intent, respond naturally, and route the next step
              through your configured VoiceBot service.
            </p>
            <ButtonLink href="/voicebot" icon="play">Take A Demo</ButtonLink>
          </div>
          <div className="feature-grid">
            <article>
              <Icon name="wave" />
              <h3>Voice-first flow</h3>
              <p>Mic recording and typed fallback are ready for desktop and mobile browsers.</p>
            </article>
            <article>
              <Icon name="shield" />
              <h3>Protected secrets</h3>
              <p>Requests go through server endpoints, keeping VoiceBot keys outside the browser.</p>
            </article>
          </div>
        </section>

        <section className="product-band gpt-band" id="kollectgpt">
          <div className="section-copy">
            <div className="section-icon"><Icon name="chat" /></div>
            <h2>KollectGPT</h2>
            <p>
              Give customers and internal teams a clean chat surface for trying
              KollectGPT against demo prompts, product information, or your live
              knowledge workflow.
            </p>
            <ButtonLink href="/kollectgpt" icon="send">Take A Demo</ButtonLink>
          </div>
          <div className="feature-grid">
            <article>
              <Icon name="bot" />
              <h3>Guided assistant</h3>
              <p>Conversation state is kept per visitor session for realistic demo behavior.</p>
            </article>
            <article>
              <Icon name="spark" />
              <h3>Fast to adapt</h3>
              <p>Swap mock responses for live API calls by filling environment variables.</p>
            </article>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
