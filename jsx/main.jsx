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
//
// All paths here are passed in explicitly from the JS side (which already
// knows its own install path via csInterface.getSystemPath(SystemPath.
// EXTENSION)) rather than derived from ExtendScript's $.fileName — that
// turned out to be unreliable when the calling function isn't the
// top-level script itself (evalScript-invoked calls saw $.fileName resolve
// to something that made $.evalFile throw "File or folder does not exist").

function ik_readInstalledVersion(extRoot) {
  try {
    var file = new File(extRoot + "/version.json");
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

function ik_writeInstalledVersion(extRoot, jsonStr) {
  try {
    var file = new File(extRoot + "/version.json");
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jsonStr);
    file.close();
    return ok("Version saved.");
  } catch (e) {
    return err("Error writing version: " + e.toString());
  }
}

// Decode a base64 string into a raw byte-string (each char code 0-255 is one
// decoded byte). ExtendScript has no built-in atob, and passing file content
// with non-ASCII characters (em dashes, box-drawing glyphs, etc.) straight
// through evalScript's string transport is a known fragile spot — the panel
// side base64-encodes before sending, this reverses it.
function ik_base64Decode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = "";
  var i = 0;
  while (i < input.length) {
    var c1 = input.charAt(i++);
    var c2 = input.charAt(i++);
    var c3 = input.charAt(i++);
    var c4 = input.charAt(i++);

    var e1 = chars.indexOf(c1);
    var e2 = chars.indexOf(c2);
    var e3 = (c3 === "=" || c3 === "") ? -1 : chars.indexOf(c3);
    var e4 = (c4 === "=" || c4 === "") ? -1 : chars.indexOf(c4);

    output += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== -1) output += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== -1) output += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return output;
}

// Overwrite a single file inside this extension's own installed folder.
// absolutePath is the full target path. base64Content is the file's UTF-8
// bytes, base64-encoded on the JS side. Used by the in-panel updater to
// pull fresh files down from GitHub without a manual reinstall.
function ik_writeInstalledFile(absolutePath, base64Content) {
  try {
    var bytes = ik_base64Decode(base64Content);
    var target = new File(absolutePath);
    if (!target.parent.exists) target.parent.create();
    target.encoding = "BINARY";
    target.open("w");
    target.write(bytes);
    target.close();
    return ok(absolutePath);
  } catch (e) {
    return err("Failed to write " + absolutePath + ": " + e.toString());
  }
}

// Re-evaluate jsx/main.jsx in the current ExtendScript engine, so a
// freshly-written copy takes effect without closing the panel.
function ik_reloadHost(jsxPath) {
  try {
    $.evalFile(new File(jsxPath));
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

// Find the time within [nullStart, nullEnd] where the null's own motion is
// furthest from where it started — the shake's peak keyframe gets pinned
// there, regardless of category, so the hit lands where the null actually
// hits hardest instead of at an assumed start/middle/end.
function findPeakTime(prop, nullStart, nullEnd, frameLen) {
  var rest = prop.valueAtTime(nullStart, false);
  var peakTime = nullStart, peakMag = -1;

  var t = nullStart;
  while (t <= nullEnd) {
    var m = magnitude(prop.valueAtTime(t, false), rest);
    if (m > peakMag) { peakMag = m; peakTime = t; }
    t += frameLen;
  }
  return peakTime;
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

// A reflected shake at the frame edge reads as a glitch, not a camera hit,
// so Wrap X/Y are always forced off regardless of what the (built-in or
// user-imported) preset shipped with. Amplitude/Frequency/Seed are left
// exactly as the preset defines them — the user dials those in themselves
// by building and importing their own .ffx preset.
function forceWrapOff(effect) {
  function setMenu(propName, index) {
    try {
      var prop = findPropByName(effect, propName);
      if (prop) prop.setValue(index);
    } catch (e) {}
  }
  setMenu("Wrap X", 1);
  setMenu("Wrap Y", 1);
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
// for the given category, spanning [nullStart, nullEnd] with the peak pinned
// at peakTime (wherever the null's own motion actually peaked). refFloor/
// refPeak come from the property's own key(1)/key(2) values (as set by the
// imported/default preset) — compared by magnitude, not position, since a
// custom preset may author its "no shake" and "full shake" keyframes in
// either order.
function ik_writeEnvelope(prop, category, nullStart, nullEnd, frameLen, peakTime) {
  if (!prop || prop.numKeys < 2) return;

  var v1 = prop.keyValue(1);
  var v2 = prop.keyValue(Math.min(2, prop.numKeys));
  var refFloor = Math.min(v1, v2);
  var refPeak  = Math.max(v1, v2);
  var dims     = propDims(prop);

  for (var k = prop.numKeys; k >= 1; k--) prop.removeKey(k);

  if (category === "buildup") {
    // Constant intensity — no ramp, just a held shake level for the
    // duration of the null.
    prop.setValue(refPeak);
    return;
  }

  var centerT = clampNum(peakTime, nullStart + frameLen, nullEnd - frameLen);
  var points;

  if (category === "out") {
    // Sharp attack into the hit (low influence on both sides of the rise),
    // soft decay out of it (high influence on both sides of the fall) — a
    // fast snap to the peak with a gentle tail, not a symmetric S-curve.
    points = [
      { t: nullStart, v: refFloor, outI: 12, inI: 12 },
      { t: centerT,   v: refPeak,  outI: 88, inI: 12 },
      { t: nullEnd,   v: refFloor, outI: 88, inI: 88 }
    ];
  } else if (category === "in") {
    // Soft build into the hit, sharp cutoff out of it — the mirror of "out".
    points = [
      { t: nullStart, v: refFloor, outI: 75, inI: 75 },
      { t: centerT,   v: refPeak,  outI: 9,  inI: 75 },
      { t: nullEnd,   v: refFloor, outI: 9,  inI: 9  }
    ];
  } else if (category === "mid") {
    // Even ease on both sides of the peak.
    points = [
      { t: nullStart, v: refFloor, outI: 30, inI: 30 },
      { t: centerT,   v: refPeak,  outI: 30, inI: 30 },
      { t: nullEnd,   v: refFloor, outI: 30, inI: 30 }
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

// Opens a native file picker for the user's own Sapphire shake preset
// (.ffx). Returns { path: null } if the user cancels.
function ik_pickPresetFile() {
  try {
    var file = File.openDialog("Select a shake preset (.ffx)", "*.ffx");
    return ok(JSON.stringify({ path: file ? file.fsName : null }));
  } catch (e) {
    return err("Error: " + e.toString());
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function ik_applyImpact(argsJson) {
  try {
    var args       = JSON.parse(argsJson);
    var category   = args.category;
    var presetPath = args.presetPath;

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

      var peakTime = findPeakTime(animProp, nullStartTime, nullEndTime, frameLen);

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

      forceWrapOff(effect);

      var envelopeProps = findEnvelopeProps(effect);
      for (var ep = 0; ep < envelopeProps.length; ep++) {
        try {
          ik_writeEnvelope(envelopeProps[ep], category, nullStartTime, nullEndTime, frameLen, peakTime);
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
