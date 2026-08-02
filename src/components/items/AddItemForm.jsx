import { useState } from 'react';
import { useShopping } from '../../contexts/ShoppingContext';
import { isNonEmptyName, parsePrice } from '../../utils/validators';
import UserCouponsEditor from './UserCouponsEditor';

// Doubles as the add form and the edit form. Pass an `intention` to edit it.
export default function AddItemForm({ onClose, intention }) {
  const { addIntention, updateIntention, checkNow } = useShopping();
  const isEdit = !!intention;

  const [title, setTitle] = useState(intention?.title || '');
  const [price, setPrice] = useState(
    typeof intention?.targetPrice === 'number' ? String(intention.targetPrice) : ''
  );
  const [kind, setKind] = useState(intention?.kind || 'Recurring');
  const [matchType, setMatchType] = useState(intention?.matchType || 'specific');
  const [repeatDays, setRepeatDays] = useState(
    typeof intention?.repeatIntervalDays === 'number' ? String(intention.repeatIntervalDays) : ''
  );
  const [stores, setStores] = useState((intention?.stores || []).join(', '));
  const [userCoupons, setUserCoupons] = useState(intention?.userCoupons || []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const flexible = matchType === 'flexible';

  const submit = async () => {
    if (!isNonEmptyName(title)) {
      setError('Give the item a name so ZeroTide knows what to watch.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        targetPrice: parsePrice(price),
        kind,
        matchType,
        repeatIntervalDays: kind === 'Recurring' && repeatDays ? parseInt(repeatDays, 10) : null,
        userCoupons,
        stores: stores.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (isEdit) {
        await updateIntention(intention.id, payload);
        onClose();
      } else {
        const created = await addIntention(payload);
        onClose();
        // Auto-price the new item right away so it doesn't sit at "No price yet"
        // until the daily run. Fire-and-forget: the card shows its own spinner.
        if (created?.id) checkNow(created.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <h3>{isEdit ? 'Edit intention' : 'Set an intention'}</h3>
      <div className="sub">
        {isEdit
          ? 'Update what you’re watching or the price you’d pay. Run “Check now” after saving to re-price it against your new target.'
          : 'Tell ZeroTide what you want and the most you’d pay. Then forget about it — you’ll only hear from us when it hits.'}
      </div>
      <div className="form-grid">
        <div className="field full">
          <label>Match</label>
          <div className="seg">
            <button type="button" className={matchType === 'specific' ? 'active' : ''} onClick={() => setMatchType('specific')}>Specific product</button>
            <button type="button" className={flexible ? 'active' : ''} onClick={() => setMatchType('flexible')}>Flexible search</button>
          </div>
          <span style={{ color: 'var(--ink-3)', fontSize: '0.76rem', marginTop: 4 }}>
            {flexible
              ? 'Finds any product matching your description under the cap (e.g. shoes, a jacket).'
              : 'Tracks one exact item over time (e.g. a specific grocery product).'}
          </span>
        </div>
        <div className="field full">
          <label htmlFor="i-title">{flexible ? 'Describe what you want' : 'What are you watching?'}</label>
          <input id="i-title" type="text" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={flexible
              ? 'e.g. luxury black men’s dress shoe, size 10'
              : 'e.g. Thorne Basic Nutrients 2/Day, 120 capsules'} />
        </div>
        <div className="field">
          <label htmlFor="i-price">{flexible ? 'Price cap' : "I'd buy it at"}</label>
          <input id="i-price" type="text" inputMode="decimal" value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={flexible ? '$200' : '$9.00 (optional)'} />
        </div>
        <div className="field">
          <label>Type</label>
          <div className="seg">
            <button type="button" className={kind === 'Recurring' ? 'active' : ''} onClick={() => setKind('Recurring')}>Recurring</button>
            <button type="button" className={kind === 'One-off' ? 'active' : ''} onClick={() => setKind('One-off')}>One-off</button>
          </div>
        </div>
        {kind === 'Recurring' && (
          <div className="field">
            <label htmlFor="i-repeat">Rebuy every <span style={{ textTransform: 'none', letterSpacing: 0 }}>(days, optional)</span></label>
            <input id="i-repeat" type="number" min={1} max={365} value={repeatDays}
              onChange={(e) => setRepeatDays(e.target.value)} placeholder="30" />
          </div>
        )}
        <div className="field full">
          <label htmlFor="i-stores">Where to look <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional — blank = your default stores)</span></label>
          <input id="i-stores" type="text" value={stores}
            onChange={(e) => setStores(e.target.value)}
            placeholder={flexible ? 'Nordstrom, SSENSE, Mr Porter' : 'Amazon, iHerb, Target'} />
        </div>
        <UserCouponsEditor coupons={userCoupons} onChange={setUserCoupons} />
      </div>
      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Start watching'}
        </button>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
      </div>
    </section>
  );
}
