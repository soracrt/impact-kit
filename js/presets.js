// Pure data-access layer for Impact Kit presets. No DOM manipulation here —
// see js/main.js for wiring this up to the UI.

var CATEGORIES = [
  { key: "out",     label: "Out" },
  { key: "in",      label: "In" },
  { key: "mid",     label: "Mid" },
  { key: "buildup", label: "Build-Up" }
];

var SHARED_PARAM_DEFS = [
  { key: "amplitude", label: "Amplitude", min: 0, max: 200,   step: 1, default: 100 },
  { key: "frequency", label: "Frequency", min: 0, max: 200,   step: 1, default: 100 },
  { key: "seed",      label: "Seed",      min: 0, max: 99999, step: 1, default: 12345 }
];

var CATEGORY_PARAM_DEFS = {
  out:     [{ key: "decaySharpness", label: "Decay Sharpness", min: 0, max: 100, step: 1, default: 70 }],
  in:      [{ key: "snapAmount",     label: "Snap Amount",     min: 0, max: 100, step: 1, default: 70 }],
  mid:     [
    { key: "centerPct",     label: "Burst Center", min: 0, max: 100, step: 1, default: 50 },
    { key: "burstWidthPct", label: "Burst Width",  min: 5, max: 100, step: 1, default: 25 }
  ],
  buildup: []
};

function paramDefsFor(category) {
  return SHARED_PARAM_DEFS.concat(CATEGORY_PARAM_DEFS[category] || []);
}

function randomSeed() {
  return Math.floor(Math.random() * 100000);
}

function defaultStore() {
  return {
    version: 1,
    activeCategory: "out",
    activePresetByCategory: { out: "Hard Hit", in: "Snap In", mid: "Quick Burst", buildup: "Slow Build" },
    presets: {
      out: [
        { name: "Hard Hit",  builtin: true, params: { amplitude: 130, frequency: 110, seed: 12345, decaySharpness: 85 } },
        { name: "Soft Fade", builtin: true, params: { amplitude: 80,  frequency: 90,  seed: 54321, decaySharpness: 40 } }
      ],
      in: [
        { name: "Snap In",   builtin: true, params: { amplitude: 120, frequency: 110, seed: 24680, snapAmount: 90 } },
        { name: "Quick Tap", builtin: true, params: { amplitude: 90,  frequency: 100, seed: 11223, snapAmount: 70 } }
      ],
      mid: [
        { name: "Quick Burst",  builtin: true, params: { amplitude: 140, frequency: 120, seed: 99999, centerPct: 50, burstWidthPct: 30 } },
        { name: "Punchy Pulse", builtin: true, params: { amplitude: 100, frequency: 100, seed: 33445, centerPct: 45, burstWidthPct: 20 } }
      ],
      buildup: [
        { name: "Slow Build",   builtin: true, params: { amplitude: 110, frequency: 90, seed: 77889 } },
        { name: "Gradual Rise", builtin: true, params: { amplitude: 90,  frequency: 80, seed: 66554 } }
      ]
    }
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
  SHARED_PARAM_DEFS: SHARED_PARAM_DEFS,
  CATEGORY_PARAM_DEFS: CATEGORY_PARAM_DEFS,
  paramDefsFor: paramDefsFor,
  randomSeed: randomSeed,
  defaultStore: defaultStore,
  loadStore: loadStore,
  saveStore: saveStore
};
