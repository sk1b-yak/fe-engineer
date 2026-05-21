import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

const LS_KEY = 'fe-engineer-api-key';
const SESSION = 'playground';

// Render message content: split on ```...``` fences and format code blocks.
function MessageContent({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const nl = part.indexOf('\n');
          const lang = nl > 3 ? part.slice(3, nl).trim() : '';
          const code = nl >= 0 ? part.slice(nl + 1, -3) : part.slice(3, -3);
          return (
            <pre key={i} className="code-block">
              {lang && <span className="lang-tag">{lang}</span>}
              <code>{code}</code>
            </pre>
          );
        }
        return (
          <span key={i} className="text-part">
            {part}
          </span>
        );
      })}
    </>
  );
}

function KeySetup({ onSave }: { onSave: (key: string) => void }) {
  const [val, setVal] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = val.trim();
    if (trimmed) onSave(trimmed);
  }
  return (
    <div className="key-setup">
      <h1>FE Engineer</h1>
      <p className="sub">A front-end engineer agent — built-in Biome linting + UI wiring audit.</p>
      <form onSubmit={submit} className="key-form">
        <label htmlFor="api-key">API Key</label>
        <input
          id="api-key"
          type="password"
          placeholder="Enter CHAT_API_KEY…"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!val.trim()}>
          Connect
        </button>
      </form>
      <p className="hint">
        Key stored in <code>localStorage</code>, sent as <code>?key=</code> on the WebSocket.
        Leave blank if running locally without auth.
      </p>
      <button type="button" className="skip-btn" onClick={() => onSave('')}>
        Skip (local / no auth)
      </button>
    </div>
  );
}

export function App() {
  // null = not yet decided; '' = explicitly skipped (no auth)
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(LS_KEY));
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  function saveKey(key: string) {
    localStorage.setItem(LS_KEY, key);
    setApiKey(key);
  }

  function clearKey() {
    localStorage.removeItem(LS_KEY);
    setApiKey(null);
  }

  // Build query: include key only when a non-empty one is set.
  const query = apiKey ? { key: apiKey } : undefined;

  const agent = useAgent({
    agent: 'FeEngineer',
    name: SESSION,
    query,
  });

  // AI SDK v6: useAgentChat wraps AbstractChat — use sendMessage({ text }) instead of handleSubmit.
  const { messages, sendMessage, status } = useAgentChat({ agent });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (apiKey === null) {
    return <KeySetup onSave={saveKey} />;
  }

  const isLoading = status === 'streaming' || status === 'submitted';

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage({ text });
  }

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <span className="title">FE Engineer</span>
        <span className="badge">qwen2.5-coder · Biome · UI audit</span>
        <button className="key-btn" type="button" onClick={clearKey} title="Change API key">
          ⌂ reset key
        </button>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Ask me to build, lint, or audit UI components.</p>
            <ul>
              <li>&ldquo;Build a Counter with increment and reset buttons.&rdquo;</li>
              <li>&ldquo;Audit this component — make sure every button works.&rdquo; (paste code)</li>
              <li>&ldquo;Clean up this file.&rdquo; (paste code)</li>
            </ul>
          </div>
        )}

        {messages.map((msg) => {
          // AI SDK v6: UIMessage has parts[], not a content string.
          const textParts = msg.parts.filter((p) => p.type === 'text');
          const text = textParts
            .map((p) => ('text' in p ? (p.text as string) : ''))
            .join('');

          return (
            <div key={msg.id} className={`message ${msg.role}`}>
              <span className="role-tag">{msg.role === 'user' ? 'you' : 'fe-engineer'}</span>
              <div className="message-body">
                <MessageContent text={text} />
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="message assistant">
            <span className="role-tag">fe-engineer</span>
            <div className="message-body thinking">thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="input-row" onSubmit={submit}>
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask FE Engineer…"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="send-btn" disabled={isLoading || !input.trim()}>
          {isLoading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
