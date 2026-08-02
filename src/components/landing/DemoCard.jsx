import { Check, Clock, ExternalLink, Repeat, Wallet, Truck, Tag, Ticket, BadgeCheck } from 'lucide-react';
import { money } from '../../utils/helpers';

// A static, presentational version of an ItemCard for the public landing demo.
// Mirrors the real app's markup/classes so the demo looks exactly like the product.
// Data is illustrative (example prices), clearly labeled on the landing page.

function Sparkline({ points, buy }) {
  const W = 300, H = 84, padY = 10;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M0,${H} L ${points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L ')} L ${W},${H} Z`;
  const lastX = x(points.length - 1), lastY = y(points[points.length - 1]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id="demo-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--wave)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--wave)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#demo-grad)" />
      <polyline points={line} fill="none" stroke="var(--wave)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="4" fill={buy ? 'var(--good)' : 'var(--wave)'} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

const STEP_ICON = { sub: Repeat, cash: Wallet, ship: Truck, sale: Tag };

export default function DemoCard({ item }) {
  const buy = item.verdict === 'buy';
  return (
    <article className={`card ${buy ? 'buy' : ''}`}>
      <div className="card-main">
        <div className="card-top">
          <div>
            <div className="card-title">{item.title} <span className="kind">{item.kind}</span></div>
            <div className="card-sub">{item.sub}</div>
          </div>
          <span className={`badge ${buy ? 'good' : 'wait'}`}>
            {buy ? <Check size={13} /> : <Clock size={13} />} {buy ? 'Buy now' : 'Wait'}
          </span>
        </div>

        <div className="price-row">
          <span className={`price-now tabnum ${buy ? 'good' : ''}`}>{money(item.truePrice)}</span>
          {item.list > item.truePrice && <span className="strike tabnum">{money(item.list)}</span>}
          <span className="store">
            at {item.store}
            {item.official && <span className="official-tag"><BadgeCheck size={12} /> official</span>}
          </span>
          <span className="target-chip">your price <b className="tabnum">{money(item.target)}</b></span>
        </div>

        <div className="deal-chips">
          {item.steps.map((s, i) => {
            const Icon = STEP_ICON[s.kind] || Tag;
            const cls = s.kind === 'sub' ? 'sub' : s.kind === 'ship' ? 'ship' : s.kind === 'sale' ? 'sale' : 'cash';
            return <span className={`deal-chip ${cls}`} key={i}><Icon size={12} /> {s.chip}</span>;
          })}
          {item.maybes?.length > 0 && (
            <span className="deal-chip maybe"><Ticket size={12} /> {item.maybes.length} code{item.maybes.length > 1 ? 's' : ''} to try</span>
          )}
        </div>

        <div className="reason"><span className="lead">{item.reason}</span></div>

        <div className="pb">
          <div className="pb-title">How this price is reached</div>
          <div className="pb-row"><span className="pb-label">List price</span><span className="pb-val tabnum">{money(item.list)}</span></div>
          {item.steps.map((s, i) => {
            const Icon = STEP_ICON[s.kind] || Tag;
            return (
              <div className="pb-row" key={i}>
                <span className="pb-label"><Icon size={12} /> {s.label}</span>
                <span className={`pb-val tabnum ${s.sign === '+' ? 'plus' : 'minus'}`}>{s.sign}{money(s.amount)}</span>
              </div>
            );
          })}
          <div className="pb-row total">
            <span className="pb-label">Absolute price {item.delivered ? '(delivered)' : ''}</span>
            <span className="pb-val tabnum">{money(item.truePrice)}</span>
          </div>
          {item.maybes?.length > 0 && (
            <div className="pb-maybes">
              <div className="pb-maybes-title"><Ticket size={12} /> Maybe cheaper — codes to try (verify at checkout)</div>
              {item.maybes.map((m) => (
                <div className="pb-maybe-row" key={m.code} style={{ cursor: 'default' }}>
                  <span className="pb-label">
                    <b className="pb-code">{m.code}</b>
                    {m.yours && <span className="pb-yours">yours</span>}
                    <span className="pb-note">−{money(m.off)}</span>
                  </span>
                  <span className="pb-val tabnum">~{money(m.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="actions">
          {buy && <span className="act" style={{ background: 'var(--good)', color: 'var(--on-accent)', borderColor: 'var(--good)', fontWeight: 600 }}>See where to buy <ExternalLink size={13} /></span>}
          <span className="act">Check now</span>
          <span className="act">I bought it</span>
        </div>
      </div>

      <div className="card-viz">
        <div className="viz-head"><span className="lab">Price tide</span><span className="lab">{item.dip}</span></div>
        <Sparkline points={item.spark} buy={buy} />
        <div className="legend">
          <span><i className="wave" />price</span>
          <span><i className="tgt" />your price</span>
          <span><i className="band" />usual range</span>
        </div>
      </div>
    </article>
  );
}
