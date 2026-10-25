import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [reseller, setReseller] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/me');
      setReseller(data.reseller);
    } catch (_) {
      setReseller(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username, password) => {
    const { data } = await api.post('/login', { username, password });
    setReseller(data.reseller);
    return data.reseller;
  };

  const logout = async () => {
    try {
      await api.post('/logout');
    } catch (_) {
      /* ignore */
    }
    setReseller(null);
  };

  return (
    <AuthContext.Provider value={{ reseller, setReseller, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
