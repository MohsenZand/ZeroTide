import { useState } from 'react';
import { Check, Plus, Clock, Eye, RefreshCw, ExternalLink, ShoppingBag, Trash2, Pencil, Ticket, Wallet, Tag, ChevronDown, Store, Repeat, BadgeCheck, Play, Pause, Truck } from 'lucide-react';
import { useShopping } from '../../contexts/ShoppingContext';
import { money, formatAsOf, verdictMeta, shopUrl } from '../../utils/helpers';
import PriceTide from './PriceTide';
import AddItemForm from './AddItemForm';
import StoreBreakdown from './StoreBreakdown';
import PriceBreakdown from './PriceBreakdown';

const VERDICT_ICON = {
  good: Check,
  warn: Plus,
  wait: Clock,
  watch: Eye,
};

export default function ItemCard({ intention, onDelete }) {
  const { checkNow, markBought, resumeIntention, snoozeIntention, checkingIds } = useShopping();
  const [editing, setEditing] = useState(false);
  const [showStores, setShowStores] = useState(false);
  const best = intention.currentBest;
  const stores = intention.latestStores || [];
  const foundCount = stores.filter((s) => s.found).length;

  if (editing) {
    return <AddItemForm intention={intention} onClose={() => setEditing(false)} />;
  }
  const meta = verdictMeta(intention.verdict);
  const Icon = VERDICT_ICON[meta.tone] || Eye;
  const checking = !!checkingIds[intention.id];
  const isBuy = intention.verdict === 'buy';
  const isSnoozed = intention.verdict === 'snoozed' || intention.verdict === 'bought';

  const hasDeal = best && (best.appliedDiscount > 0 || best.cashbackRate > 0 || best.shipping > 0 || best.shippingNote || best.onSale || best.couponSuggestions?.length > 0 || intention.userCoupons?.length > 0);
  const truePrice = best ? best.truePrice : null;
  const isFlexible = intention.matchType === 'flexible';
  // Real product page the agent opened; fall back to a search only if none.
  const buyHref = best ? (best.sourceUrl || shopUrl(best.sourceTitle || intention.title, best.store)) : null;
  const hasRealLink = !!(best && best.sourceUrl);

  return (
    <article className={`card ${isBuy ? 'buy' : ''}`}>
      <div className="card-main">
        <div className="card-top">
          <div>
            <div className="card-title">
              {intention.title}
              <span className="kind">{intention.kind}</span>
            </div>
            {(intention.brand || intention.size) && (
              <div className="card-sub">{[intention.brand, intention.size].filter(Boolean).join(' · ')}</div>
            )}
            {isFlexible && best?.sourceTitle && (
              <div className="card-sub" style={{ color: 'var(--accent)' }}>match: {best.sourceTitle}</div>
            )}
          </div>
          <span className={`badge ${meta.tone}`}><Icon size={13} /> {meta.label}</span>
        </div>

        {best ? (
          <>
            <div className="price-row">
              <span className={`price-now tabnum ${isBuy ? 'good' : ''}`}>{money(truePrice)}</span>
              {hasDeal && best.shelfPrice > truePrice && (
                <span className="strike tabnum">{money(best.shelfPrice)}</span>
              )}
              <span className="store">
                at {best.store}
                {best.isOfficial && <span className="official-tag" title="Manufacturer's official site"><BadgeCheck size={12} /> official</span>}
              </span>
              {best.asOfDate && <span className="asof">as of {formatAsOf(best.asOfDate)}</span>}
              {typeof intention.targetPrice === 'number' && (
                <span className="target-chip">your price <b className="tabnum">{money(intention.targetPrice)}</b></span>
              )}
            </div>
            {best.matchedSize && (
              <div className="size-note">
                size: {best.matchedSize}
                {best.sizeMatch === 'scaled' && <span className="size-flag"> · price scaled to your size</span>}
                {best.sizeMatch === 'different' && <span className="size-flag warn"> · different size — not an exact match</span>}
              </div>
            )}

            {hasDeal && (
              <div className="deal-chips">
                {best.appliedDiscount > 0 && (
                  <span className="deal-chip sub"><Repeat size={12} /> {money(best.appliedDiscount)} {best.subscriptionLabel || 'subscribe & save'}</span>
                )}
                {best.cashbackRate > 0 && (
                  <span className="deal-chip cash"><Wallet size={12} /> {best.cashbackRate}% cash back{best.bestCashback?.portal ? ` · ${best.bestCashback.portal}` : ''}</span>
                )}
                {best.shipping > 0 && (
                  <span className="deal-chip ship"><Truck size={12} /> +{money(best.shipping)} ship</span>
                )}
                {best.shipping === 0 && best.shippingNote && (
                  <span className="deal-chip cash"><Truck size={12} /> {best.shippingNote}</span>
                )}
                {(() => {
                  const n = (best.couponSuggestions?.length || 0) + (intention.userCoupons?.length || 0);
                  return n > 0 ? (
                    <span className="deal-chip maybe" title="Codes to try — verify at checkout"><Ticket size={12} /> {n} code{n > 1 ? 's' : ''} to try</span>
                  ) : null;
                })()}
              </div>
            )}
          </>
        ) : (
          <div className="price-row">
            <span className="price-now" style={{ color: 'var(--ink-3)', fontSize: '1.1rem' }}>No price yet</span>
            {typeof intention.targetPrice === 'number' && (
              <span className="target-chip">your price <b className="tabnum">{money(intention.targetPrice)}</b></span>
            )}
          </div>
        )}

        {intention.verdictReason && (
          <div className="reason"><span className="lead">{intention.verdictReason}</span></div>
        )}
        {best && (
          <a className="source-link" href={buyHref} target="_blank" rel="noopener noreferrer">
            {best.sourceTitle ? `${best.sourceTitle} — ${hasRealLink ? 'open product page' : 'search'}` : (hasRealLink ? 'open product page' : 'search')} <ExternalLink size={11} style={{ display: 'inline', verticalAlign: '-1px' }} />
          </a>
        )}

        {best && <PriceBreakdown best={best} title={intention.title} userCoupons={intention.userCoupons} />}

        <div className="actions">
          {isSnoozed ? (
            <>
              <button className="act" style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 600 }}
                onClick={() => resumeIntention(intention.id)}>
                <Play size={13} /> Resume watching
              </button>
              <button className="act" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
              <button className="act danger" onClick={() => onDelete(intention.id)} aria-label="Remove"><Trash2 size={13} /></button>
            </>
          ) : (
            <>
              {isBuy && best && (
                <a className="act" style={{ background: 'var(--good)', color: 'var(--on-accent)', borderColor: 'var(--good)', fontWeight: 600 }}
                   href={buyHref} target="_blank" rel="noopener noreferrer">
                  {hasRealLink ? 'Open product page' : 'See where to buy'} <ExternalLink size={13} />
                </a>
              )}
              <button className="act" onClick={() => checkNow(intention.id)} disabled={checking}>
                {checking ? <span className="spinner" /> : <RefreshCw size={13} />} {checking ? 'Checking…' : 'Check now'}
              </button>
              <button className="act" onClick={() => markBought(intention.id)}>
                <ShoppingBag size={13} /> I bought it
              </button>
              <button className="act" onClick={() => snoozeIntention(intention.id, 30)} title="Pause for 30 days">
                <Pause size={13} /> Snooze
              </button>
              <button className="act" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
              <button className="act danger" onClick={() => onDelete(intention.id)} aria-label="Remove">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>

        {stores.length > 0 && (
          <div className="breakdown-wrap">
            <button className="brk-toggle" onClick={() => setShowStores((s) => !s)} aria-expanded={showStores}>
              <Store size={13} />
              {showStores ? 'Hide stores' : `Compare ${foundCount || stores.length} store${(foundCount || stores.length) === 1 ? '' : 's'}`}
              <ChevronDown size={14} className={`chev ${showStores ? 'open' : ''}`} />
            </button>
            {showStores && <StoreBreakdown stores={stores} query={intention.title} />}
          </div>
        )}
      </div>

      <PriceTide intention={intention} />
    </article>
  );
}
