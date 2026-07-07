// @target aftereffects

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(msg)  { return JSON.stringify({ message: msg }); }
function err(msg) { return JSON.stringify({ error: msg }); }

// Compute magnitude of a property value relative to a rest value.
// Handles multi-dimensional (arrays) and scalar values.
function magnitude(val, rest) {
  if (val instanceof Array) {
    var sum = 0;
    for (var i = 0; i < val.length; i++) {
      var d = val[i] - rest[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }
  return Math.abs(val - rest);
}

function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Preset storage (outside the extension bundle — install.ps1 wipes it) ───

function ik_readPresets() {
  try {
    var folder = new Folder(Folder.userData.fsName + "/ImpactKit");
    var file = new File(folder.fsName + "/presets.json");
    if (!file.exists) return ok("");
    file.encoding = "UTF-8";
    file.open("r");
    var contents = file.read();
    file.close();
    return ok(contents);
  } catch (e) {
    return err("Error reading presets: " + e.toString());
  }
}

function ik_writePresets(jsonStr) {
  try {
    var folder = new Folder(Folder.userData.fsName + "/ImpactKit");
    if (!folder.exists) folder.create();
    var file = new File(folder.fsName + "/presets.json");
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jsonStr);
    file.close();
    return ok("Presets saved.");
  } catch (e) {
    return err("Error writing presets: " + e.toString());
  }
}

// ─── Self-update (writes into this extension's own installed folder) ───────

// This script's own directory is jsx/, so its parent is the extension root —
// works out to the installed copy under %APPDATA%\Adobe\CEP\extensions\...
// regardless of where AE actually launched it from.
function ik_extensionRoot() {
  return File($.fileName).parent.parent.fsName;
}

function ik_readInstalledVersion() {
  try {
    var file = new File(ik_extensionRoot() + "/version.json");
    if (!file.exists) return ok("");
    file.encoding = "UTF-8";
    file.open("r");
    var contents = file.read();
    file.close();
    return ok(contents);
  } catch (e) {
    return err("Error reading version: " + e.toString());
  }
}

function ik_writeInstalledVersion(jsonStr) {
  try {
    var file = new File(ik_extensionRoot() + "/version.json");
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jsonStr);
    file.close();
    return ok("Version saved.");
  } catch (e) {
    return err("Error writing version: " + e.toString());
  }
}

// Overwrite a single file inside this extension's own installed folder.
// relPath uses forward slashes, e.g. "js/main.js". Used by the in-panel
// updater to pull fresh files down from GitHub without a manual reinstall.
function ik_writeInstalledFile(relPath, content) {
  try {
    var target = new File(ik_extensionRoot() + "/" + relPath);
    if (!target.parent.exists) target.parent.create();
    target.encoding = "UTF-8";
    target.open("w");
    target.write(content);
    target.close();
    return ok(relPath);
  } catch (e) {
    return err("Failed to write " + relPath + ": " + e.toString());
  }
}

// Re-evaluate this script file in the current ExtendScript engine, so a
// freshly-written jsx/main.jsx takes effect without closing the panel.
function ik_reloadHost() {
  try {
    $.evalFile(new File($.fileName));
    return ok("Host reloaded.");
  } catch (e) {
    return err("Reload failed: " + e.toString());
  }
}

// ─── Null-layer motion range detection ──────────────────────────────────────

