import { useState } from 'react';
import {
  LogIn, Github, Moon, Sun, Search, FileSearch, Bell, ShieldCheck, DollarSign, Repeat, ArrowRight,
} from 'lucide-react';
import { signInWithGoogle } from '../../config/firebase';
import { APP_NAME, APP_TAGLINE } from '../../utils/constants';
import DemoCard from './DemoCard';

const REPO = 'https://github.com/mohsenzand/zerotide';

// Illustrative example items (static, for the public demo).
const DEMO_ITEMS = [
  {
    title: 'Thorne Basic Nutrients 2/Day', sub: '120 capsules', kind: 'Recurring',
    store: 'Thorne.com', official: true, verdict: 'buy', list: 68.00, truePrice: 51.68, target: 55,
    reason: 'True price $51.68 is below your $55.00, incl. subscribe & save + 5% cash back.',
    steps: [
      { kind: 'sub', label: 'Subscribe & Save 20%', chip: '$13.60 subscribe & save', amount: 13.60, sign: '-' },
      { kind: 'cash', label: '5% cash back · Rakuten', chip: '5% cash back · Rakuten', amount: 2.72, sign: '-' },
    ],
    maybes: [{ code: 'THORNE10', off: 5.00, price: 46.68 }],
    dip: 'dips monthly', spark: [62, 60, 64, 58, 66, 61, 59, 63, 57, 60, 55, 58, 54, 51.68],
    stores: [
      { store: 'Thorne.com', official: true, truePrice: 51.68, chips: [{ cls: 'sub', label: '−$13.60' }, { cls: 'cash', label: '5%' }] },
      { store: 'iHerb', truePrice: 54.40, chips: [{ cls: 'cash', label: '5%' }] },
      { store: 'Amazon', truePrice: 64.60, chips: [{ cls: 'sub', label: '−$3.40' }] },
    ],
  },
  {
    title: "Peet's Major Dickason's Blend", sub: 'whole bean, 12 oz', kind: 'Recurring',
    store: 'Amazon', official: false, verdict: 'wait', list: 14.99, truePrice: 12.10, target: 11,
    reason: 'True price $12.10 is above your $11.00. It dips monthly with Subscribe & Save, and your saved code could get you there.',
    steps: [
      { kind: 'sub', label: 'Subscribe & Save 15%', chip: '$2.25 subscribe & save', amount: 2.25, sign: '-' },
      { kind: 'cash', label: '5% cash back · Rakuten', chip: '5% cash back · Rakuten', amount: 0.64, sign: '-' },
    ],
    maybes: [{ code: 'PEET15', off: 1.10, price: 11.00, yours: true }],
    dip: 'dips monthly', spark: [15.5, 14.9, 15.2, 14.4, 15.0, 13.9, 14.6, 13.5, 14.2, 13.0, 13.6, 12.8, 13.2, 12.10],
    stores: [
      { store: 'Amazon', truePrice: 12.10, chips: [{ cls: 'sub', label: '−$2.25' }, { cls: 'cash', label: '5%' }] },
      { store: "Peet's Coffee", official: true, truePrice: 12.74, chips: [{ cls: 'sub', label: '−$2.25' }] },
      { store: 'Target', truePrice: 13.49, chips: [] },
    ],
  },
  {
    title: 'Ninja Air Fryer 4 qt', sub: 'AF101', kind: 'One-off',
    store: 'Amazon', official: false, verdict: 'buy', list: 99.99, truePrice: 75.99, target: 80,
    reason: 'On sale and below your $80.00, incl. 5% cash back. Free shipping with Prime.',
    steps: [
      { kind: 'sale', label: 'Sale', chip: 'sale −$20', amount: 20.00, sign: '-' },
      { kind: 'cash', label: '5% cash back · Rakuten', chip: '5% cash back · Rakuten', amount: 4.00, sign: '-' },
    ],
    maybes: [],
    dip: 'dips seasonally', spark: [96, 99, 92, 97, 90, 95, 88, 93, 86, 90, 84, 88, 80, 75.99],
    stores: [
      { store: 'Amazon', truePrice: 75.99, chips: [{ cls: 'sale', label: 'sale' }, { cls: 'cash', label: '5%' }] },
      { store: 'Walmart', truePrice: 78.50, chips: [{ cls: 'sale', label: 'sale' }] },
      { store: 'Target', truePrice: 79.99, chips: [] },
    ],
  },
];

