import { useState } from 'react';
import { Heart, CheckCircle } from 'lucide-react';

const presets = [100, 500, 1000, 2000, 5000, 10000];

export default function DonationForm({ incidents, onDonate }) {
  const [amount, setAmount] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    setLoading(true);
    try {
      await onDonate(Number(amount), incidentId, message);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setAmount(''); setMessage(''); setIncidentId(''); }, 3000);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <CheckCircle size={48} color="var(--success)" style={{ marginBottom: '1rem' }} />
        <h3 style={{ marginBottom: '0.5rem' }}>Thank You!</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Your donation of ₹{amount} has been recorded.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="fade-in">
      <div className="amount-grid">
        {presets.map((p) => (
          <button key={p} type="button" className={`amount-btn ${Number(amount) === p ? 'selected' : ''}`} onClick={() => setAmount(p)}>
            ₹{p.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="input-group">
        <label>Custom Amount (₹)</label>
        <input type="number" className="input-field" placeholder="Enter amount" value={amount} onChange={(e) => setAmount(e.target.value)} min="1" required />
      </div>
      {incidents && incidents.length > 0 && (
        <div className="input-group">
          <label>Donate For (Optional)</label>
          <select className="input-field" value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
            <option value="">General Fund</option>
            {incidents.map((inc) => (
              <option key={inc.id} value={inc.id}>{inc.title} - {inc.disasterType}</option>
            ))}
          </select>
        </div>
      )}
      <div className="input-group">
        <label>Message (Optional)</label>
        <input type="text" className="input-field" placeholder="Stay strong!" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
        {loading ? <span className="spinner" /> : <><Heart size={18} /> Donate Now</>}
      </button>
    </form>
  );
}