// Find which property on the null layer has keyframes and best represents
// the motion. propMode: "auto"|"position"|"scale"|"rotation"
function findAnimatedProp(layer, propMode) {
  var props = [];

  if (propMode === "auto" || propMode === "position") {
    var p = layer.property("Transform").property("Position");
    if (p && p.numKeys >= 2) props.push(p);
  }
  if (propMode === "auto" || propMode === "scale") {
    var s = layer.property("Transform").property("Scale");
    if (s && s.numKeys >= 2) props.push(s);
  }
  if (propMode === "auto" || propMode === "rotation") {
    var r = layer.property("Transform").property("Rotation");
    if (r && r.numKeys >= 2) props.push(r);
  }

  if (props.length === 0) return null;

  // Pick the one with the highest peak velocity
  var best = null, bestMag = -1;
  for (var i = 0; i < props.length; i++) {
    var p = props[i];
    var comp = layer.containingComp;
    var fps  = comp.frameRate;
    var frameLen = 1 / fps;
    var startTime = p.keyTime(1);
    var endTime   = p.keyTime(p.numKeys);
    var t = startTime;
    while (t <= endTime - frameLen) {
      var m = magnitude(p.valueAtTime(t + frameLen, false), p.valueAtTime(t, false));
      if (m > bestMag) { bestMag = m; best = p; }
      t += frameLen;
    }
  }
  return best;
}

// ─── Effect / property lookup ───────────────────────────────────────────────

// Find the S_DissolveShake effect on an effects group by name/matchName
// (falls back to the first effect if Sapphire's naming differs).
function findEffectByName(effectsGroup) {
  var numFx = effectsGroup.numProperties;
  if (numFx === 0) return null;

  var fallback = null;
  for (var i = 1; i <= numFx; i++) {
    var effect = effectsGroup.property(i);
    if (!effect) continue;
    if (!fallback) fallback = effect;

    var nm = (effect.name || "").toLowerCase();
    var mn = (effect.matchName || "").toLowerCase();
    if (nm.indexOf("dissolveshake") !== -1 || mn.indexOf("dissolveshake") !== -1) {
      return effect;
    }
  }
  return fallback;
}

