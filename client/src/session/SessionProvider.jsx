import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { refreshSession } from "../api/client.js";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null });

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((user) => {
        if (active) setState({ status: "ready", user });
      })
      .catch(() => {
        if (active) setState({ status: "error", user: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      setUser(user) {
        setState({ status: "ready", user });
      },
      async retry() {
        setState({ status: "loading", user: null });
        try {
          const user = await refreshSession();
          setState({ status: "ready", user });
        } catch {
          setState({ status: "error", user: null });
        }
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Сессия не подключена");
  return value;
}
