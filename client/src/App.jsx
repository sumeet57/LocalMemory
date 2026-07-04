import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import LiveTrail from "./pages/LiveTrail";
import TrailDetail from "./pages/TrailDetail";
import { UserContextProvider } from "./context/UserContext";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const App = () => {
  return (
    <>
      <ToastContainer theme="dark" position="top-center" />
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <UserContextProvider>
                <Home />
              </UserContextProvider>
            }
          />
          <Route
            path="/auth"
            element={
              <UserContextProvider>
                <Auth />
              </UserContextProvider>
            }
          />
          <Route
            path="/trail/live"
            element={
              <UserContextProvider>
                <LiveTrail />
              </UserContextProvider>
            }
          />
          <Route
            path="/trail/:id"
            element={
              <UserContextProvider>
                <TrailDetail />
              </UserContextProvider>
            }
          />
        </Routes>
      </BrowserRouter>
    </>
  );
};

export default App;
