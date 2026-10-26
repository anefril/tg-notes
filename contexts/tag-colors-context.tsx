"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { tagBadgeClass } from "@/lib/utils";

type ColorMap = Record<string, string>;

interface TagColorsContextType {
  colors: ColorMap;
  colorClass: (tag: string) => string;
  setTagColor: (tag: string, key: string | null) => void;
}

const TagColorsContext = createContext<TagColorsContextType>({
  colors: {},
  colorClass: (tag) => tagBadgeClass(null, tag),
  setTagColor: () => {},
});

export function TagColorsProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [colors, setColors] = useState<ColorMap>({});

  // Load the user's saved tag colours once a session exists.
  useEffect(() => {
    if (!accessToken) {
      setColors({});
      return;
    }
    let cancelled = false;
    fetch("/api/tags/colors", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : { colors: {} }))
      .then((d) => {
        if (!cancelled) setColors(d.colors || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const persist = useCallback(
    (map: ColorMap) => {
      if (!accessToken) return;
      fetch("/api/tags/colors", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ colors: map }),
      }).catch(() => {});
    },
    [accessToken]
  );

  const setTagColor = useCallback(
    (tag: string, key: string | null) => {
      setColors((prev) => {
        const next = { ...prev };
        if (key) next[tag] = key;
        else delete next[tag];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const colorClass = useCallback((tag: string) => tagBadgeClass(colors[tag], tag), [colors]);

  return (
    <TagColorsContext.Provider value={{ colors, colorClass, setTagColor }}>
      {children}
    </TagColorsContext.Provider>
  );
}

export function useTagColors() {
  return useContext(TagColorsContext);
}
