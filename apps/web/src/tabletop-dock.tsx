import { useState } from 'react';
import type { CardDefinition, GameModule } from '@rb-unbound/tabletop';
import { CardInspector, type InspectableCard } from './card-inspector';

export type DockChatMessage = {
  id: string;
  displayName: string;
  body: string;
  sentAt?: string;
};

export type DockHistoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

export function TabletopDock({
  card,
  pinned,
  onClear,
  module,
  catalog,
  chat,
  history,
}: {
  card?: InspectableCard;
  pinned: boolean;
  onClear: () => void;
  module?: GameModule;
  catalog?: readonly CardDefinition[];
  chat?: {
    messages: readonly DockChatMessage[];
    value: string;
    setValue: (value: string) => void;
    send: () => void;
  };
  history: readonly DockHistoryEntry[];
}) {
  const [tab, setTab] = useState<'card' | 'chat' | 'history'>('card');

  return <aside className="tabletop-dock panel">
    <div className="dock-tabs" role="tablist" aria-label="Table context">
      <button role="tab" aria-selected={tab === 'card'} className={tab === 'card' ? 'active' : ''} onClick={() => setTab('card')}>Card Info</button>
      <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
      <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
    </div>

    <div className="dock-body">
      {tab === 'card' && <CardInspector
        card={card}
        pinned={pinned}
        onClear={onClear}
        module={module}
        catalog={catalog}
      />}

      {tab === 'chat' && <section className="dock-chat" aria-label="Room chat">
        {chat ? <>
          <div className="dock-log" aria-live="polite">
            {chat.messages.length
              ? chat.messages.map(message => <p key={message.id}><strong>{message.displayName}</strong> {message.body}</p>)
              : <p className="muted">No messages yet.</p>}
          </div>
          <form onSubmit={event => { event.preventDefault(); chat.send(); }}>
            <input
              value={chat.value}
              maxLength={500}
              placeholder="Message the room…"
              onChange={event => chat.setValue(event.target.value)}
            />
            <button type="submit">Send</button>
          </form>
        </> : <div className="dock-empty">
          <span>◇</span>
          <p>Text chat is available while playing in a multiplayer room.</p>
        </div>}
      </section>}

      {tab === 'history' && <section className="dock-history" aria-label="Match history">
        <div className="dock-log">
          {history.length
            ? [...history].reverse().map(entry => <div className="history-entry" key={entry.id}>
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                <span>{entry.text}</span>
              </div>)
            : <div className="dock-empty">
                <span>◇</span>
                <p>No actions recorded yet.</p>
              </div>}
        </div>
      </section>}
    </div>
  </aside>;
}
