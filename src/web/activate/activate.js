// The activation page: it asks the license issuer for the key that belongs to a
// Polar checkout and shows it. It uses no storage, cookies or third-party code,
// and the checkout id goes to the issuer and nowhere else.
(function () {
  "use strict";
  var ISSUER = document.querySelector('meta[name="issuer"]');
  var ISSUER_URL = ISSUER ? ISSUER.content : "";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var MESSAGES = {
    "payment-pending": "Your payment is still going through. This page tries again by itself.",
    "not-paid": "That checkout was not completed, so there is no key for it.",
    "no-such-checkout": "No purchase with that ID. Check that you copied all of it.",
    "wrong-product": "That checkout is not for Book Studio Pro.",
    revoked: "That purchase was refunded, so its key is no longer valid.",
    origin: "This page is not allowed to ask for keys from here.",
    "polar-unreachable": "The payment service did not answer. Try again in a minute.",
    "polar-error": "The payment service had a problem. Try again in a minute."
  };

  var statusEl = document.getElementById("status");
  var form = document.getElementById("lookup");
  var input = document.getElementById("checkout");
  var result = document.getElementById("result");
  var tokenEl = document.getElementById("token");
  var retries = 0;

  function say(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? "is-error" : "";
  }

  function ask(id) {
    say("Looking up your purchase…", false);
    form.hidden = true;
    fetch(ISSUER_URL.replace(/\/+$/, "") + "/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkout: id }),
      credentials: "omit",
      referrerPolicy: "no-referrer"
    })
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.status === 200 && r.body.token) return show(r.body);
        var code = r.body && r.body.error;
        if (code === "payment-pending" && retries < 12) {
          retries += 1;
          say(MESSAGES[code], false);
          return setTimeout(function () { ask(id); }, 5000);
        }
        fail(MESSAGES[code] || "Something went wrong. Try again in a minute.");
      })
      .catch(function () {
        fail("Could not reach the key service. Check your connection and try again.");
      });
  }

  function fail(text) {
    say(text, true);
    form.hidden = false;
    input.focus();
  }

  function show(body) {
    tokenEl.value = body.token;
    say(body.name ? "Thank you, " + body.name + ". Your key is ready." : "Your key is ready.", false);
    form.hidden = true;
    result.hidden = false;
    document.getElementById("result-title").focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var id = input.value.trim();
    if (!UUID.test(id)) return fail("That does not look like a checkout ID: it has 36 characters with dashes.");
    retries = 0;
    ask(id);
  });

  document.getElementById("copy").addEventListener("click", function () {
    tokenEl.select();
    var done = function () { say("Key copied.", false); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tokenEl.value).then(done, function () { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  });

  document.getElementById("download").addEventListener("click", function () {
    var url = URL.createObjectURL(new Blob([tokenEl.value + "\n"], { type: "text/plain" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = "book-studio-pro.bslicense";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  if (!/^https:\/\//.test(ISSUER_URL)) {
    say("Book Studio Pro is not on sale yet, so there are no keys to get here.", true);
    return;
  }

  var fromLink = new URLSearchParams(location.search).get("checkout_id");
  if (fromLink && UUID.test(fromLink)) {
    // Take the id out of the address bar so it is not kept in history or shared by accident.
    history.replaceState(null, "", location.pathname);
    ask(fromLink);
  } else {
    say("Paste the checkout ID from your purchase to get your key.", false);
    form.hidden = false;
  }
})();
