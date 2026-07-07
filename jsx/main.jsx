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
// moving fastest (frame-to-frame velocity, not distance from the start
// value) — the shake's peak keyframe gets pinned there, since the hit
// lands where the null actually has the most energy, not wherever its
// position/scale/rotation value happens to be largest. A ball thrown from
// the sky doesn't hit hardest at the highest point in its arc — it hits
// hardest at its fastest point.
function findPeakTime(prop, nullStart, nullEnd, frameLen) {
  var peakTime = nullStart, peakMag = -1;

  var t = nullStart;
  while (t <= nullEnd - frameLen) {
    var m = magnitude(prop.valueAtTime(t + frameLen, false), prop.valueAtTime(t, false));
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

// ─── Envelope retiming ───────────────────────────────────────────────────────

// How "loud" a keyframe value is, for picking which of the preset's own
// keyframes is its "hit" — the one to anchor to the null's real peak.
function valueMagnitude(v) {
  if (v instanceof Array) {
    var sum = 0;
    for (var i = 0; i < v.length; i++) sum += v[i] * v[i];
    return Math.sqrt(sum);
  }
  return Math.abs(v);
}

// Retime the envelope property's OWN authored keyframes (values, eases,
// interpolation — the curve the user built or the bundled default) onto the
// null's timeline. Never resynthesizes the curve — only stretches keyframe
// TIMES so the preset's own highest-magnitude keyframe (its "hit") lands
// exactly at peakTime, with everything before/after it scaled to fill
// [nullStart, peakTime] and [peakTime, nullEnd] respectively.
function ik_writeEnvelope(prop, nullStart, nullEnd, frameLen, peakTime) {
  if (!prop || prop.numKeys < 2) return;

  var origKeys = [];
  for (var i = 1; i <= prop.numKeys; i++) {
    var rec = { time: prop.keyTime(i), value: prop.keyValue(i) };
    try {
      rec.inType  = prop.keyInInterpolationType(i);
      rec.outType = prop.keyOutInterpolationType(i);
    } catch (e1) {}
    try {
      rec.inEase  = prop.keyInTemporalEase(i);
      rec.outEase = prop.keyOutTemporalEase(i);
    } catch (e2) {}
    origKeys.push(rec);
  }

  var peakIdx = 0;
  for (var pi = 1; pi < origKeys.length; pi++) {
    if (valueMagnitude(origKeys[pi].value) > valueMagnitude(origKeys[peakIdx].value)) peakIdx = pi;
  }

  var origStart = origKeys[0].time;
  var origEnd   = origKeys[origKeys.length - 1].time;
  var origPeak  = origKeys[peakIdx].time;
  var newPeak   = clampNum(peakTime, nullStart + frameLen, nullEnd - frameLen);

  function remapTime(t) {
    if (origPeak <= origStart) {
      // The preset's own peak IS its first keyframe (a decay-only shape) —
      // stretch the whole thing to start at the null's real peak.
      var span = origEnd - origStart;
      var frac = span > 0 ? (t - origStart) / span : 0;
      return newPeak + frac * (nullEnd - newPeak);
    }
    if (origPeak >= origEnd) {
      // Mirror case: the preset's peak is its last keyframe (a build-only
      // shape) — stretch it to end at the null's real peak.
      var span2 = origEnd - origStart;
      var frac2 = span2 > 0 ? (t - origStart) / span2 : 0;
      return nullStart + frac2 * (newPeak - nullStart);
    }
    if (t <= origPeak) {
      var spanA = origPeak - origStart;
      var fracA = spanA > 0 ? (t - origStart) / spanA : 0;
      return nullStart + fracA * (newPeak - nullStart);
    }
    var spanB = origEnd - origPeak;
    var fracB = spanB > 0 ? (t - origPeak) / spanB : 0;
    return newPeak + fracB * (nullEnd - newPeak);
  }

  for (var k = prop.numKeys; k >= 1; k--) prop.removeKey(k);

  for (var wi = 0; wi < origKeys.length; wi++) {
    prop.setValueAtTime(remapTime(origKeys[wi].time), origKeys[wi].value);
  }
  for (var ki = 1; ki <= origKeys.length; ki++) {
    var src = origKeys[ki - 1];
    try {
      if (src.inType !== undefined && src.outType !== undefined) {
        prop.setInterpolationTypeAtKey(ki, src.inType, src.outType);
      }
    } catch (e3) {}
    try {
      if (src.inEase && src.outEase) {
        prop.setTemporalEaseAtKey(ki, src.inEase, src.outEase);
      }
    } catch (e4) {}
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
          ik_writeEnvelope(envelopeProps[ep], nullStartTime, nullEndTime, frameLen, peakTime);
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
