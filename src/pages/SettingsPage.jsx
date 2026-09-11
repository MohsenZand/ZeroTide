import { useState, useEffect } from 'react';
import { useShopping } from '../contexts/ShoppingContext';
import { isValidZip } from '../utils/validators';
import ZipCodeField from '../components/settings/ZipCodeField';
import StoreListEditor from '../components/settings/StoreListEditor';
import CashbackEditor from '../components/settings/CashbackEditor';

export default function SettingsPage() {
  const { settings, saveSettings, sendTestEmail, notify } = useShopping();
  const [zip, setZip] = useState('');
  const [stores, setStores] = useState([]);
  const [cooldown, setCooldown] = useState(20);
  const [maxCalls, setMaxCalls] = useState(60);
  const [rediscoverDays, setRediscoverDays] = useState(30);
  const [cashbackSources, setCashbackSources] = useState([]);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setZip(settings.zipCode || '');
    setStores(settings.preferredStores || []);
    setCooldown(settings.manualCheckCooldownMinutes ?? 20);
    setMaxCalls(settings.maxDailyAiCalls ?? 60);
    setRediscoverDays(settings.rediscoverEveryDays ?? 30);
    setCashbackSources(settings.cashbackSources || []);
    setNotifyEmail(settings.notifyEmail || '');
    setNotifyEnabled(Boolean(settings.notifyEnabled));
  }, [settings]);

  const save = async () => {
    if (!isValidZip(zip)) {
      setError('ZIP code must be 5 digits.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await saveSettings({
        zipCode: zip,
        preferredStores: stores,
        manualCheckCooldownMinutes: Number(cooldown),
        maxDailyAiCalls: Number(maxCalls),
        rediscoverEveryDays: Number(rediscoverDays),
        cashbackSources,
        notifyEmail,
        notifyEnabled,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await saveSettings({ notifyEmail, notifyEnabled });
      const res = await sendTestEmail();
      notify(`Test email sent to ${res.sentTo}.`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  if (!settings) {
    return <div className="center-load"><span className="spinner" /> Loading settings…</div>;
  }

  return (
    <section className="panel" style={{ marginBottom: 0 }}>
      <h3>Settings</h3>
      <div className="sub">Where ZeroTide looks, and how hard it works. These apply to every intention unless an item overrides its stores.</div>

      <div className="form-grid">
        <ZipCodeField value={zip} onChange={setZip} />
        <div className="field">
          <label>Billable web searches this month</label>
          {/* The only thing that actually costs money. Daily checks re-read pages
              ZeroTide already knows and are free, so this counter is what to watch. */}
          <input
            type="text"
            readOnly
            value={`${settings.groundedSearchesThisMonth || 0} of ${settings.freeSearchesPerMonth || 5000} free`}
            style={{ color: (settings.estimatedMonthCostUsd || 0) > 0 ? 'var(--warn)' : 'var(--good)' }}
          />
          <div className="hint">
            {(settings.estimatedMonthCostUsd || 0) > 0
              ? `Past the free allowance — about $${settings.estimatedMonthCostUsd.toFixed(2)} so far this month.`
              : `Free so far. ${settings.aiCallsToday || 0} of ${maxCalls} searching checks used today.`}
          </div>
        </div>
        <StoreListEditor stores={stores} onChange={setStores} />
        <CashbackEditor sources={cashbackSources} onChange={setCashbackSources} />
      </div>

      <div className="settings-row">
        <div className="field">
          <label htmlFor="cooldown">“Check now” cooldown (minutes)</label>
          <input id="cooldown" type="number" min={0} max={240} value={cooldown}
            onChange={(e) => setCooldown(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="maxcalls">Max searching checks per day</label>
          <input id="maxcalls" type="number" min={1} max={500} value={maxCalls}
            onChange={(e) => setMaxCalls(e.target.value)} />
          <div className="hint">Caps only the billable web searches, not the free daily page re-reads.</div>
        </div>
        <div className="field">
          <label htmlFor="rediscover">Look for new sellers every (days)</label>
          <input id="rediscover" type="number" min={0} max={365} value={rediscoverDays}
            onChange={(e) => setRediscoverDays(e.target.value)} />
          <div className="hint">
            Between sweeps, ZeroTide re-reads the pages it already found — free. Raise this to spend
            less, lower it to catch new sellers sooner. 0 turns sweeps off.
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 22, paddingTop: 18 }}>
        <h3 style={{ fontSize: '0.98rem', margin: '0 0 4px' }}>Email me at low tide</h3>
        <div className="sub">When the daily check finds an item at your price, ZeroTide emails you a digest — so you can walk away and let it watch.</div>
        <div className="settings-row">
          <div className="field">
            <label htmlFor="notify-email">Notification email</label>
            <input id="notify-email" type="email" value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="switch-row">
              <input type="checkbox" checked={notifyEnabled} onChange={(e) => setNotifyEnabled(e.target.checked)} />
              <span>Send me Buy-now emails</span>
            </label>
          </div>
        </div>
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={test} disabled={testing || !notifyEmail}>
            {testing ? 'Sending…' : 'Send test email'}
          </button>
        </div>
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>

      <p style={{ color: 'var(--ink-3)', fontSize: '0.8rem', marginTop: 18, lineHeight: 1.6 }}>
        Each price check is one Google-Search-grounded AI call (billable), so the daily cap keeps costs predictable.
        The scheduled refresh runs once a day; “Check now” lets you refresh a single item on demand within the cooldown.
      </p>
    </section>
  );
}
