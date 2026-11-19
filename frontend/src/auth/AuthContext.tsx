import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '../api/auth';
import { api, refreshAccessToken, setAccessToken } from '../api/client';

type Auth = {
  user: User | null;
  accessToken: string | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
};
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Auth['status']>('loading');
  useEffect(() => {
    refreshAccessToken().then(async (token) => {
      if (!token) {
        setStatus('anonymous');
        return;
      }
      setAccessToken(token);
      setToken(token);
      api
        .get('/auth/me')
        .then((response) => {
          setUser(response.data.user);
          setStatus('authenticated');
        })
        .catch(() => setStatus('anonymous'));
    });
  }, []);
  const value: Auth = {
    user,
    accessToken,
    status,
    setSession: (token, nextUser) => {
      setAccessToken(token);
      setToken(token);
      setUser(nextUser);
      setStatus('authenticated');
    },
    clearSession: () => {
      setAccessToken(null);
      setToken(null);
      setUser(null);
      setStatus('anonymous');
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('useAuth outside provider');
  return value;
}
