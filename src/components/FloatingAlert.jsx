import { AlertTriangle, X } from 'lucide-react';

export default function FloatingAlert({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="floating-alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {onClose && (
        <button className="close-alert" onClick={onClose}><X size={16} /></button>
      )}
    </div>
  );
}
