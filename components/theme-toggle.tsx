"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const themeChangeEvent = "agent-studio-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(themeChangeEvent, callback);
  return () => window.removeEventListener(themeChangeEvent, callback);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const storedTheme = localStorage.getItem("agent-studio-theme");
    const initialTheme: Theme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = initialTheme;
    window.dispatchEvent(new Event(themeChangeEvent));
  }, []);

  function toggleTheme() {
    const nextTheme = getSnapshot() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("agent-studio-theme", nextTheme);
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Cambiar a modo ${theme === "dark" ? "claro" : "oscuro"}`}
      title={`Modo ${theme === "dark" ? "oscuro" : "claro"}`}
    >
      {theme === "dark" ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="17" height="17">
          <circle cx="10" cy="10" r="3.1" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2.2v1.5M10 16.3v1.5M17.8 10h-1.5M3.7 10H2.2m13.3-5.5-1.1 1.1M5.6 14.4l-1.1 1.1m11 0-1.1-1.1M5.6 5.6 4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="17" height="17">
          <path
            d="M16.4 12.2A7.2 7.2 0 0 1 7.8 3.6a7.3 7.3 0 1 0 8.6 8.6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
