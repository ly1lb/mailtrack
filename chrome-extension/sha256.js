/* Sinchroninis SHA-256 ir HMAC-SHA256 (reikia, nes nuorodos perrašomos akimirką prieš "Siųsti",
   kai asinchroninis WebCrypto nespėtų). Grąžina hex eilutę. */
(function (root) {
  'use strict';
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(str) { return Array.from(new TextEncoder().encode(str)); }

  function sha256Bytes(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length;
    var msg = bytes.slice();
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var bitLenHi = Math.floor(l / 0x20000000), bitLenLo = (l * 8) >>> 0;
    msg.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255,
             (bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);
    var W = new Array(64);
    for (var i = 0; i < msg.length; i += 64) {
      for (var t = 0; t < 16; t++) {
        W[t] = (msg[i + 4 * t] << 24) | (msg[i + 4 * t + 1] << 16) | (msg[i + 4 * t + 2] << 8) | msg[i + 4 * t + 3];
      }
      for (t = 16; t < 64; t++) {
        var x = W[t - 15], y = W[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var T1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var T2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + T1) | 0; d = c; c = b; b = a; a = (T1 + T2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
    return out;
  }

  function hex(bytes) { return bytes.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  function hmacSha256Hex(key, message) {
    var k = utf8(key);
    if (k.length > 64) k = sha256Bytes(k);
    while (k.length < 64) k.push(0);
    var ipad = k.map(function (b) { return b ^ 0x36; });
    var opad = k.map(function (b) { return b ^ 0x5c; });
    var inner = sha256Bytes(ipad.concat(utf8(message)));
    return hex(sha256Bytes(opad.concat(inner)));
  }

  root.MTCrypto = {
    sha256Hex: function (s) { return hex(sha256Bytes(utf8(s))); },
    hmacSha256Hex: hmacSha256Hex
  };
})(typeof self !== 'undefined' ? self : this);