// Recursively search an effect/group's properties for one whose display
// name exactly matches. Returns null if not found or on any traversal error.
function findPropByName(group, name) {
  try {
    if (!group || !group.numProperties) return null;
    for (var i = 1; i <= group.numProperties; i++) {
      var prop = group.property(i);
      if (!prop) continue;
      if (prop.name === name) return prop;

      var isGroup = false;
      try {
        isGroup = (prop.propertyType === PropertyType.INDEXED_GROUP ||
                   prop.propertyType === PropertyType.NAMED_GROUP);
      } catch (eg) {
        isGroup = false;
      }
      if (isGroup) {
        var found = findPropByName(prop, name);
        if (found) return found;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Find the shake-intensity envelope property ("Amplitude") that the
// per-category curve should be written onto. Falls back to a generic scan
// for any keyframed property not on the blocklist, in case the real effect
// exposes it under a different name.
function findEnvelopeProps(effect) {
  var p = findPropByName(effect, "Amplitude");
  if (p && p.numKeys >= 2) return [p];

  var blocklist = {
    "Dissolve Percent": true, "Dissolve Speed": true, "Frequency": true,
    "Mo Blur Length": true, "Seed": true
  };
  function scan(group, out) {
    if (!group || !group.numProperties) return;
    for (var i = 1; i <= group.numProperties; i++) {
      var prop = group.property(i);
      if (!prop) continue;
      var isGroup = false;
      try {
        isGroup = (prop.propertyType === PropertyType.INDEXED_GROUP ||
                   prop.propertyType === PropertyType.NAMED_GROUP);
      } catch (eg) { isGroup = false; }
      if (isGroup) { scan(prop, out); continue; }
      try {
        if (prop.numKeys >= 2 && !blocklist[prop.name]) out.push(prop);
      } catch (e) {}
    }
  }
  var fallbackFound = [];
  scan(effect, fallbackFound);
  return fallbackFound;
}

// Apply the shared shake params to the Sapphire effect's native properties.
// amplitude/frequency are percentages (100 = baked default), seed is an
// absolute integer. Wrap X/Y are always forced off — a reflected shake at
// the frame edge reads as a glitch, not a camera hit. Returns
// {applied, skipped} counts.
function applyParams(effect, params) {
  var applied = 0, skipped = 0;

  function setScaled(propName, k) {
    try {
      var prop = findPropByName(effect, propName);
      if (!prop) { skipped++; return; }
      if (prop.numKeys === 0) {
        prop.setValue(prop.value * k);
      } else {
        for (var i = 1; i <= prop.numKeys; i++) {
          prop.setValueAtTime(prop.keyTime(i), prop.keyValue(i) * k);
        }
      }
      applied++;
    } catch (e) {
      skipped++;
    }
  }

  function setMenu(propName, index) {
    try {
      var prop = findPropByName(effect, propName);
      if (!prop) { skipped++; return; }
      prop.setValue(index);
      applied++;
    } catch (e) {
      skipped++;
    }
  }

  if (params.amplitude !== undefined && params.amplitude !== null) {
    setScaled("Amplitude", params.amplitude / 100);
  }

  if (params.frequency !== undefined && params.frequency !== null) {
    setScaled("Frequency", params.frequency / 100);
  }

  if (params.seed !== undefined && params.seed !== null) {
    try {
      var seedProp = findPropByName(effect, "Seed");
      if (seedProp) {
        seedProp.setValue(Math.round(params.seed));
        applied++;
      } else {
        skipped++;
      }
    } catch (e) {
      skipped++;
    }
  }

  setMenu("Wrap X", 1);
  setMenu("Wrap Y", 1);

  return { applied: applied, skipped: skipped };
}

// ─── Category-specific intensity curves ─────────────────────────────────────

function easeArray(influence, dims) {
  var out = [];
  for (var i = 0; i < dims; i++) out.push(new KeyframeEase(0, influence));
  return out;
}

function propDims(prop) {
  var v = prop.value;
  return (v instanceof Array) ? v.length : 1;
}

// Rewrite a single envelope property's keyframes into the intensity curve
// for the given category, spanning [nullStart, nullEnd]. Uses the property's
// own post-applyParams key(1)/key(2) values as the 0%/100% reference points.
function ik_writeEnvelope(prop, category, nullStart, nullEnd, params, frameLen) {
  if (!prop || prop.numKeys < 2) return;

  var peakIdx  = Math.min(2, prop.numKeys);
  var refFloor = prop.keyValue(1);
  var refPeak  = prop.keyValue(peakIdx);
  var dims     = propDims(prop);

  for (var k = prop.numKeys; k >= 1; k--) prop.removeKey(k);

  if (category === "buildup") {
    // Constant intensity — no ramp, just a held shake level for the
    // duration of the null.
    prop.setValue(refPeak);
    return;
  }

  var points;

  if (category === "out") {
    // Ease-out: leaves the peak almost immediately (low outgoing influence),
    // then decelerates gently into the floor (high incoming influence) —
    // a fast drop with a soft tail, not a symmetric S-curve.
    var decay    = (params.decaySharpness !== undefined) ? params.decaySharpness : 70;
    var outInflu = clampNum(30 - decay * 0.25, 2, 30);
    var inInflu  = clampNum(60 + decay * 0.4, 60, 95);
    points = [
      { t: nullStart, v: refPeak,  outI: outInflu, inI: outInflu },
      { t: nullEnd,   v: refFloor, outI: inInflu,  inI: inInflu }
    ];
  } else if (category === "in") {
    // Ease-in: holds near the floor at first (high outgoing influence),
    // then snaps up to the peak right at the end (low incoming influence) —
    // the mirror of "out".
    var snap       = (params.snapAmount !== undefined) ? params.snapAmount : 70;
    var startInflu = clampNum(40 + snap * 0.5, 40, 95);
    var endInflu   = clampNum(30 - snap * 0.3, 2, 30);
    points = [
      { t: nullStart, v: refFloor, outI: startInflu, inI: startInflu },
      { t: nullEnd,   v: refPeak,  outI: endInflu,   inI: endInflu }
    ];
  } else if (category === "mid") {
    var fullDur   = nullEnd - nullStart;
    var centerPct = (params.centerPct !== undefined) ? params.centerPct : 50;
    var widthPct  = (params.burstWidthPct !== undefined) ? params.burstWidthPct : 25;

    var centerT = clampNum(nullStart + fullDur * (centerPct / 100), nullStart + frameLen, nullEnd - frameLen);
    var half    = Math.max(frameLen, fullDur * (widthPct / 100) / 2);
    var burstStart = clampNum(centerT - half, nullStart, centerT - frameLen);
    var burstEnd   = clampNum(centerT + half, centerT + frameLen, nullEnd);

    points = [
      { t: burstStart, v: refFloor, outI: 30, inI: 30 },
      { t: centerT,    v: refPeak,  outI: 30, inI: 30 },
      { t: burstEnd,   v: refFloor, outI: 30, inI: 30 }
    ];
  } else {
    return;
  }

  for (var pi = 0; pi < points.length; pi++) {
    prop.setValueAtTime(points[pi].t, points[pi].v);
  }
  for (var ki = 1; ki <= points.length; ki++) {
    try {
      prop.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      var pt = points[ki - 1];
      prop.setTemporalEaseAtKey(ki, easeArray(pt.inI, dims), easeArray(pt.outI, dims));
    } catch (e) {}
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function ik_applyImpact(argsJson) {
  try {
    var args       = JSON.parse(argsJson);
    var category   = args.category;
    var presetPath = args.presetPath;
    var params     = args.params || {};

    var presetFile = new File(presetPath);
    if (!presetFile.exists) {
      return err("Preset not found: " + presetPath);
    }

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return err("No active composition.");
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length === 0) {
      return err("Select at least one null layer.");
    }

    var nullLayers = [];
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nullLayer) nullLayers.push(selected[i]);
    }
    if (nullLayers.length === 0) {
      return err("No null layers in selection.");
    }

    app.beginUndoGroup("Apply Impact (" + category + ")");

    var count = 0;
    var sapphireMissing = 0;
    var frameLen = 1 / comp.frameRate;

    for (var n = 0; n < nullLayers.length; n++) {
      var nullLayer = nullLayers[n];

      var animProp = findAnimatedProp(nullLayer, "auto");
      if (!animProp) continue;

      var nullStartTime = animProp.keyTime(1);
      var nullEndTime   = animProp.keyTime(animProp.numKeys);
      if (nullStartTime >= nullEndTime) continue;

      // Create adjustment layer above the null layer
      var adjLayer = comp.layers.addSolid(
        [0, 0, 0], "Impact - " + nullLayer.name,
        comp.width, comp.height, comp.pixelAspect,
        comp.duration
      );
      adjLayer.adjustmentLayer = true;
      adjLayer.moveBefore(nullLayer);

      // Apply preset at the null's start time
      comp.time = nullStartTime;
      adjLayer.applyPreset(presetFile);

      // Set in/out AFTER preset (applyPreset can reset layer bounds)
      adjLayer.inPoint  = nullStartTime;
      adjLayer.outPoint = nullEndTime;

      var effect = findEffectByName(adjLayer.Effects);
      if (!effect) { sapphireMissing++; continue; }

      applyParams(effect, params);

      var envelopeProps = findEnvelopeProps(effect);
      for (var ep = 0; ep < envelopeProps.length; ep++) {
        try {
          ik_writeEnvelope(envelopeProps[ep], category, nullStartTime, nullEndTime, params, frameLen);
        } catch (eProp) {}
      }

      count++;
    }

    app.endUndoGroup();

    if (count === 0 && sapphireMissing > 0) {
      return err("Boris FX Sapphire (S_DissolveShake) not found on the applied preset. Install Sapphire and try again.");
    }
    if (count === 0) return err("No valid null layers found (need ≥ 2 keyframes).");

    return ok("Applied " + category + " impact to " + count + " null layer" + (count > 1 ? "s" : "") + ".");

  } catch (e) {
    try { app.endUndoGroup(); } catch (x) {}
    return err("Error: " + e.toString());
  }
}
