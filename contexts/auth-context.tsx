"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authenticated: boolean;
  accessToken: string | null;
  login: (telegramUser: TelegramAuthData) => Promise<void>;
  logout: () => Promise<void>;
}

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  hash: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  authenticated: false,
  accessToken: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('tg_notes_user');
    const savedToken = localStorage.getItem('tg_notes_access_token');
    if (savedUser && savedToken) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        setAccessToken(savedToken);

        // Set the Supabase session using the saved token
        supabase.auth.setSession({
          access_token: savedToken,
          refresh_token: localStorage.getItem('tg_notes_refresh_token') || '',
        }).then(({ error }) => {
          if (error) {
            console.error('Session error:', error);
            // Session expired, clear
            setUser(null);
            setAccessToken(null);
            localStorage.removeItem('tg_notes_user');
            localStorage.removeItem('tg_notes_access_token');
            localStorage.removeItem('tg_notes_refresh_token');
          }
        });
      } catch {
        console.error('Failed to parse saved auth data');
        localStorage.removeItem('tg_notes_user');
        localStorage.removeItem('tg_notes_access_token');
        localStorage.removeItem('tg_notes_refresh_token');
      }
    }
    setLoading(false);
  }, []);

  // Keep the access token in sync when supabase-js silently refreshes the session.
  // Access tokens expire after ~1 hour; without this, every API call 401s until
  // the page is reloaded.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setAccessToken(session.access_token);
        localStorage.setItem('tg_notes_access_token', session.access_token);
        if (session.refresh_token) {
          localStorage.setItem('tg_notes_refresh_token', session.refresh_token);
        }
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const login = useCallback(async (telegramUser: TelegramAuthData) => {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramUser),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Authentication failed');
    }

    const { user: dbUser, accessToken: token, refreshToken } = await res.json();

    // Set Supabase auth session
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: token,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Session error:', sessionError);
      throw new Error('Failed to establish session');
    }

    setUser(dbUser);
    setAccessToken(token);
    localStorage.setItem('tg_notes_user', JSON.stringify(dbUser));
    localStorage.setItem('tg_notes_access_token', token);
    localStorage.setItem('tg_notes_refresh_token', refreshToken);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('tg_notes_user');
    localStorage.removeItem('tg_notes_access_token');
    localStorage.removeItem('tg_notes_refresh_token');
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, authenticated: !!user, accessToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
