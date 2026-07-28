import { useEffect, useState } from "react";

// The kiosk shell switches "screens" by loading a different hash route (#/home, #/metrics, #/info).

type Screen = {
  id: string;
  label: string;
  accent: string;
  title: string;
  body: string;
};

const SCREENS: Screen[] = [
  {
    id: "home",
    label: "1 · Home",
    accent: "#38bdf8",
    title: "Helix Kiosk",
    body: "A dummy static React site running inside a QEMU Linux VM, shown fullscreen through a WebKitGTK kiosk shell.",
  },
  {
    id: "metrics",
    label: "2 · Metrics",
    accent: "#34d399",
    title: "Device Metrics",
    body: "This screen stands in for a live dashboard. Nothing here is real — it exists to prove screen switching works end to end.",
  },
  {
    id: "info",
    label: "3 · Info",
    accent: "#f472b6",
    title: "About This Lab",
    body: "Ported from a prior qemu-display lab. Cloud-init provisions X11 + WebKitGTK; the shell maps keyboard keys to screens.",
  },
];

function screenFromHash(): number {
  const id = window.location.hash.replace(/^#\/?/, "");
  const index = SCREENS.findIndex((s) => s.id === id);
  return index >= 0 ? index : 0;
}

export function App() {
  const [index, setIndex] = useState(screenFromHash);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const onHash = () => setIndex(screenFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // In-app screen switching for single-URL browsers (e.g. cog/WPE) with no external shell to map keys to URLs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = screenFromHash();
      let next = cur;
      if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n >= SCREENS.length) return;
        next = n;
      } else if (e.key === "n" || e.key === "ArrowRight" || e.key === " ") {
        next = (cur + 1) % SCREENS.length;
      } else if (e.key === "p" || e.key === "ArrowLeft") {
        next = (cur - 1 + SCREENS.length) % SCREENS.length;
      } else if (e.key === "F5") {
        window.location.reload();
        return;
      } else {
        return;
      }
      e.preventDefault();
      window.location.hash = `#/${SCREENS[next].id}`;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const screen = SCREENS[index];

  return (
    <main className="screen" style={{ ["--accent" as string]: screen.accent }}>
      <header className="topbar">
        <span className="badge">HELIX</span>
        <nav className="dots">
          {SCREENS.map((s, i) => (
            <span key={s.id} className={i === index ? "dot on" : "dot"} title={s.label} />
          ))}
        </nav>
      </header>

      <section className="content">
        <p className="eyebrow">{screen.label}</p>
        <h1>{screen.title}</h1>
        <p className="lede">{screen.body}</p>
        <p className="clock">{now.toLocaleTimeString()}</p>
      </section>

      <footer className="hints">
        <span>1 / 2 / 3 — jump to screen</span>
        <span>n · p — next / previous</span>
        <span>F5 — reload</span>
        <span>q — quit</span>
      </footer>
    </main>
  );
}
