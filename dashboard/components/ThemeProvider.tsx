'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
});

// Derive a per-user storage key from the session cookie so that
// User A's theme preference never overwrites User B's.
function getThemeKey(): string {
  if (typeof document === 'undefined') return 'retail-os-theme-default';
  // Read the tenant+staff identity baked into cookies by the login route
  const staffCookie = document.cookie.split('; ').find(r => r.startsWith('staff_name='));
  const tenantCookie = document.cookie.split('; ').find(r => r.startsWith('tenant_id='));
  const staff = staffCookie ? staffCookie.split('=')[1] : 'default';
  const tenant = tenantCookie ? tenantCookie.split('=')[1] : 'default';
  return `retail-os-theme-${tenant}-${staff}`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const key = getThemeKey();
    const saved = localStorage.getItem(key) as Theme | null;
    const initial: Theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const key = getThemeKey();
    localStorage.setItem(key, next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div style={{ visibility: mounted ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
