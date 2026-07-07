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

// evalScript's callback fires with whatever string the JSX side returned —
// including error envelopes — so a plain resolve() would treat host-side
// failures as success. This rejects on {error: ...} so Promise chains
// actually stop and surface the real reason instead of sailing through.
function evalScriptChecked(script) {
  return evalScriptAsync(script).then(function (result) {
    var envelope = parseEnvelope(result);
    if (envelope.error) throw new Error(envelope.error);
    return envelope;
  });
}

// btoa() only handles Latin1 — this round-trips through encodeURIComponent
// so UTF-8 file content (em dashes, box-drawing glyphs, etc. in our own
// source comments) survives evalScript's string transport intact.
function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function checkForUpdate() {
  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  fetch("https://api.github.com/repos/" + UPDATE_REPO + "/commits/main")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !data.sha) return;
      latestCommitSha = data.sha;
      return evalScriptChecked("ik_readInstalledVersion(" + JSON.stringify(extPath) + ")").then(function (envelope) {
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

  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  var sha = latestCommitSha;
  var fetches = UPDATE_FILES.map(function (relPath) {
    var url = "https://raw.githubusercontent.com/" + UPDATE_REPO + "/" + sha + "/" + relPath;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Failed to fetch " + relPath + " (" + res.status + ")");
      return res.text();
    }).then(function (content) {
      return evalScriptChecked(
        "ik_writeInstalledFile(" + JSON.stringify(extPath + "/" + relPath) + "," + JSON.stringify(utf8ToBase64(content)) + ")"
      );
    }).catch(function (e) {
      throw new Error(relPath + ": " + e.message);
    });
  });

  var hostReloaded = false;

  Promise.all(fetches)
    .then(function () {
      // Best-effort: re-evaluating jsx/main.jsx from within a call that
      // originated from that same script reliably throws "IOError: File or
      // folder does not exist" in this AE/CEP build — a real ExtendScript
      // limitation, not a path bug (the file writes above always succeed).
      // Don't let its failure block the update; worst case the host script
      // just needs the panel reopened to pick up the change.
      return evalScriptAsync("ik_reloadHost(" + JSON.stringify(extPath + "/jsx/main.jsx") + ")")
        .then(function (result) {
          hostReloaded = !parseEnvelope(result).error;
        });
    })
    .then(function () {
      return evalScriptChecked(
        "ik_writeInstalledVersion(" + JSON.stringify(extPath) + "," + JSON.stringify(JSON.stringify({ commit: sha, installedAt: new Date().toISOString() })) + ")"
      );
    })
    .then(function () {
      if (hostReloaded) {
        text.textContent = "Updated — reloading…";
        setTimeout(function () { window.location.reload(); }, 600);
        return;
      }
      // Host script couldn't hot-reload itself, so the ExtendScript engine
      // is still running old code. Reopening the panel (closing this
      // instance while requesting a new one) gets AE to spin up a fresh
      // engine session that picks up the new jsx/main.jsx.
      text.textContent = "Updated — reopening panel…";
      setTimeout(function () {
        csInterface.requestOpenExtension(csInterface.getExtensionID(), "");
        csInterface.closeExtension();
      }, 800);
    })
    .catch(function (e) {
      btn.disabled = false;
      text.textContent = "Update failed: " + e.message;
    });
}

var GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="3"></circle>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
  '</svg>';

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

function renderCogState() {
  var cogs = document.querySelectorAll(".category-cog");
  for (var i = 0; i < cogs.length; i++) {
    var category = cogs[i].dataset.category;
    cogs[i].classList.toggle("has-custom", !!store.customPresetPaths[category]);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  var cogs = document.querySelectorAll(".category-cog");
  for (var gi = 0; gi < cogs.length; gi++) cogs[gi].innerHTML = GEAR_SVG;

  ImpactKitPresets.loadStore(csInterface, function (loadedStore) {
    store = loadedStore;
    renderCategoryGrid();
    renderCogState();
  });
  checkForUpdate();
});

document.getElementById("btnUpdate").addEventListener("click", installUpdate);

var categoryButtons = document.querySelectorAll(".category-btn");
for (var ci = 0; ci < categoryButtons.length; ci++) {
  categoryButtons[ci].addEventListener("click", function () {
    store.activeCategory = this.dataset.category;
    renderCategoryGrid();
    setStatus("");
  });
}

var cogButtons = document.querySelectorAll(".category-cog");
for (var gi2 = 0; gi2 < cogButtons.length; gi2++) {
  cogButtons[gi2].addEventListener("click", function () {
    var category = this.dataset.category;
    setStatus("Waiting for file selection…");

    csInterface.evalScript("ik_pickPresetFile()", function (result) {
      var envelope;
      try {
        envelope = JSON.parse(result);
      } catch (e) {
        envelope = { error: "Unexpected response: " + result };
      }
      if (envelope.error) {
        setStatus(envelope.error, true);
        return;
      }
      var picked;
      try { picked = JSON.parse(envelope.message).path; } catch (e2) { picked = null; }
      if (!picked) {
        setStatus("");
        return;
      }

      store.customPresetPaths[category] = picked;
      ImpactKitPresets.saveStore(csInterface, store, function () {
        renderCogState();
        setStatus("Custom shake set for " + category + ".");
      });
    });
  });
}

document.getElementById("btnApply").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;
  setStatus("Applying…");

  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  var category = store.activeCategory;
  var presetPath = store.customPresetPaths[category] || (extPath + "/presets/DS1.ffx");
  var args = JSON.stringify({
    category: category,
    presetPath: presetPath
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
