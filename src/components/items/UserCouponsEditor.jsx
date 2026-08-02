import { useState } from 'react';
import { X, Plus, Ticket } from 'lucide-react';

// Lets the user save their own known promo codes for an item (e.g. "TRS -20%").
// These always show as "maybe" prices, independent of what the AI finds.
export default function UserCouponsEditor({ coupons, onChange }) {
  const [code, setCode] = useState('');
  const [val, setVal] = useState('');
  const [unit, setUnit] = useState('percent'); // 'percent' | 'amount'

  const add = () => {
    const c = code.trim();
    if (!c) return;
    if (coupons.some((x) => x.code.toLowerCase() === c.toLowerCase())) { setCode(''); return; }
    const num = parseFloat(val);
    const entry = { code: c.slice(0, 40), percent: null, amount: null };
    if (isFinite(num) && num > 0) {
      if (unit === 'percent') entry.percent = Math.min(num, 100);
      else entry.amount = num;
    }
    onChange([...coupons, entry]);
    setCode(''); setVal('');
  };

  const remove = (c) => onChange(coupons.filter((x) => x.code !== c));

  const label = (x) =>
    x.percent ? `${x.code} · −${x.percent}%` : x.amount ? `${x.code} · −$${x.amount}` : x.code;

  return (
    <div className="field full">
      <label>Your promo codes <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional — codes you know work, shown as "maybe" prices)</span></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Code (e.g. TRS)" style={{ flex: '2 1 120px' }} />
        <input type="number" min="0" value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="off" style={{ flex: '1 1 70px' }} />
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button type="button" className={unit === 'percent' ? 'active' : ''} onClick={() => setUnit('percent')}>%</button>
          <button type="button" className={unit === 'amount' ? 'active' : ''} onClick={() => setUnit('amount')}>$</button>
        </div>
        <button className="btn btn-ghost" type="button" onClick={add}><Plus size={15} /></button>
      </div>

      {coupons.length > 0 && (
        <div className="store-tags">
          {coupons.map((x) => (
            <span className="store-tag" key={x.code}>
              <Ticket size={12} style={{ color: 'var(--accent)' }} /> {label(x)}
              <button type="button" onClick={() => remove(x.code)} aria-label={`Remove ${x.code}`}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
