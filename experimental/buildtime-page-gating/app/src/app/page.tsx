import Link from 'next/link';
import { NAV, PROFILE } from '@/generated/nav';

export default function Home() {
  return (
    <main>
      <h1>Helix edge UI</h1>
      <p>
        Build profile: <strong>{PROFILE}</strong> — {NAV.length} feature(s) enabled.
      </p>
      {NAV.map((item) => (
        <div className="card" key={item.route}>
          <Link href={item.route}>{item.label}</Link>
          {item.heavy && <span className="tag">heavy</span>}
        </div>
      ))}
    </main>
  );
}
