// Pure data-access layer for Impact Kit's per-category custom shake presets.
// No DOM manipulation here — see js/main.js for wiring this up to the UI.

var CATEGORIES = [
  { key: "out",     label: "Out" },
  { key: "in",      label: "In" },
  { key: "mid",     label: "Mid" },
  { key: "buildup", label: "Build-Up" }
];

function defaultStore() {
  return {
    version: 2,
    activeCategory: "out",
    customPresetPaths: { out: null, in: null, mid: null, buildup: null }
  };
}

function loadStore(csInterface, cb) {
  csInterface.evalScript("ik_readPresets()", function (result) {
    var envelope;
    try {
      envelope = JSON.parse(result);
    } catch (e) {
      console.error("ImpactKitPresets: could not parse ik_readPresets() envelope", e);
      var fallback = defaultStore();
      saveStore(csInterface, fallback, function () { cb(fallback); });
      return;
    }

    if (envelope.error) {
      console.error("ImpactKitPresets: ik_readPresets() error", envelope.error);
      var fallbackErr = defaultStore();
      saveStore(csInterface, fallbackErr, function () { cb(fallbackErr); });
      return;
    }

    var contents = envelope.message;
    if (!contents) {
      var fresh = defaultStore();
      saveStore(csInterface, fresh, function () { cb(fresh); });
      return;
    }

    var store;
    try {
      store = JSON.parse(contents);
    } catch (e2) {
      console.error("ImpactKitPresets: could not parse presets.json contents", e2);
      var fallback2 = defaultStore();
      saveStore(csInterface, fallback2, function () { cb(fallback2); });
      return;
    }

    // Older store shape (sliders/named presets) — start fresh rather than
    // trying to migrate data tied to a UI that no longer exists.
    if (!store || store.version !== 2 || !store.customPresetPaths) {
      var upgraded = defaultStore();
      saveStore(csInterface, upgraded, function () { cb(upgraded); });
      return;
    }

    cb(store);
  });
}

function saveStore(csInterface, store, cb) {
  csInterface.evalScript(
    "ik_writePresets(" + JSON.stringify(JSON.stringify(store)) + ")",
    cb
  );
}

window.ImpactKitPresets = {
  CATEGORIES: CATEGORIES,
  defaultStore: defaultStore,
  loadStore: loadStore,
  saveStore: saveStore
};
