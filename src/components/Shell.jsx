import Icon from "./Icon.jsx";

export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="/">
        <img src="/kollect-logo.png" alt="Kollect" />
      </a>
      <nav className="nav-links" aria-label="Primary">
        <a href="/voicebot">VoiceBot</a>
        <a href="/kollectgpt">KollectGPT</a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <img src="/kollect-mark.png" alt="" />
      <span>Kollect AI Demo Portal</span>
      <span className="footer-dot" />
      <span>Browser-ready demos</span>
    </footer>
  );
}

export function PageShell({ children, className = "" }) {
  return (
    <div className={`page-shell ${className}`}>
      <Header />
      {children}
      <Footer />
    </div>
  );
}

export function ButtonLink({ href, children, variant = "primary", icon = "arrowRight" }) {
  return (
    <a className={`button button-${variant}`} href={href}>
      <span>{children}</span>
      <Icon name={icon} size={18} />
    </a>
  );
}
