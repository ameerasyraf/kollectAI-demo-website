const icons = {
  arrowRight: (
    <path d="M5 12h14m-6-6 6 6-6 6" />
  ),
  bot: (
    <>
      <rect x="5" y="7" width="14" height="12" rx="3" />
      <path d="M12 7V4m-4 8h.01M16 12h.01M9 16h6" />
    </>
  ),
  chat: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6a8 8 0 1 1 18-5Z" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
  check: (
    <path d="m5 13 4 4L19 7" />
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 0 1-15.5 6.3M3 12A9 9 0 0 1 18.5 5.7" />
      <path d="M21 3v6h-6M3 21v-6h6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  play: (
    <path d="m8 5 11 7-11 7V5Z" />
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  shield: (
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  ),
  spark: (
    <path d="M12 2v5m0 10v5M4.2 4.2l3.5 3.5m8.6 8.6 3.5 3.5M2 12h5m10 0h5M4.2 19.8l3.5-3.5m8.6-8.6 3.5-3.5" />
  ),
  wave: (
    <path d="M3 12h2l2-6 4 12 4-12 2 6h4" />
  )
};

export default function Icon({ name, size = 20, title }) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="icon"
      fill="none"
      height={size}
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {icons[name]}
    </svg>
  );
}
