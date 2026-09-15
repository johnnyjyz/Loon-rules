/*
 * Taobao App Overseas Test for Loon 3.5.1(983)+
 *
 * Modes:
 * - Request: normalize thw=us -> thw=cn on selected Taobao API hosts.
 * - AMDC response: clear only trade-acs.m.taobao.com's returned direct IPs,
 *   encouraging the app to use the hostname so Loon can MITM the HTTPS detail request.
 * - Detail response: patch only explicit overseas restriction signals.
 *
 * This is intentionally conservative. It does NOT force generic buyEnable/cartEnable,
 * stock, or ordinary regional inventory flags unless the same object explicitly
 * contains overseaContraBandFlag=true.
 */

(function () {
  "use strict";

  var args = (typeof $argument === "object" && $argument) ? $argument : {};
  var normalizeRegion = args.normalize_region !== false;
  var patchDetail = args.patch_detail !== false;
  var notify = args.notify !== false;
  var debug = args.debug !== false;
  var url = ($request && $request.url) || "";
  var isResponse = typeof $response !== "undefined";

  function log(msg) {
    if (debug) console.log("[Taobao Overseas Test] " + msg);
  }

  function notice(subtitle, body) {
    if (notify && typeof $notification !== "undefined") {
      $notification.post("Taobao Overseas Test", subtitle, body || "");
    }
  }

  function finish(obj) {
    $done(obj || {});
  }

  function replaceThw(value) {
    if (typeof value !== "string") return value;
    return value.replace(/(^|;\s*)thw=us(?=;|$)/ig, "$1thw=cn");
  }

  // ---------- request phase ----------
  if (!isResponse) {
    if (!normalizeRegion) return finish({});
    var headers = Object.assign({}, ($request && $request.headers) || {});
    var changed = false;

    Object.keys(headers).forEach(function (k) {
      if (k.toLowerCase() === "cookie") {
        var before = headers[k];
        var after = replaceThw(before);
        if (after !== before) {
          headers[k] = after;
          changed = true;
        }
      }
    });

    if (changed) {
      log("Changed request cookie thw=us -> thw=cn for " + url);
      return finish({ headers: headers });
    }
    return finish({});
  }

  // ---------- small UTF-8/Base64 helpers for AMDC ----------
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

  function utf8Encode(str) {
    str = String(str).replace(/\r\n/g, "\n");
    var out = "";
    for (var n = 0; n < str.length; n++) {
      var c = str.charCodeAt(n);
      if (c < 128) {
        out += String.fromCharCode(c);
      } else if (c < 2048) {
        out += String.fromCharCode((c >> 6) | 192);
        out += String.fromCharCode((c & 63) | 128);
      } else {
        out += String.fromCharCode((c >> 12) | 224);
        out += String.fromCharCode(((c >> 6) & 63) | 128);
        out += String.fromCharCode((c & 63) | 128);
      }
    }
    return out;
  }

  function utf8Decode(input) {
    var out = "", i = 0, c = 0, c2 = 0, c3 = 0;
    while (i < input.length) {
      c = input.charCodeAt(i);
      if (c < 128) {
        out += String.fromCharCode(c);
        i++;
      } else if (c > 191 && c < 224) {
        c2 = input.charCodeAt(i + 1);
        out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
        i += 2;
      } else {
        c2 = input.charCodeAt(i + 1);
        c3 = input.charCodeAt(i + 2);
        out += String.fromCharCode(
          ((c & 15) << 12) |
          ((c2 & 63) << 6) |
          (c3 & 63)
        );
        i += 3;
      }
    }
    return out;
  }

  function b64Encode(input) {
    input = utf8Encode(input);

    var output = "";
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;

    while (i < input.length) {
      chr1 = input.charCodeAt(i++);
      chr2 = input.charCodeAt(i++);
      chr3 = input.charCodeAt(i++);

      enc1 = chr1 >> 2;
      enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
      enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
      enc4 = chr3 & 63;

      if (isNaN(chr2)) {
        enc3 = enc4 = 64;
      } else if (isNaN(chr3)) {
        enc4 = 64;
      }

      output +=
        B64.charAt(enc1) +
        B64.charAt(enc2) +
        B64.charAt(enc3) +
        B64.charAt(enc4);
    }

    return output;
  }

  function b64Decode(input) {
    var output = "";
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;

    input = String(input).replace(/[^A-Za-z0-9+/=]/g, "");

    while (i < input.length) {
      enc1 = B64.indexOf(input.charAt(i++));
      enc2 = B64.indexOf(input.charAt(i++));
      enc3 = B64.indexOf(input.charAt(i++));
      enc4 = B64.indexOf(input.charAt(i++));

      chr1 = (enc1 << 2) | (enc2 >> 4);
      chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      chr3 = ((enc3 & 3) << 6) | enc4;

      output += String.fromCharCode(chr1);

      if (enc3 !== 64) {
        output += String.fromCharCode(chr2);
      }

      if (enc4 !== 64) {
        output += String.fromCharCode(chr3);
      }
    }

    return utf8Decode(output);
  }

  // ---------- AMDC response ----------
  if (/\/amdc\/mobileDispatch/i.test(url)) {
    var originalBody = ($response && $response.body) || "";
    var decoded = originalBody;
    var wasBase64 = false;
    var obj = null;

    try {
      obj = JSON.parse(decoded);
    } catch (e1) {
      try {
        decoded = b64Decode(originalBody);
        obj = JSON.parse(decoded);
        wasBase64 = true;
      } catch (e2) {
        log(
          "AMDC body was neither plain JSON nor expected Base64 JSON; unchanged."
        );
        return finish({});
      }
    }

    var hits = 0;

    if (obj && Array.isArray(obj.dns)) {
      obj.dns.forEach(function (entry) {
        if (
          entry &&
          entry.host === "trade-acs.m.taobao.com" &&
          Array.isArray(entry.ips) &&
          entry.ips.length
        ) {
          entry.ips = [];
          hits++;
        }
      });
    }

    if (!hits) {
      log(
        "AMDC intercepted, but no trade-acs direct-IP mapping needed clearing."
      );

      if (notify) {
        notice(
          "AMDC intercepted",
          "No trade-acs IP mapping found in this response."
        );
      }

      return finish({});
    }

    var newBody = JSON.stringify(obj);

    if (wasBase64) {
      newBody = b64Encode(newBody);
    }

    log(
      "AMDC: cleared trade-acs direct-IP mapping (" +
      hits +
      ")."
    );

    notice(
      "AMDC route normalized",
      "Cleared trade-acs direct IPs so the item API can fall back to its hostname."
    );

    return finish({
      body: newBody
    });
  }

  // ---------- detail response ----------
  var body = ($response && $response.body) || "";
  var root;

  try {
    root = JSON.parse(body);
  } catch (e) {
    log(
      "Detail-family response is not JSON; unchanged: " +
      url
    );
    return finish({});
  }

  var findings = [];
  var changes = [];

  function boolLikeTrue(v) {
    return (
      v === true ||
      v === "true" ||
      v === 1 ||
      v === "1"
    );
  }

  function falseLike(v) {
    return typeof v === "string"
      ? "false"
      : false;
  }

  function trueLike(v) {
    return typeof v === "string"
      ? "true"
      : true;
  }

  function isRuleRedirect(v) {
    return (
      typeof v === "string" &&
      (
        /g-sellercenter\.taobao\.com\/rulechannel\/detail/i.test(v) ||
        /(?:^|[?&])cid=170(?:&|$)/i.test(v)
      )
    );
  }

  function patchObject(obj, path) {
    if (!obj || typeof obj !== "object") {
      return false;
    }

    var changedHere = false;

    var explicitOversea =
      Object.prototype.hasOwnProperty.call(
        obj,
        "overseaContraBandFlag"
      ) &&
      boolLikeTrue(
        obj.overseaContraBandFlag
      );

    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        "overseaContraBandFlag"
      )
    ) {
      findings.push(
        path +
        ".overseaContraBandFlag=" +
        String(obj.overseaContraBandFlag)
      );

      if (patchDetail && explicitOversea) {
        obj.overseaContraBandFlag =
          falseLike(
            obj.overseaContraBandFlag
          );

        changes.push(
          path +
          ".overseaContraBandFlag"
        );

        changedHere = true;
      }
    }

    /*
     * areaSell is only altered when THIS SAME object explicitly
     * declared the overseas contraband flag.
     */
    if (
      patchDetail &&
      explicitOversea &&
      Object.prototype.hasOwnProperty.call(
        obj,
        "areaSell"
      ) &&
      !boolLikeTrue(obj.areaSell)
    ) {
      obj.areaSell =
        trueLike(obj.areaSell);

      changes.push(
        path +
        ".areaSell"
      );

      changedHere = true;
    }

    Object.keys(obj).forEach(function (key) {
      var value = obj[key];

      var childPath = path
        ? path + "." + key
        : key;

      if (
        key === "redirectUrl" &&
        isRuleRedirect(value)
      ) {
        findings.push(
          childPath +
          "=rule-center"
        );

        if (patchDetail) {
          obj[key] = null;

          changes.push(
            childPath
          );

          changedHere = true;
        }

        return;
      }

      if (
        key === "tradeDisableTypeEnum" &&
        typeof value === "string" &&
        /(oversea|overseas|global|country|region)/i.test(value)
      ) {
        findings.push(
          childPath +
          "=" +
          value
        );

        if (patchDetail) {
          obj[key] = null;

          changes.push(
            childPath
          );

          changedHere = true;
        }

        return;
      }

      /*
       * Some MTOP responses store parts of the model as JSON
       * serialized inside strings. Parse those too.
       */
      if (typeof value === "string") {
        var t = value.trim();

        if (
          (
            t.charAt(0) === "{" &&
            t.charAt(t.length - 1) === "}"
          ) ||
          (
            t.charAt(0) === "[" &&
            t.charAt(t.length - 1) === "]"
          )
        ) {
          try {
            var nested =
              JSON.parse(value);

            var nestedChanged =
              patchAny(
                nested,
                childPath + "[json]"
              );

            if (nestedChanged) {
              obj[key] =
                JSON.stringify(nested);

              changedHere = true;
            }
          } catch (_) {
            // Not actually JSON; leave untouched.
          }
        }
      } else if (
        value &&
        typeof value === "object"
      ) {
        if (
          patchAny(
            value,
            childPath
          )
        ) {
          changedHere = true;
        }
      }
    });

    return changedHere;
  }

  function patchAny(node, path) {
    if (Array.isArray(node)) {
      var arrChanged = false;

      node.forEach(function (v, i) {
        if (
          v &&
          typeof v === "object" &&
          patchAny(
            v,
            path + "[" + i + "]"
          )
        ) {
          arrChanged = true;
        }
      });

      return arrChanged;
    }

    return patchObject(
      node,
      path || "$"
    );
  }

  var changed =
    patchAny(
      root,
      "$"
    );

  log(
    "Detail API intercepted: " +
    url
  );

  if (findings.length) {
    log(
      "Signals: " +
      findings
        .slice(0, 20)
        .join(" | ")
    );
  } else {
    log(
      "No explicit overseas restriction fields found in this response."
    );
  }

  if (changes.length) {
    log(
      "Patched: " +
      changes.join(" | ")
    );
  }

  if (notify) {
    notice(
      "Item detail intercepted",
      changes.length
        ? (
            "Patched " +
            changes.length +
            " explicit overseas field(s)."
          )
        : (
            findings.length
              ? "Overseas signal found; no additional patch was required."
              : "No known overseas field found; check Loon log/HAR."
          )
    );
  }

  if (changed) {
    return finish({
      body: JSON.stringify(root)
    });
  }

  return finish({});
})();