import { ExternalLink, Wallet, Tag, Crown, Repeat, BadgeCheck, Truck } from 'lucide-react';
import { money, shopUrl } from '../../utils/helpers';

// Expandable per-store list for one intention. The cheapest found store is the
// "winner" (crown); not-found stores are shown greyed at the bottom.
export default function StoreBreakdown({ stores, query }) {
  if (!stores || stores.length === 0) {
    return <div className="breakdown-empty">No per-store data yet — run “Check now”.</div>;
  }

  return (
    <div className="breakdown">
      {stores.map((s, i) => {
        if (!s.found) {
          return (
            <div className="brk-row not-found" key={s.store + i}>
              <span className="brk-store">{s.store}</span>
              <span className="brk-note">{s.notes || 'not found'}</span>
            </div>
          );
        }
        const diff = s.sizeMatch === 'different';
        const winner = i === 0 && !diff;
        const hasDeal = s.appliedDiscount > 0 || s.cashbackRate > 0 || s.shipping > 0 || s.onSale;
        return (
          <div className={`brk-row ${winner ? 'winner' : ''} ${diff ? 'wrong-size' : ''}`} key={s.store + i}>
            <span className="brk-store">
              {winner && <Crown size={12} className="crown" />}
              {s.store}
              {s.isOfficial && <BadgeCheck size={12} className="official-ic" title="Official manufacturer site" />}
              {s.matchedSize && <span className="brk-unit">{s.matchedSize}{diff ? ' · diff. size' : ''}</span>}
            </span>
            <span className="brk-prices">
              <b className="tabnum">{money(s.truePrice)}</b>
              {hasDeal && s.shelfPrice > s.truePrice && <s className="brk-shelf tabnum">{money(s.shelfPrice)}</s>}
            </span>
            <span className="brk-deals">
              {s.appliedDiscount > 0 && <span className="deal-chip sub"><Repeat size={11} /> {money(s.appliedDiscount)}</span>}
              {s.cashbackRate > 0 && <span className="deal-chip cash"><Wallet size={11} /> {s.cashbackRate}%</span>}
              {s.shipping > 0 && <span className="deal-chip ship"><Truck size={11} /> +{money(s.shipping)}</span>}
              {s.onSale && <span className="deal-chip sale"><Tag size={11} /> sale</span>}
            </span>
            <a className="brk-src" href={s.sourceUrl || shopUrl(s.sourceTitle || query, s.store)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.store}`}>
              <ExternalLink size={12} />
            </a>
          </div>
        );
      })}
    </div>
  );
}
