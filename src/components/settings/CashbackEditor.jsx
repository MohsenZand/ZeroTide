import { useState } from 'react';
import { X, Plus } from 'lucide-react';

const SUGGESTIONS = [
  'Rakuten',
  'Capital One Shopping',
  'TopCashback',
  'Honey Gold',
  'Ibotta',
  'RetailMeNot',
];

// The user's enrolled cashback programs. Free-text so they can describe
// card/loyalty perks too, e.g. "Amazon Prime Visa 5% at Amazon" or "iHerb Rewards 10%".
export default function CashbackEditor({ sources, onChange }) {
  const [input, setInput] = useState('');

  const add = (name) => {
    const t = name.trim();
    if (!t) return;
    if (sources.some((s) => s.toLowerCase() === t.toLowerCase())) return;
    onChange([...sources, t]);
    setInput('');
  };
  const remove = (name) => onChange(sources.filter((s) => s !== name));
  const unused = SUGGESTIONS.filter((s) => !sources.some((x) => x.toLowerCase() === s.toLowerCase()));

  return (
    <div className="field full">
      <label>Your cashback programs</label>
      <span style={{ color: 'var(--ink-3)', fontSize: '0.76rem', margin: '2px 0 6px' }}>
        Only cashback you can actually get through these counts toward the true price. Add cards/loyalty perks as free text (e.g. “Amazon Prime Visa 5% at Amazon”).
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(input))}
          placeholder="Add a cashback program and press Enter"
          style={{ flex: 1 }}
        />
        <button className="btn btn-ghost" type="button" onClick={() => add(input)}><Plus size={15} /></button>
      </div>

      <div className="store-tags">
        {sources.map((s) => (
          <span className="store-tag" key={s}>
            {s}
            <button type="button" onClick={() => remove(s)} aria-label={`Remove ${s}`}><X size={13} /></button>
          </span>
        ))}
        {sources.length === 0 && (
          <span style={{ color: 'var(--ink-3)', fontSize: '0.84rem' }}>None — no cashback will be counted toward true prices.</span>
        )}
      </div>

      {unused.length > 0 && (
        <div className="suggest">
          {unused.map((s) => (
            <button type="button" key={s} onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
