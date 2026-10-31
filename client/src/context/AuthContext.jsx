import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("gradesense_user") || "null"));

  useEffect(() => {
    if (!localStorage.getItem("gradesense_token")) return;
    let active = true;
    api.me()
      .then((data) => active && updateUser(data.user))
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function login(credentials) {
    const data = await api.login(credentials);
    localStorage.setItem("gradesense_token", data.token);
    localStorage.setItem("gradesense_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  async function register(payload) {
    const data = await api.register(payload);
    localStorage.setItem("gradesense_token", data.token);
    localStorage.setItem("gradesense_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  function updateUser(nextUser) {
    localStorage.setItem("gradesense_user", JSON.stringify(nextUser));
    setUser(nextUser);
  }

  function logout() {
    localStorage.removeItem("gradesense_token");
    localStorage.removeItem("gradesense_user");
    setUser(null);
  }

  const value = useMemo(() => ({ user, login, register, logout, updateUser }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
