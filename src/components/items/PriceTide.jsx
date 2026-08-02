import { useEffect, useState, useRef } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, ReferenceLine, ReferenceArea, YAxis, Tooltip,
} from 'recharts';
import { useShopping } from '../../contexts/ShoppingContext';
import { money, formatShortDate, dipLabel } from '../../utils/helpers';

function TideTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: 'var(--ink)', color: 'var(--surface)', fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem', padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap',
    }}>
      {formatShortDate(p.date)} · {money(p.price)}
    </div>
  );
}

export default function PriceTide({ intention }) {
  const { getIntentionHistory } = useShopping();
  const [points, setPoints] = useState(null);
  const gradId = useRef('tide-' + intention.id).current;
  const best = intention.currentBest || {};
  const ctx = intention.priceContext || {};

  useEffect(() => {
    let alive = true;
    getIntentionHistory(intention.id, 180)
      .then((res) => { if (alive) setPoints(res.points || []); })
      .catch(() => { if (alive) setPoints([]); });
    return () => { alive = false; };
    // Refetch when the item's last check time changes.
  }, [intention.id, intention.lastCheckedAt, getIntentionHistory]);

  const target = intention.targetPrice;
  const low = ctx.typicalLow ?? best.typicalLow;
  const high = ctx.typicalHigh ?? best.typicalHigh;

  const header = (
    <div className="viz-head">
      <span className="lab">Price tide</span>
      <span className="lab">{dipLabel(ctx.dealFrequency || best.dealFrequency)}</span>
    </div>
  );

  if (points === null) {
    return <div className="card-viz">{header}<div className="viz-empty"><span className="spinner" /></div></div>;
  }

  if (points.length < 2) {
    return (
      <div className="card-viz">
        {header}
        <div className="viz-empty">
          No price history yet.<br />The wave builds as ZeroTide checks over time.
        </div>
      </div>
    );
  }

  // Y domain padded around all series + target + band.
  const vals = points.map((p) => p.price).concat([target, low, high].filter((v) => typeof v === 'number'));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.12 || 1;
  const domain = [min - pad, max + pad];
  const lastIdx = points.length - 1;

  return (
    <div className="card-viz">
      {header}
      <div style={{ width: '100%', flex: 1, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height={132}>
          <AreaChart data={points} margin={{ top: 12, right: 6, bottom: 4, left: 6 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--wave)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--wave)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={domain} />
            {typeof low === 'number' && typeof high === 'number' && (
              <ReferenceArea y1={low} y2={high} fill="var(--band)" strokeOpacity={0} />
            )}
            {typeof target === 'number' && (
              <ReferenceLine y={target} stroke="var(--ink-3)" strokeDasharray="4 4" strokeWidth={1.4} />
            )}
            <Tooltip content={<TideTooltip />} cursor={{ stroke: 'var(--ink-3)', strokeDasharray: '3 3' }} />
            <Area
              type="monotone" dataKey="price" stroke="var(--wave)" strokeWidth={2}
              fill={`url(#${gradId})`} isAnimationActive={false}
              dot={(props) => (props.index === lastIdx
                ? <circle key="end" cx={props.cx} cy={props.cy} r={4}
                    fill={intention.verdict === 'buy' ? 'var(--good)' : 'var(--wave)'}
                    stroke="var(--surface)" strokeWidth={2} />
                : <g key={props.index} />)}
              activeDot={{ r: 4, fill: 'var(--wave)', stroke: 'var(--surface)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span><i className="wave" />price</span>
        {typeof target === 'number' && <span><i className="tgt" />your price</span>}
        {typeof low === 'number' && <span><i className="band" />usual range</span>}
      </div>
    </div>
  );
}
