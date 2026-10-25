import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { DeckDefinition } from '@rb-unbound/tabletop';

export type SavedDeck = { id: string; deck: DeckDefinition; isPrivate?: boolean };
type Account = { username: string; token: string };
type AccountContextValue = { account: Account | null; signIn: (name: string, password: string, register: boolean) => Promise<void>; signOut: () => void };
const AccountContext = createContext<AccountContextValue>({ account: null, signIn: async () => undefined, signOut: () => undefined });
const TOKEN_KEY = 'rb-unbound-account-token';

export async function accountRequest<T>(token: string, path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The server could not save this change.');
  return result;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) void accountRequest<{ username: string }>(token, '/account/me')
      .then(value => { if (window.localStorage.getItem(TOKEN_KEY) === token) setAccount({ token, username: value.username }); })
      .catch(() => { if (window.localStorage.getItem(TOKEN_KEY) === token) window.localStorage.removeItem(TOKEN_KEY); });
  }, []);
  const signIn = async (username: string, password: string, register: boolean) => {
    const response = await fetch(`/api/account/${register ? 'register' : 'login'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    const result = await response.json() as { token?: string; username?: string; error?: string };
    if (!response.ok || !result.token || !result.username) throw new Error(result.error ?? 'Could not sign in. Is the desktop host running?');
    window.localStorage.setItem(TOKEN_KEY, result.token);
    setAccount({ username: result.username, token: result.token });
  };
  const signOut = () => {
    if (account) void accountRequest(account.token, '/account/logout', 'POST').catch(() => undefined);
    window.localStorage.removeItem(TOKEN_KEY);
    setAccount(null);
  };
  return <AccountContext.Provider value={{ account, signIn, signOut }}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}

export function AccountControls() {
  const { account, signIn, signOut } = useAccount();
  const [open, setOpen] = useState(false);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await signIn(username, password, register); setPassword(''); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  return <div className="account-control">
    <button className="account-open" onClick={() => setOpen(value => !value)}>{account ? `@${account.username}` : 'Sign in'}</button>
    {open && <div className="account-popover panel">
      {account ? <><strong>@{account.username}</strong><p>Your decks are stored on this desktop host.</p><button onClick={() => { signOut(); setOpen(false); }}>Sign out</button></>
        : <><h2>{register ? 'Create account' : 'Sign in'}</h2><p>No email. Your username and decks stay on this host. Keep your password: there is no email recovery.</p>
          <form onSubmit={event => { void submit(event); }}>
            <label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required /></label>
            <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={register ? 12 : undefined} required /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy} type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
          </form>
          <button className="account-switch" onClick={() => { setRegister(value => !value); setError(''); }}>{register ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        </>}
    </div>}
  </div>;
}
