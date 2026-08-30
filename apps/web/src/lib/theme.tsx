import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
const LS_THEME = "my-zeta-theme";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }>({
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(LS_THEME) as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
    // OS設定を尊重
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return "light";
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(LS_THEME, t);
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
