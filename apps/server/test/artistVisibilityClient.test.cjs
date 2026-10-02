const assert = require("node:assert/strict");
const { test } = require("node:test");

global.window = { API_ENDPOINT: "http://127.0.0.1" };
require("ts-node").register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: "Node16",
    moduleResolution: "Node16",
    target: "ES2022",
    esModuleInterop: true,
  },
});

test("visibility saves update preferences without rechecking authentication", async (t) => {
  const { api } = require("../../client/src/services/apis/api");
  const { default: store } = require("../../client/src/services/redux");
  const {
    checkLogged,
    saveArtistVisibility,
  } = require("../../client/src/services/redux/modules/user/thunk");
  const user = {
    _id: "person",
    username: "Listener",
    isGuest: false,
    settings: {
      darkMode: "dark",
      timezone: "Europe/Stockholm",
      blacklistedArtists: ["legacy"],
      artistVisibility: [],
    },
  };
  store.dispatch(checkLogged.fulfilled(user, "initial-login"));
  const original = store.getState().user;
  const unavailable = {
    response: { status: 503, data: { message: "Temporarily unavailable" } },
  };
  const me = t.mock.method(api, "me", async () => {
    throw unavailable;
  });
  let entries = [];
  t.mock.method(api, "setArtistVisibility", async (artistId, hidden) => {
    entries = [{ artistId, hidden, name: "Artist", images: [] }];
  });
  t.mock.method(api, "removeArtistVisibility", async () => {
    entries = [];
  });
  const list = t.mock.method(api, "artistVisibility", async () => ({
    data: structuredClone(entries),
  }));

  for (const requestedHidden of [true, false, null]) {
    const saved = await store
      .dispatch(
        saveArtistVisibility({ artistId: "artist", hidden: requestedHidden }),
      )
      .unwrap();
    assert.deepEqual(saved, entries);
    assert.deepEqual(store.getState().user, {
      ...original,
      user: {
        ...original.user,
        settings: {
          ...original.user.settings,
          artistVisibility: entries.map(({ artistId, hidden }) => ({
            artistId,
            hidden,
          })),
        },
      },
    });
  }
  assert.equal(me.mock.callCount(), 0);

  // Even a failed visibility refresh must leave the signed-in user intact.
  const beforeFailure = store.getState().user;
  list.mock.mockImplementation(async () => {
    throw unavailable;
  });
  await assert.rejects(
    store
      .dispatch(saveArtistVisibility({ artistId: "artist", hidden: true }))
      .unwrap(),
    (message) => message === "Temporarily unavailable",
  );
  assert.deepEqual(store.getState().user, beforeFailure);
  assert.equal(me.mock.callCount(), 0);
});
