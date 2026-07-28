import { useSyncExternalStore } from 'react';
import { ROUTES, PROFILE } from '@/generated/routes';

// Minimal hash router — zero dependencies. Enough to switch between the
// generated (enabled-only) routes on a static SPA served with index.html fallback.
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
function useHash() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash.replace(/^#/, '') || '/',
    () => '/',
  );
}

function Home() {
  return (
    <main>
      <h1>Helix edge UI</h1>
      <p>
        Profile: <strong>{PROFILE}</strong> — {ROUTES.length} feature(s) enabled.
      </p>
      {ROUTES.map((r) => (
        <div className="card" key={r.route}>
          <a href={`#${r.route}`}>{r.label}</a>
          {r.heavy && <span className="tag">heavy</span>}
        </div>
      ))}
    </main>
  );
}

export default function App() {
  const path = useHash();
  const match = ROUTES.find((r) => r.route === path);
  return (
    <div>
      <nav style={{ padding: '0.5rem 2rem', borderBottom: '1px solid #232a36' }}>
        <a href="#/">home</a>
      </nav>
      {match ? <match.Component /> : <Home />}
    </div>
  );
}