const STEPS = [
  { icon: DollarSign, title: 'Set your price', body: 'Add an item and the most you’d pay. That’s it — no more checking prices yourself.' },
  { icon: FileSearch, title: 'The AI agent reads real pages', body: 'It searches the web, opens the actual product pages, and works out the true delivered price — subscription, cash back, shipping.' },
  { icon: Bell, title: 'Get pinged at the trough', body: 'When the true price meets your terms, it emails you. Recurring buys pause until the next cycle.' },
];

const FEATURES = [
  { icon: Search, title: 'Agentic, not a single prompt', body: 'Searches then opens and reads real product pages to verify the exact size and current price — not just snippets.' },
  { icon: DollarSign, title: 'The true delivered price', body: 'List price minus subscription and your cash back, plus shipping — shown as a transparent, step-by-step breakdown.' },
  { icon: Repeat, title: '“Maybe” codes', body: 'Promo codes appear as opt-in “maybe” prices to verify at checkout — including your own saved codes — never silently applied.' },
  { icon: ShieldCheck, title: 'Private by design', body: 'Owner-only Google sign-in; the database is locked and every action runs through authenticated functions.' },
];

export default function LandingPage({ theme, toggleTheme }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setErr(''); setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) { if (e.code !== 'auth/popup-closed-by-user') setErr(e.message || 'Sign-in failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="brand">
          <h1>{APP_NAME}<span className="dot">.</span></h1>
          <span className="tag">{APP_TAGLINE}</span>
        </div>
        <nav className="navbtns">
          <a className="pill" href={REPO} target="_blank" rel="noopener noreferrer"><Github size={15} /> GitHub</a>
          <button className="pill" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
          <button className="btn btn-primary" onClick={signIn} disabled={busy}><LogIn size={15} /> {busy ? 'Signing in…' : 'Sign in'}</button>
        </nav>
      </header>

      <section className="lp-hero">
        <h2>Set your price.<br />Walk away. Get pinged at the trough.</h2>
        <p>
          ZeroTide is an agentic-AI shopping price tracker. You set the price you’d pay; an AI agent
          searches the web, <b>reads the actual product pages</b>, computes the <b>true delivered price</b>
          (subscription, cash back, shipping), and tells you to buy only when your terms are met.
        </p>
        <div className="lp-cta">
          <button className="btn btn-primary" onClick={signIn} disabled={busy}><LogIn size={16} /> {busy ? 'Signing in…' : 'Sign in with Google'}</button>
          <a className="btn btn-ghost" href={REPO} target="_blank" rel="noopener noreferrer"><Github size={16} /> View source</a>
        </div>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
        <p className="lp-note">The live app is <b>private (owner-only)</b> to keep it personal and control AI cost — so sign-in is limited to the owner. The demo below shows it in action.</p>
      </section>

      <section className="lp-steps">
        {STEPS.map((s, i) => (
          <div className="lp-step" key={i}>
            <div className="lp-step-num"><s.icon size={18} /></div>
            <div className="lp-step-title">{s.title}</div>
            <div className="lp-step-body">{s.body}</div>
          </div>
        ))}
      </section>

      <section className="lp-demo">
        <div className="lp-section-head">
          <span className="eyebrow">See it in action</span>
          <h3>The dashboard, with example items</h3>
          <p className="lp-sub">Illustrative examples — real products, representative prices. In the live app these are checked against the web in real time.</p>
        </div>
        <div className="list">
          {DEMO_ITEMS.map((it) => <DemoCard key={it.title} item={it} />)}
        </div>
      </section>

      <section className="lp-features">
        <div className="lp-section-head">
          <span className="eyebrow">Why it’s different</span>
          <h3>Decisions, not just search results</h3>
        </div>
        <div className="lp-feature-grid">
          {FEATURES.map((f, i) => (
            <div className="lp-feature" key={i}>
              <f.icon size={18} className="lp-feature-ic" />
              <div className="lp-feature-title">{f.title}</div>
              <div className="lp-feature-body">{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-cta">
          <button className="btn btn-primary" onClick={signIn} disabled={busy}><LogIn size={16} /> Sign in</button>
          <a className="btn btn-ghost" href={REPO} target="_blank" rel="noopener noreferrer">Source on GitHub <ArrowRight size={15} /></a>
        </div>
        <p className="lp-disclaimer">
          Prices shown here are illustrative examples. In the live app they are AI estimates read from live web pages and shown “as of” a date — always confirm at the store before buying.
          ZeroTide is not affiliated with any retailer.
        </p>
      </footer>
    </div>
  );
}
