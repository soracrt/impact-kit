var csInterface = new CSInterface();
var store = null;

// ─── Self-update ────────────────────────────────────────────────────────────

var UPDATE_REPO = "soracrt/impact-kit";
var UPDATE_FILES = [
  "index.html", "css/style.css",
  "js/CSInterface.js", "js/main.js", "js/presets.js",
  "jsx/main.jsx", "jsx/smoketest.jsx",
  "CSXS/manifest.xml"
];
var latestCommitSha = null;

function evalScriptAsync(script) {
  return new Promise(function (resolve) {
    csInterface.evalScript(script, resolve);
  });
}

function parseEnvelope(result) {
  try {
    return JSON.parse(result);
  } catch (e) {
    return { error: "Unexpected response: " + result };
  }
}

function checkForUpdate() {
  fetch("https://api.github.com/repos/" + UPDATE_REPO + "/commits/main")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !data.sha) return;
      latestCommitSha = data.sha;
      return evalScriptAsync("ik_readInstalledVersion()").then(function (result) {
        var envelope = parseEnvelope(result);
        var installed = null;
        try { installed = JSON.parse(envelope.message || "{}"); } catch (e) { installed = {}; }
        if (installed.commit !== latestCommitSha) {
          document.getElementById("updateBanner").classList.remove("hidden");
        }
      });
    })
    .catch(function () {
      // No network / GitHub unreachable — fail silently, don't nag.
    });
}

function installUpdate() {
  var btn = document.getElementById("btnUpdate");
  var text = document.getElementById("updateBannerText");
  btn.disabled = true;
  text.textContent = "Updating…";

  var sha = latestCommitSha;
  var fetches = UPDATE_FILES.map(function (relPath) {
    var url = "https://raw.githubusercontent.com/" + UPDATE_REPO + "/" + sha + "/" + relPath;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Failed to fetch " + relPath);
      return res.text();
    }).then(function (content) {
      return evalScriptAsync(
        "ik_writeInstalledFile(" + JSON.stringify(relPath) + "," + JSON.stringify(content) + ")"
      );
    });
  });

  Promise.all(fetches)
    .then(function () {
      return evalScriptAsync("ik_reloadHost()");
    })
    .then(function () {
      return evalScriptAsync(
        "ik_writeInstalledVersion(" + JSON.stringify(JSON.stringify({ commit: sha, installedAt: new Date().toISOString() })) + ")"
      );
    })
    .then(function () {
      text.textContent = "Updated — reloading…";
      setTimeout(function () { window.location.reload(); }, 600);
    })
    .catch(function (e) {
      btn.disabled = false;
      text.textContent = "Update failed: " + e.message;
    });
}

var DICE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="3" width="18" height="18" rx="3"></rect>' +
  '<circle cx="8" cy="8" r="1.2" fill="currentColor"></circle>' +
  '<circle cx="16" cy="8" r="1.2" fill="currentColor"></circle>' +
  '<circle cx="12" cy="12" r="1.2" fill="currentColor"></circle>' +
  '<circle cx="8" cy="16" r="1.2" fill="currentColor"></circle>' +
  '<circle cx="16" cy="16" r="1.2" fill="currentColor"></circle>' +
  '</svg>';

function getActivePreset(category) {
  category = category || store.activeCategory;
  var name = store.activePresetByCategory[category];
  var list = store.presets[category];
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i];
  }
  return list[0];
}

function setStatus(text, isError) {
  var el = document.getElementById("statusLine");
  el.textContent = text || "";
  el.classList.toggle("status-error", !!isError);
}

function renderCategoryGrid() {
  var buttons = document.querySelectorAll(".category-btn");
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    btn.classList.toggle("active", btn.dataset.category === store.activeCategory);
  }
}

function refreshPresetSelect() {
  var select = document.getElementById("presetSelect");
  select.innerHTML = "";

  var list = store.presets[store.activeCategory];
  var activeName = store.activePresetByCategory[store.activeCategory];

  var builtinGroup = document.createElement("optgroup");
  builtinGroup.label = "Built-in";
  var customGroup = document.createElement("optgroup");
  customGroup.label = "Custom";

  for (var i = 0; i < list.length; i++) {
    var preset = list[i];
    var option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    if (preset.name === activeName) option.selected = true;
    (preset.builtin ? builtinGroup : customGroup).appendChild(option);
  }

  select.appendChild(builtinGroup);
  if (customGroup.children.length > 0) select.appendChild(customGroup);

  updateDeleteButtonState();
}

function updateDeleteButtonState() {
  var btn = document.getElementById("btnDeletePreset");
  var active = getActivePreset();
  btn.disabled = !!(active && active.builtin);
}

