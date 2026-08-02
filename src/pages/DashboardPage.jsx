import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useShopping } from '../contexts/ShoppingContext';
import { money, sumSavings, verdictMeta } from '../utils/helpers';
import ItemList from '../components/items/ItemList';
import AddItemForm from '../components/items/AddItemForm';
import EmptyState from '../components/common/EmptyState';

export default function DashboardPage() {
  const { intentions, loading, loadError, deleteIntention } = useShopping();
  const [showForm, setShowForm] = useState(false);

  if (loading) {
    return <div className="center-load"><span className="spinner" /> Loading your watch list…</div>;
  }
  if (loadError) {
    return (
      <EmptyState title="Couldn't reach ZeroTide">
        {loadError}<br />
        Check that the Cloud Functions are deployed (or the emulator is running) and your Firebase config is set.
      </EmptyState>
    );
  }

  const ready = intentions.filter((it) => verdictMeta(it.verdict).group === 'ready');
  const watching = intentions.filter((it) => verdictMeta(it.verdict).group === 'watching');
  const snoozed = intentions.filter((it) => verdictMeta(it.verdict).group === 'snoozed');
  const closeCount = intentions.filter((it) => it.verdict === 'close').length;
  const waitCount = watching.length - closeCount;
  const saved = sumSavings(intentions);

  return (
    <>
      <section className="ribbon" aria-label="Summary">
        <div className="stat-hero">
          <div className="amount tabnum">{money(saved)}</div>
          <div className="label">
            in <b>deal value</b> found right now — coupons + cash back + sale savings across your list.
          </div>
        </div>
        <div className="counts">
          <div className="count-row"><span className="pip good" /><b className="tabnum">{ready.length}</b> ready to buy — your terms are met</div>
          <div className="count-row"><span className="pip warn" /><b className="tabnum">{closeCount}</b> getting close to your price</div>
          <div className="count-row"><span className="pip wait" /><b className="tabnum">{waitCount}</b> watching, waiting for low tide</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} style={{ verticalAlign: '-3px' }} /> New intention
        </button>
      </section>

      {showForm && <AddItemForm onClose={() => setShowForm(false)} />}

      {intentions.length === 0 && !showForm && (
        <EmptyState title="Nothing on watch yet">
          Add your first intention — an item plus the price you'd pay — and ZeroTide will watch the wave for you.
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} style={{ verticalAlign: '-3px' }} /> New intention
            </button>
          </div>
        </EmptyState>
      )}

      {ready.length > 0 && (
        <section className="group">
          <div className="group-head">
            <span className="title">Ready to buy</span>
            <span className="hint">your price is met and the tide is low — act now</span>
          </div>
          <ItemList items={ready} onDelete={deleteIntention} />
        </section>
      )}

      {watching.length > 0 && (
        <section className="group">
          <div className="group-head">
            <span className="title">Watching</span>
            <span className="hint">ZeroTide is tracking the wave — you'll be pinged at the trough</span>
          </div>
          <ItemList items={watching} onDelete={deleteIntention} />
        </section>
      )}

      {snoozed.length > 0 && (
        <section className="group">
          <div className="group-head">
            <span className="title">Paused</span>
            <span className="hint">bought or snoozed — not checked or emailed until you resume</span>
          </div>
          <ItemList items={snoozed} onDelete={deleteIntention} />
        </section>
      )}

      <footer>
        <b>How to read this:</b> the wave is each item's price over time; the dashed line is your price; the shaded band is where the price usually sits.
        Prices are AI estimates from live web search, shown "as of" each check — <b>confirm at the store before buying.</b> ZeroTide watches so you don't have to; you decide.
      </footer>
    </>
  );
}
