import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { STORE_SUGGESTIONS } from '../../utils/constants';

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function StoreListEditor({ stores, onChange }) {
  const [input, setInput] = useState('');

  const add = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (stores.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...stores, { id: slug(trimmed), name: trimmed }]);
    setInput('');
  };

  const remove = (id) => onChange(stores.filter((s) => s.id !== id));
  const unused = STORE_SUGGESTIONS.filter((s) => !stores.some((st) => st.name.toLowerCase() === s.toLowerCase()));

  return (
    <div className="field full">
      <label>Stores to watch</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(input))}
          placeholder="Add a store and press Enter"
          style={{ flex: 1 }}
        />
        <button className="btn btn-ghost" type="button" onClick={() => add(input)}><Plus size={15} /></button>
      </div>

      <div className="store-tags">
        {stores.map((s) => (
          <span className="store-tag" key={s.id}>
            {s.name}
            <button type="button" onClick={() => remove(s.id)} aria-label={`Remove ${s.name}`}><X size={13} /></button>
          </span>
        ))}
        {stores.length === 0 && <span style={{ color: 'var(--ink-3)', fontSize: '0.84rem' }}>No stores yet — add a few, or leave empty to let ZeroTide pick.</span>}
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