function renderParamRows() {
  var container = document.getElementById("paramRows");
  container.innerHTML = "";

  var defs = ImpactKitPresets.paramDefsFor(store.activeCategory);
  var preset = getActivePreset();

  defs.forEach(function (def) {
    var row = document.createElement("div");
    row.className = "row" + (def.key === "seed" ? " row-seed" : "");

    var label = document.createElement("label");
    label.setAttribute("for", "range-" + def.key);
    label.textContent = def.label;

    var range = document.createElement("input");
    range.type = "range";
    range.id = "range-" + def.key;
    range.min = def.min;
    range.max = def.max;
    range.step = def.step;
    var value = (preset.params[def.key] !== undefined) ? preset.params[def.key] : def.default;
    range.value = value;

    var readout = document.createElement("span");
    readout.className = "value";
    readout.id = "val-" + def.key;
    readout.textContent = value;

    range.addEventListener("input", function (key, out) {
      return function () {
        out.textContent = this.value;
        getActivePreset().params[key] = Number(this.value);
      };
    }(def.key, readout));

    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(readout);

    if (def.key === "seed") {
      var dice = document.createElement("button");
      dice.type = "button";
      dice.className = "icon-btn";
      dice.title = "Randomize seed";
      dice.innerHTML = DICE_SVG;
      dice.addEventListener("click", function () {
        var seed = ImpactKitPresets.randomSeed();
        range.value = seed;
        readout.textContent = seed;
        getActivePreset().params.seed = seed;
      });
      row.appendChild(dice);
    }

    container.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  ImpactKitPresets.loadStore(csInterface, function (loadedStore) {
    store = loadedStore;
    renderCategoryGrid();
    refreshPresetSelect();
    renderParamRows();
  });
  checkForUpdate();
});

document.getElementById("btnUpdate").addEventListener("click", installUpdate);

var categoryButtons = document.querySelectorAll(".category-btn");
for (var ci = 0; ci < categoryButtons.length; ci++) {
  categoryButtons[ci].addEventListener("click", function () {
    store.activeCategory = this.dataset.category;
    renderCategoryGrid();
    refreshPresetSelect();
    renderParamRows();
    setStatus("");
  });
}

document.getElementById("presetSelect").addEventListener("change", function () {
  store.activePresetByCategory[store.activeCategory] = this.value;
  ImpactKitPresets.saveStore(csInterface, store, function () {
    updateDeleteButtonState();
    renderParamRows();
  });
});

document.getElementById("btnSavePreset").addEventListener("click", function () {
  var nameInput = document.getElementById("presetName");
  var name = nameInput.value.trim();
  if (!name) name = "Custom";

  var category = store.activeCategory;
  var list = store.presets[category];

  var params = {};
  ImpactKitPresets.paramDefsFor(category).forEach(function (def) {
    var range = document.getElementById("range-" + def.key);
    params[def.key] = range ? Number(range.value) : def.default;
  });

  var existing = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) { existing = list[i]; break; }
  }

  if (existing && existing.builtin) {
    setStatus("Can't overwrite a built-in preset — pick a different name.", true);
    return;
  }

  if (existing) {
    existing.params = params;
  } else {
    list.push({ name: name, builtin: false, params: params });
  }

  store.activePresetByCategory[category] = name;
  ImpactKitPresets.saveStore(csInterface, store, function () {
    refreshPresetSelect();
    nameInput.value = "";
    setStatus("Preset saved.");
  });
});

document.getElementById("btnDeletePreset").addEventListener("click", function () {
  var category = store.activeCategory;
  var active = getActivePreset();
  if (!active || active.builtin) return;

  var list = store.presets[category];
  var remaining = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].name !== active.name) remaining.push(list[i]);
  }
  store.presets[category] = remaining;
  store.activePresetByCategory[category] = remaining.length ? remaining[0].name : null;

  ImpactKitPresets.saveStore(csInterface, store, function () {
    refreshPresetSelect();
    renderParamRows();
    setStatus("Preset deleted.");
  });
});

document.getElementById("btnApply").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;
  setStatus("Applying…");

  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  var preset = getActivePreset();
  var args = JSON.stringify({
    category: store.activeCategory,
    presetPath: extPath + "/presets/DS1.ffx",
    params: preset.params
  });

  csInterface.evalScript("ik_applyImpact(" + JSON.stringify(args) + ")", function (result) {
    btn.disabled = false;
    var envelope;
    try {
      envelope = JSON.parse(result);
    } catch (e) {
      envelope = { error: "Unexpected response: " + result };
    }
    if (envelope.error) setStatus(envelope.error, true);
    else setStatus(envelope.message, false);
  });
});
