import { createAction, createReducer } from "@reduxjs/toolkit";

import { api } from "../../../apis/api";
import { defaultInterval } from "../../../intervals";
import {
  changeUsername,
  checkLogged,
  deletePublicToken,
  generateNewPublicToken,
  saveArtistVisibility,
  setDarkMode,
} from "./thunk";
import { ReduxIntervalDetail, User } from "./types";
import { intervalDetailToRedux } from "./utils";

interface UserReducer {
  loaded: boolean;
  user: User | null;
  intervalDetail: ReduxIntervalDetail;
  publicToken: string | null;
}

const initialState: UserReducer = {
  loaded: false,
  user: null,
  intervalDetail: intervalDetailToRedux(defaultInterval),
  publicToken: null,
};

export const logout = createAction("@user/logout");
export const setDataInterval =
  createAction<ReduxIntervalDetail>("@user/set-interval");
export const setPublicToken = createAction<string | null>(
  "@user/set-public-token",
);
export default createReducer(initialState, (builder) => {
  builder.addCase(logout, (state) => {
    state.user = null;
    state.publicToken = null;
    api.publicToken = null;
  });

  builder.addCase(setPublicToken, (state, { payload }) => {
    state.publicToken = payload;
    api.publicToken = payload;
  });

  builder.addCase(checkLogged.fulfilled, (state, { payload }) => {
    state.user = payload;
    state.loaded = true;
    if (state.user) {
      state.user.isGuest = !!api.publicToken;
    }
  });

  builder.addCase(saveArtistVisibility.fulfilled, (state, { payload }) => {
    if (state.user) {
      state.user.settings.artistVisibility = payload.map(
        ({ artistId, hidden }) => ({ artistId, hidden }),
      );
    }
  });

  builder.addCase(changeUsername.fulfilled, (state, { meta: { arg } }) => {
    if (state.user) {
      state.user.username = arg;
    }
  });

  builder.addCase(generateNewPublicToken.fulfilled, (state, { payload }) => {
    if (!state.user) {
      return;
    }
    state.user.publicToken = payload;
  });

  builder.addCase(deletePublicToken.fulfilled, (state) => {
    if (!state.user) {
      return;
    }
    state.user.publicToken = null;
  });

  builder.addCase(setDataInterval, (state, { payload }) => {
    state.intervalDetail = payload;
  });

  builder.addCase(setDarkMode.pending, (state, { meta: { arg } }) => {
    if (!state.user) {
      return;
    }
    state.user.settings.darkMode = arg;
  });
});
