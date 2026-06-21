import React, { useEffect, useState, createContext, useCallback } from "react";
import { userApi } from "../interceptors/user.api.js";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  removeFromLocalStorage,
  saveToLocalStorage,
} from "../utils/storage.utils";

export const UserContext = createContext();

export const UserContextProvider = ({ children }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authActionLoading, setAuthActionLoading] = useState(false);

  const getUser = useCallback(async () => {
    try {
      const response = await userApi.get("/");
      if (response?.data) {
        setUser(response.data);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (userData) => {
    setAuthActionLoading(true);
    try {
      const response = await userApi.post("/login", userData);

      if (response.status === 200) {
        saveToLocalStorage("sessionId", response.data.sessionId);
        await getUser();
        toast.success(response.data.message || "Login Successful");
        navigate("/");
      }
      return response;
    } catch (error) {
      toast.error(error);
      throw error;
    } finally {
      setAuthActionLoading(false);
    }
  };

  const register = async (userData) => {
    setAuthActionLoading(true);
    try {
      const response = await userApi.post("/register", userData);
      if (response.status === 201) {
        saveToLocalStorage("sessionId", response.data.sessionId);
        await getUser();
        toast.success(response.data.message || "Registration Successful");
        navigate("/");
      }
      return response;
    } catch (error) {
      toast.error(error);
      throw error;
    } finally {
      setAuthActionLoading(false);
    }
  };

  const logout = async () => {
    try {
      await userApi.post("/logout");
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      removeFromLocalStorage("sessionId");
      navigate("/auth");
      toast.info("Logged out successfully");
    }
  };

  useEffect(() => {
    getUser();
  }, [getUser]);

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        authActionLoading,
        register,
        login,
        getUser,
        logout,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
