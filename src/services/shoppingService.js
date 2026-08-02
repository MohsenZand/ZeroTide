import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

// Thin wrappers around the Cloud Function callables. Every read/write goes
// through here — the client never touches Firestore directly (it's locked down).

const call = (name) => httpsCallable(functions, name);

const fns = {
  listIntentions: call('listIntentions'),
  addIntention: call('addIntention'),
  updateIntention: call('updateIntention'),
  deleteIntention: call('deleteIntention'),
  getIntentionHistory: call('getIntentionHistory'),
  markBought: call('markBought'),
  resumeIntention: call('resumeIntention'),
  snoozeIntention: call('snoozeIntention'),
  checkIntentionNow: call('checkIntentionNow'),
  getSettings: call('getSettings'),
  updateSettings: call('updateSettings'),
  sendTestEmail: call('sendTestEmail'),
};

// Unwraps { data } and surfaces a clean Error (message + code) to the UI.
async function invoke(fn, payload) {
  try {
    const res = await fn(payload || {});
    return res.data;
  } catch (err) {
    const e = new Error(err?.message || 'Something went wrong.');
    e.code = err?.code || 'internal';
    throw e;
  }
}

export const shoppingService = {
  listIntentions: () => invoke(fns.listIntentions),
  addIntention: (data) => invoke(fns.addIntention, data),
  updateIntention: (id, patch) => invoke(fns.updateIntention, { id, patch }),
  deleteIntention: (id) => invoke(fns.deleteIntention, { id }),
  getIntentionHistory: (id, days) => invoke(fns.getIntentionHistory, { id, days }),
  markBought: (id) => invoke(fns.markBought, { id }),
  resumeIntention: (id) => invoke(fns.resumeIntention, { id }),
  snoozeIntention: (id, days) => invoke(fns.snoozeIntention, { id, days }),
  checkIntentionNow: (id) => invoke(fns.checkIntentionNow, { id }),
  getSettings: () => invoke(fns.getSettings),
  updateSettings: (data) => invoke(fns.updateSettings, data),
  sendTestEmail: () => invoke(fns.sendTestEmail),
};

export default shoppingService;
