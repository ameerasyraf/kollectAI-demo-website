import LandingPage from "./pages/LandingPage.jsx";
import KollectGPTDemo from "./pages/KollectGPTDemo.jsx";
import VoiceBotDemo from "./pages/VoiceBotDemo.jsx";

const routes = {
  "/": LandingPage,
  "/voicebot": VoiceBotDemo,
  "/kollectgpt": KollectGPTDemo
};

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export default function App() {
  const pathname = normalizePath(window.location.pathname);
  const Page = routes[pathname] || LandingPage;

  return <Page />;
}
