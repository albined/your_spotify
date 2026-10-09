import { GlobalStyles } from "@mui/material";
import { ThemeProvider } from "@mui/system";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";

import Layout from "./components/Layout";
import Message from "./components/Message";
import PlaylistDialog from "./components/PlaylistDialog";
import PrivateRoute from "./components/PrivateRoute";
import Wrapper from "./components/Wrapper";
import Login from "./scenes/Account/Login";
import AlbumStats from "./scenes/AlbumStats";
import AllStats from "./scenes/AllStats";
import ArtistStats from "./scenes/ArtistStats";
import Benchmarks from "./scenes/Benchmarks";
import Compete from "./scenes/Collaborative/Compete/Compete";
import ApiEndpointSetToFronted from "./scenes/Error/ApiEndpointSetToFronted";
import RegistrationsDisabled from "./scenes/Error/RegistrationsDisabled";
import Home from "./scenes/Home";
import Logout from "./scenes/Logout";
import More from "./scenes/More";
import Settings from "./scenes/Settings";
import Albums from "./scenes/Tops/Albums";
import Artists from "./scenes/Tops/Artists";
import Songs from "./scenes/Tops/Songs";
import TrackStats from "./scenes/TrackStats";
import { useDetectPointerType } from "./services/pointer";
import { ShortcutsContextProvider } from "./services/shortcuts";
import { useTheme } from "./services/theme";
import { themeVariables } from "./services/themePalette";

import "./App.css";

function App() {
  const theme = useTheme();

  useDetectPointerType();

  useEffect(() => {
    document.body.setAttribute("class", `${theme.palette.mode}-vars`);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme.palette.background.default);
  }, [theme.palette.mode, theme.palette.background.default]);

  return (
    <ShortcutsContextProvider>
      <ThemeProvider theme={theme}>
        <GlobalStyles
          styles={{ ":root": themeVariables(theme.palette.mode === "dark") }}
        />
        <div className="app">
          <BrowserRouter>
            <Wrapper />
            <Message />
            <PlaylistDialog />
            <Layout>
              <Routes>
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <Home />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/sessions"
                  element={<Navigate to="/all" replace />}
                />
                <Route
                  path="/all"
                  element={
                    <PrivateRoute>
                      <AllStats />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/more"
                  element={
                    <PrivateRoute>
                      <More />
                    </PrivateRoute>
                  }
                />
                <Route path="logout" element={<Logout />} />
                <Route path="login" element={<Login />} />
                <Route
                  path="/registrations-disabled"
                  element={<RegistrationsDisabled />}
                />
                <Route
                  path="/oauth/spotify" // Error page when someone accidentally configures their API_ENDPOINT to point to the frontend instead of the backend
                  element={<ApiEndpointSetToFronted />}
                />
                <Route
                  path="/top/songs"
                  element={
                    <PrivateRoute>
                      <Songs />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/top/albums"
                  element={
                    <PrivateRoute>
                      <Albums />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/top/artists"
                  element={
                    <PrivateRoute>
                      <Artists />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/collaborative/compete"
                  element={
                    <PrivateRoute>
                      <Compete />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/artist/:id"
                  element={
                    <PrivateRoute>
                      <ArtistStats />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/album/:id"
                  element={
                    <PrivateRoute>
                      <AlbumStats />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/song/:id"
                  element={
                    <PrivateRoute>
                      <TrackStats />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/settings/*"
                  element={
                    <PrivateRoute>
                      <Settings />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/benchmarks"
                  element={
                    <PrivateRoute>
                      <Benchmarks />
                    </PrivateRoute>
                  }
                />
              </Routes>
            </Layout>
          </BrowserRouter>
        </div>
      </ThemeProvider>
    </ShortcutsContextProvider>
  );
}

export default App;
