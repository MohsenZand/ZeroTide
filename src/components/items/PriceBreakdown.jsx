import { Ticket, Wallet, Repeat, ArrowDown, ExternalLink, Truck, AlertTriangle } from 'lucide-react';
import { money, shopUrl } from '../../utils/helpers';

// Shows the absolute (verified) price step-by-step, then the "maybe" prices you
// could reach with promo codes. Every finding is a clickable link.
export default function PriceBreakdown({ best, title, userCoupons = [] }) {
  if (!best) return null;
  const shelf = best.shelfPrice;
  const applied = best.appliedDiscount || 0; // subscription only
  const rate = best.cashbackRate || 0;
  const aiSuggestions = best.couponSuggestions || [];

  const afterDiscount = Math.max(0, shelf - applied);
  const cashbackAmt = Math.round(afterDiscount * (rate / 100) * 100) / 100;
  const shipping = best.shipping || 0;

  // Your own saved codes → "maybe" prices computed against this store's list price.
  const round2 = (n) => Math.round(n * 100) / 100;
  const mine = (userCoupons || []).map((c) => {
    const off = c.amount || (c.percent ? shelf * (c.percent / 100) : 0);
    return {
      code: c.code,
      yours: true,
      savings: off ? round2(off) : null,
      maybePrice: off ? round2(Math.max(0, shelf - off) * (1 - rate / 100) + shipping) : null,
      url: null,
    };
  });
  const suggestions = [...mine, ...aiSuggestions].sort((a, b) => (a.maybePrice ?? 1e9) - (b.maybePrice ?? 1e9));

  const hasAnything = applied > 0 || rate > 0 || shipping > 0 || suggestions.length > 0;
  if (!hasAnything) return null;
  // A code's proof link, or a search for the code so it's always clickable.
  const codeLink = (c) => c.url || shopUrl(`${title || ''} promo code ${c.code}`);

  // Guard against stale records priced by an older version: if the pieces don't add
  // up to the stored true price, don't show a misleading breakdown — prompt a refresh.
  const expected = afterDiscount * (1 - rate / 100) + shipping;
  if (typeof best.truePrice === 'number' && Math.abs(expected - best.truePrice) > 0.5) {
    return (
      <div className="pb">
        <div className="pb-title">How this price is reached</div>
        <div className="pb-warn">
          <AlertTriangle size={12} /> This price was calculated by an older version. Click “Check now” to refresh it.
        </div>
      </div>
    );
  }

  return (
    <div className="pb">
      <div className="pb-title">How this price is reached</div>
      <div className="pb-row"><span className="pb-label">List price</span><span className="pb-val tabnum">{money(shelf)}</span></div>

      {applied > 0 && (
        <div className="pb-row">
          <span className="pb-label">
            <Repeat size={12} /> {best.subscriptionLabel || 'Subscribe & Save'}
            {best.subscription?.url && <a href={best.subscription.url} target="_blank" rel="noopener noreferrer" className="pb-link"><ExternalLink size={11} /></a>}
          </span>
          <span className="pb-val minus tabnum">−{money(applied)}</span>
        </div>
      )}

      {rate > 0 && (
        <div className="pb-row">
          <span className="pb-label">
            <Wallet size={12} /> {rate}% cash back{best.bestCashback?.portal ? ` · ${best.bestCashback.portal}` : ''}
            {best.bestCashback?.url && <a href={best.bestCashback.url} target="_blank" rel="noopener noreferrer" className="pb-link"><ExternalLink size={11} /></a>}
          </span>
          <span className="pb-val minus tabnum">−{money(cashbackAmt)}</span>
        </div>
      )}

      {shipping > 0 && (
        <div className="pb-row">
          <span className="pb-label">
            <Truck size={12} /> Shipping
            {best.freeShippingThreshold ? <span className="pb-note"> (free over {money(best.freeShippingThreshold)})</span> : null}
          </span>
          <span className="pb-val plus tabnum">+{money(shipping)}</span>
        </div>
      )}
      {shipping === 0 && best.shippingNote && (
        <div className="pb-row"><span className="pb-label"><Truck size={12} /> {best.shippingNote}</span><span className="pb-val tabnum" style={{ color: 'var(--good)' }}>free</span></div>
      )}

      <div className="pb-row total">
        <span className="pb-label"><ArrowDown size={12} /> Absolute price {shipping > 0 ? '(delivered)' : ''}</span>
        <span className="pb-val tabnum">{money(best.truePrice)}</span>
      </div>

      {suggestions.length > 0 && (
        <div className="pb-maybes">
          <div className="pb-maybes-title"><Ticket size={12} /> Maybe cheaper — codes to try (verify at checkout)</div>
          {suggestions.map((c) => (
            <a key={(c.yours ? 'me-' : 'ai-') + c.code} className="pb-maybe-row" href={codeLink(c)} target="_blank" rel="noopener noreferrer" title={c.description || ''}>
              <span className="pb-label">
                <b className="pb-code">{c.code}</b>
                {c.yours && <span className="pb-yours">yours</span>}
                {c.savings ? <span className="pb-note">−{money(c.savings)}</span> : <span className="pb-note">try it</span>}
                <ExternalLink size={11} className="pb-link" />
              </span>
              <span className="pb-val tabnum">{c.maybePrice ? `~${money(c.maybePrice)}` : ''}</span>
            </a>
          ))}
        </div>
      )}

      {best.howToGetPrice && <div className="pb-how">{best.howToGetPrice}</div>}
    </div>
  );
}
