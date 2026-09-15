import type { Caller } from '@amc/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { currentCaller, signOut as signOutRequest } from './api.js';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-code' }
  | { status: 'signed-in'; caller: Caller };

interface SessionValue {
  readonly state: SessionState;
  refresh(): Promise<void>;
  needsCode(): void;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * The session lives on the server, so this asks rather than remembers. On a
 * refresh the application does not know whether it is signed in until the
 * server says, which is the honest position: anything held locally could be
 * out of date the moment an administrator suspends the account.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const caller = await currentCaller();
      setState(caller ? { status: 'signed-in', caller } : { status: 'signed-out' });
    } catch {
      setState({ status: 'signed-out' });
    }
  }, []);

  const needsCode = useCallback(() => setState({ status: 'needs-code' }), []);

  const signOut = useCallback(async () => {
    await signOutRequest();
    setState({ status: 'signed-out' });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ state, refresh, needsCode, signOut }),
    [state, refresh, needsCode, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
