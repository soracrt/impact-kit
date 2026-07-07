// @target aftereffects
//
// Dev-only structural smoke test — NOT wired into CSXS/manifest.xml, run
// manually via AE's File > Scripts > Run Script File. Creates a throwaway
// comp + null, applies each of the 4 Impact Kit categories to it, and
// asserts the resulting envelope keyframe shapes numerically.
//
// This does not require the CEP panel or a browser — it calls ik_applyImpact()
// directly, in-process, exactly as the panel's evalScript call would.

#include "main.jsx"

function ik_selectOnly(comp, layerToSelect) {
  for (var i = 1; i <= comp.numLayers; i++) {
    comp.layer(i).selected = (comp.layer(i) === layerToSelect);
  }
}

function ik_smoketest() {
  app.beginUndoGroup("Impact Kit Smoketest");
  var allPass = true;
  var log = [];

  function say(line) {
    log.push(line);
    $.writeln(line);
  }

  try {
    var presetPath = File($.fileName).parent.parent.fsName + "/presets/DS1.ffx";

    var comp = app.project.items.addComp("IK_Smoketest", 1920, 1080, 1, 5, 30);
    var nullLayer = comp.layers.addNull(5);
    nullLayer.name = "SmoketestNull";

    var NULL_START = 0;
    var NULL_END = 2;
    var pos = nullLayer.property("Transform").property("Position");
    pos.setValueAtTime(NULL_START, [960, 540, 0]);
    pos.setValueAtTime(NULL_END, [1200, 700, 0]);

    var sharedParams = {
      amplitude: 100, frequency: 100, tilt: 100, seed: 12345,
      decaySharpness: 70, snapAmount: 70, smoothness: 70,
      centerPct: 50, burstWidthPct: 25
    };

    var categories = ["out", "in", "mid", "buildup"];

    for (var c = 0; c < categories.length; c++) {
      var category = categories[c];
      ik_selectOnly(comp, nullLayer);

      var args = JSON.stringify({
        category: category,
        presetPath: presetPath,
        params: sharedParams
      });

      var resultJson = ik_applyImpact(args);
      var result = JSON.parse(resultJson);
      say(category + ": " + JSON.stringify(result));

      if (result.error) {
        say("  FAIL: apply returned an error");
        allPass = false;
        continue;
      }

      // moveBefore(nullLayer) always places the just-created adjustment
      // layer directly above the null, so it's at nullLayer.index - 1
      // immediately after this call (before any later iteration pushes it
      // further up the stack).
      var adjLayer = comp.layer(nullLayer.index - 1);
      var effect = findEffectByName(adjLayer.Effects);
      var envelopeProps = effect ? findEnvelopeProps(effect) : [];

      if (envelopeProps.length === 0) {
        say("  FAIL: no envelope properties found on " + adjLayer.name);
        allPass = false;
        continue;
      }

      var prop = envelopeProps[0];
      var keyInfo = [];
      for (var k = 1; k <= prop.numKeys; k++) {
        keyInfo.push({ t: prop.keyTime(k), v: prop.keyValue(k) });
      }
      say("  " + prop.name + " numKeys=" + prop.numKeys + " keys=" + JSON.stringify(keyInfo));

      var pass = false;
      if (category === "out") {
        pass = prop.numKeys === 2 && keyInfo[0].v > keyInfo[1].v;
      } else if (category === "in" || category === "buildup") {
        pass = prop.numKeys === 2 && keyInfo[0].v < keyInfo[1].v;
      } else if (category === "mid") {
        pass = prop.numKeys === 3 &&
               keyInfo[1].v > keyInfo[0].v &&
               keyInfo[1].v > keyInfo[2].v &&
               keyInfo[0].t > NULL_START &&
               keyInfo[2].t < NULL_END;
      }

      say("  " + (pass ? "PASS" : "FAIL") + ": " + category);
      if (!pass) allPass = false;
    }

    say(allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED");

  } catch (e) {
    say("ERROR: " + e.toString());
    allPass = false;
  } finally {
    app.endUndoGroup();
  }

  // $.writeln only surfaces in an ExtendScript console, which isn't always
  // open — also write the log to a file and alert() a summary so results
  // are visible no matter how the script was run.
  try {
    var logFile = new File(Folder.temp.fsName + "/impactkit-smoketest.log");
    logFile.encoding = "UTF-8";
    logFile.open("w");
    logFile.write(log.join("\n"));
    logFile.close();
    alert((allPass ? "ALL TESTS PASSED" : "SOME TESTS FAILED") + "\n\nFull log: " + logFile.fsName);
  } catch (eLog) {}

  return allPass;
}

ik_smoketest();
