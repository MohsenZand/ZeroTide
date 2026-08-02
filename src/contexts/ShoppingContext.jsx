import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import shoppingService from '../services/shoppingService';

const ShoppingContext = createContext(null);

export function ShoppingProvider({ children }) {
  const [intentions, setIntentions] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [authError, setAuthError] = useState(false);
  const [checkingIds, setCheckingIds] = useState({}); // id -> true while "check now" runs
  const [toast, setToast] = useState(null); // { type, message }

  const notify = useCallback((message, type = 'info') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [i, s] = await Promise.all([
        shoppingService.listIntentions(),
        shoppingService.getSettings(),
      ]);
      setIntentions(i.intentions || []);
      setSettings(s.settings || null);
      setAuthError(false);
    } catch (err) {
      if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
        setAuthError(true);
      } else {
        setLoadError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const addIntention = useCallback(async (data) => {
    const res = await shoppingService.addIntention(data);
    setIntentions((prev) => [res.intention, ...prev]);
    notify('Now watching “' + res.intention.title + '”.', 'success');
    return res.intention;
  }, [notify]);

  const updateIntention = useCallback(async (id, patch) => {
    const res = await shoppingService.updateIntention(id, patch);
    setIntentions((prev) => prev.map((it) => (it.id === id ? res.intention : it)));
    return res.intention;
  }, []);

  const deleteIntention = useCallback(async (id) => {
    await shoppingService.deleteIntention(id);
    setIntentions((prev) => prev.filter((it) => it.id !== id));
    notify('Removed from your watch list.', 'info');
  }, [notify]);

  const markBought = useCallback(async (id) => {
    await shoppingService.markBought(id);
    await loadDashboard();
    notify('Nice — logged as bought.', 'success');
  }, [loadDashboard, notify]);

  const resumeIntention = useCallback(async (id) => {
    await shoppingService.resumeIntention(id);
    await loadDashboard();
    notify('Resumed — watching again.', 'success');
  }, [loadDashboard, notify]);

  const snoozeIntention = useCallback(async (id, days) => {
    await shoppingService.snoozeIntention(id, days);
    await loadDashboard();
    notify('Paused.', 'info');
  }, [loadDashboard, notify]);

  const checkNow = useCallback(async (id) => {
    setCheckingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await shoppingService.checkIntentionNow(id);
      // Merge fresh verdict/currentBest into the item.
      setIntentions((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, currentBest: res.currentBest, verdict: res.verdict, verdictReason: res.verdictReason, savings: res.savings, latestStores: res.stores, lastCheckedAt: Date.now() }
            : it
        )
      );
      notify('Price updated.', 'success');
    } catch (err) {
      notify(err.message, err.code === 'resource-exhausted' ? 'warn' : 'error');
    } finally {
      setCheckingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [notify]);

  const saveSettings = useCallback(async (data) => {
    const res = await shoppingService.updateSettings(data);
    setSettings(res.settings);
    notify('Settings saved.', 'success');
    return res.settings;
  }, [notify]);

  const value = {
    intentions, settings, loading, loadError, authError, checkingIds, toast,
    loadDashboard, addIntention, updateIntention, deleteIntention, markBought, resumeIntention, snoozeIntention, checkNow, saveSettings, notify,
    sendTestEmail: shoppingService.sendTestEmail,
    getIntentionHistory: shoppingService.getIntentionHistory,
  };

  return <ShoppingContext.Provider value={value}>{children}</ShoppingContext.Provider>;
}

export function useShopping() {
  const ctx = useContext(ShoppingContext);
  if (!ctx) throw new Error('useShopping must be used inside ShoppingProvider');
  return ctx;
}
