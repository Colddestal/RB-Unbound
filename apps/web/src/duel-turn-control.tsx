export function DuelTurnControl({ status, confirming, disabled = false, onBegin, onConfirm, onCancel }: {
  status?: string;
  confirming: boolean;
  disabled?: boolean;
  onBegin: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <div className="duel-turn-control" role="group" aria-label="Turn controls">
    {status && <span className="duel-turn-status" role="status">{status}</span>}
    {confirming ? <div className="duel-turn-confirm">
      <strong>End this turn?</strong>
      <button className="primary" disabled={disabled} onClick={onConfirm}>Confirm end turn</button>
      <button onClick={onCancel}>Cancel</button>
    </div> : <button className="primary duel-end-turn-button" disabled={disabled} onClick={onBegin}>End Turn</button>}
  </div>;
}
